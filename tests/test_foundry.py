"""Foundry bridge: token, CORS preflight, events into the session log, outbox journals."""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _req(url, method="GET", body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            raw = resp.read()
            return resp.status, dict(resp.headers), (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), json.loads(e.read() or b"null")


def test_bridge_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import api as api_mod, campaign, devserver, foundry, recaps

    camp = campaign.create(tmp_path / "Camp", "Demo")
    a = api_mod.Api()
    a._campaign = camp
    sid = camp.create_session("The Sunken Crown", 1)
    camp.write_recording(sid, {"live_started": "2026-01-01 19:00:00"})
    server, url = devserver.serve(a, 0, background=True)
    try:
        base = url.rstrip("/")
        tok = a.foundry_info()["token"]
        origin = {"Origin": "http://100.64.0.5:30000"}

        # Preflight from a Foundry page on another origin
        code, hdr, _ = _req(base + "/foundry/events", "OPTIONS", headers={**origin, "Access-Control-Request-Private-Network": "true"})
        assert code == 204
        assert hdr["Access-Control-Allow-Origin"] == origin["Origin"]
        assert hdr["Access-Control-Allow-Private-Network"] == "true"
        assert "x-lore-token" in hdr["Access-Control-Allow-Headers"].lower()

        # Wrong token is refused
        code, _, _ = _req(base + "/foundry/hello", "POST", {"world": "x"}, {**origin, "Content-Type": "application/json", "X-Lore-Token": "nope"})
        assert code == 403

        h = {**origin, "Content-Type": "application/json", "X-Lore-Token": tok}
        code, _, body = _req(base + "/foundry/hello", "POST", {"world": "Test World", "user": "Gamemaster", "foundry": "14.369", "system": "dnd5e 5.3.1"}, h)
        assert code == 200 and body["ok"]
        assert a.foundry_status()["connected"] and a.foundry_status()["world"] == "Test World"

        events = [
            {"type": "roll", "time": "2026-01-01T19:05:30", "speaker": "John Doe", "flavor": "Athletics", "rolls": [{"formula": "1d20+5", "total": 17}]},
            {"type": "chat", "time": "2026-01-01T19:06:00", "speaker": "Jane Roe", "text": "I check the door"},
            {"type": "combat", "time": "2026-01-01T19:10:00", "round": 1, "turn": 0, "combatant": "Goblin"},
        ]
        code, _, body = _req(base + "/foundry/events", "POST", {"events": events}, h)
        assert code == 200 and body["saved"] == 3 and body["session"] == sid
        assert len(a.foundry_log(sid)) == 3
        text = foundry.log_text(camp, sid)
        assert "[00:05:30] John Doe rolled 1d20+5 = 17 (Athletics)" in text
        assert "Combat round 1, Goblin" in text
        (camp.session_dir(sid) / "transcript.json").write_text(json.dumps(
            {"segments": [{"start": 1, "end": 2, "speaker": "GM", "text": "Roll for it."}], "speakers": {}}))
        notes = recaps.build_inputs(camp, sid)["notes"]
        assert "From Foundry VTT" in notes and "John Doe rolled" in notes

        # Outbox: a page with a GM block, shared with players
        camp.write_page("people/john-doe", {"title": "John Doe"}, "A human fighter.\n\n:::gm\nSecretly a prince.\n:::\n")
        a.foundry_send_page("people/john-doe", True)
        a.foundry_send_page("people/john-doe", True)          # sending twice replaces the queued copy
        code, _, body = _req(base + "/foundry/outbox", "GET", headers={**origin, "X-Lore-Token": tok})
        assert code == 200 and len(body["actions"]) == 1
        act = body["actions"][0]
        assert act["name"] == "John Doe" and act["share"] and "human fighter" in act["html"] and "prince" not in act["html"]
        assert _req(base + "/foundry/outbox", "GET", headers={**origin, "X-Lore-Token": tok})[2]["actions"] == []

        # The normal API stays closed to other origins
        code, _, _ = _req(base + "/api/foundry_info", "POST", {}, {**origin, "Content-Type": "application/json"})
        assert code == 403
    finally:
        server.shutdown()


def test_install_module(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import foundry
    data = tmp_path / "FoundryVTT" / "Data"
    (data / "modules").mkdir(parents=True)
    (data / "worlds").mkdir()
    dest = Path(foundry.install_module(tmp_path / "FoundryVTT"))
    manifest = json.loads((dest / "module.json").read_text())
    assert manifest["id"] == "lore-studio-bridge" and (dest / "scripts" / "bridge.mjs").exists()
    try:
        foundry.install_module(tmp_path)
        raise AssertionError("should refuse a folder that isn't Foundry's Data")
    except ValueError:
        pass


def test_demo_campaign(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import api as api_mod, maps
    a = api_mod.Api()
    info = a.create_demo(str(tmp_path))
    camp = a._campaign
    assert camp.root.name == "The Sunken Crown (demo)"
    john = camp.read_page("Characters/John Doe")
    assert "fighter" in john["meta"]["tags"]
    assert any(p["id"] == "Locations/Westmarch" for p in john["links"]["pages"]) if "links" in john else True
    assert [p["id"] for p in camp.read_page("Locations/Millbrook")["backlinks"]["pages"]]
    sids = [s["id"] for s in camp.sessions()]
    assert len(sids) == 4
    assert "John Doe: I want to check the mud" in camp.transcript_text(sids[2])
    assert camp.read_draft(sids[2])["gm"].startswith("## Summary")
    assert any(t.get("suggestion") for t in camp.threads())
    assert len(maps.read(camp, "westmarch")["pins"]) == 5
    assert info
