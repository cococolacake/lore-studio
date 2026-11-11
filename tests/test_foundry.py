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


def test_live_mode_actions_through_the_module(tmp_path, monkeypatch):
    """Runs the real bridge module in Node against a fake Foundry world."""
    import base64
    import shutil
    import signal
    import subprocess
    import time
    if not shutil.which("node"):
        import pytest
        pytest.skip("needs node")
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import api as api_mod, devserver, foundry
    a = api_mod.Api()
    a.create_demo(str(tmp_path))
    server, url = devserver.serve(a, 0, background=True)
    root = Path(__file__).resolve().parent.parent
    proc = subprocess.Popen(["node", str(root / "tests/fixtures/fake_foundry.mjs"), url.rstrip("/"), a.foundry_info()["token"],
                             (root / "foundry/lore-studio-bridge/scripts/bridge.mjs").as_uri()],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        for _ in range(60):
            if foundry.status()["connected"] and foundry.inventory()["actors"]:
                break
            time.sleep(0.1)
        inv = a.foundry_inventory()
        assert inv["connected"] and inv["tables"][0]["name"] == "Wild Magic" and inv["actors"][0]["cr"] == 0.25
        assert foundry.status()["origin"] == "http://100.64.0.5:30000"
        t0 = time.time()
        r = a.foundry_roll_table("t1")
        assert r == {"table": "Wild Magic", "total": 7, "results": ["You turn blue."]} and time.time() - t0 < 3   # long polling: quick
        s = a.foundry_actor("a1")
        assert s["ac"] == 15 and s["hp_max"] == 7 and s["abilities"]["dex"]["mod"] == 2 and s["items"][0]["desc"] == "Slash."
        assert a.foundry_place("a1", 3, True) == {"placed": 3, "scene": "The Cellar"}
        a.foundry_open_sheet("a1")
        a.foundry_scene("s1", "activate")
        a.foundry_playlist("p1", "so1", "play")
        try:
            a.foundry_actor("nope")
            raise AssertionError("should fail")
        except foundry.FoundryError as e:
            assert "isn't in this world" in str(e)
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        x = a.handout_save({"title": "Wanted: John Doe", "text": "Reward: **50 gold**"}, {"data_url": "data:image/png;base64," + base64.b64encode(png).decode()})
        x = a.handout_foundry(x["id"])
        assert x["shown"][0]["to"] == "foundry"
        # monster maker: from a world creature, from a compendium, and back to Foundry
        gob = a.monster_new("foundry", "a1")
        assert gob["name"] == "Goblin" and gob["ac"] == 15 and gob["saves"] == {"dex": 4} and gob["skills"] == {"stealth": 6}
        assert gob["actions"][0]["desc"] == "Melee Weapon Attack: +4 to hit. Hit: 5 (1d6 + 2) slashing damage." and gob["foundry_id"] == "a1"
        packs = a.foundry_actor_packs()
        assert packs[0]["title"] == "My Bestiary" and packs[0]["entries"][0]["name"] == "Ogre"
        ogre = a.monster_new("pack", "world.bestiary|og1", name="Bog Ogre")
        assert ogre["size"] == "Large" and ogre["hp"] == 59 and ogre["speed"] == {"walk": 40} and not ogre["foundry_id"]
        r = a.monster_to_foundry(ogre["id"])
        assert r["created"] and a.monster(ogre["id"])["foundry_id"] == r["id"]
        a.monster_save({**a.monster(ogre["id"]), "actions": [{"name": "Club", "desc": "Melee Weapon Attack: +6 to hit. Hit: 13 (2d8 + 4) bludgeoning damage."}]})
        assert a.monster_to_foundry(ogre["id"])["created"] is False                          # the same actor, updated
        # party page: a linked sheet, and fixing its hit points
        p = a.party_save({"character": "Jane Roe", "player": "Alex", "backstory": "Raised by librarians.", "plans": "Her mentor returns in act 3.",
                          "foundry_id": "pc1"})
        p = a.party_sync(p["id"])
        assert p["sheet"]["classes"] == "Wizard 5" and p["sheet"]["background"] == "Sage" and p["level"] == "5"
        chk = next(x for x in a.party()["party"] if x["id"] == p["id"])["hp_check"]
        assert chk["foundry_max"] == 75 and chk["without_bonus"] == 6 + 4 + 3 + 0 + 4 + 2 * 5
        assert any("level 4 has no hit points" in x for x in chk["problems"]) and any("bonus of 40" in x for x in chk["problems"])
        assert a.monster_party_target("hard", 1)["party"] == [5]
        a.party_fix_hp(p["id"], {"class_hp": {"cls1": {"4": "avg"}}, "bonus_overall": ""})
        # encounters: send every monster (free-rules ones become yours first), then place their tokens
        enc = a.encounter_save({"name": "Bog fight", "groups": [{"kind": "monster", "ref": ogre["id"], "count": 1}, {"kind": "srd", "ref": "giant-frog", "count": 3}]})
        try:
            a.encounter_place(enc["id"])
            raise AssertionError("should ask to send first")
        except Exception as e:
            assert "Send Giant Frog to Foundry first" in str(e)
        sent = a.encounter_to_foundry(enc["id"])
        assert [x["name"] for x in sent] == ["Bog Ogre", "Giant Frog"] and sent[1]["created"]
        assert all(g["kind"] == "monster" for g in a.encounter(enc["id"])["encounter"]["groups"])
        assert a.encounter_place(enc["id"]) == {"placed": 4}
        time.sleep(1.0)
    finally:
        proc.send_signal(signal.SIGTERM)
        out, err = proc.communicate(timeout=10)
        server.shutdown()
    report = json.loads(out.strip().splitlines()[-1])
    assert len(report["tokens"]) == 3 + 4 and report["tokens"][0]["hidden"] is True
    assert report["sheetOpened"] == ["a1"] and report["sound"] is True and report["active"] is True
    assert any(l.startswith("upload lore-studio-handouts/") for l in report["log"])
    assert "journal Wanted: John Doe pages=image+text" in report["log"] and "show Wanted: John Doe force" in report["log"]
    assert report["created"][0]["name"] == "Bog Ogre" and report["created"][0]["cr"] == 2
    assert "Club" in report["created"][0]["items"] and len(report["created"][0]["items"]) == 1   # old Lore Studio features replaced
    assert any(l.startswith("create actor Bog Ogre in f") for l in report["log"])
    assert 'wizard hp {"1":"max","2":"avg","3":3,"4":"avg","5":"avg"}' in report["log"]
    assert any(l.startswith("jane ") and '"system.attributes.hp.bonuses.overall":""' in l for l in report["log"])
