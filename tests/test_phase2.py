"""Phase 2 checks with fakes: transcript handling, Claude drafts, Discord posts, the OBS client.
Nothing here needs a GPU, an API key, Discord or OBS."""
import base64
import hashlib
import io
import json
import socket
import struct
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio import campaign, discord, obs, recaps, settings, transcription  # noqa: E402
from studio.workers import transcribe as worker  # noqa: E402
from studio.util import Task  # noqa: E402


@pytest.fixture(autouse=True)
def app_home(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))


@pytest.fixture
def camp(tmp_path):
    c = campaign.create(tmp_path / "Camp", "The Sunken Crown")
    c.create_page(None, "Characters")
    c.create_page("Characters", "John Doe")
    c.write_page("Characters/John Doe", {"title": "John Doe", "tags": ["character"]}, "Leader.\n\n:::gm\nShe is a spy.\n:::\n")
    c.create_page(None, "Westmarch")
    c.write_page("Westmarch", {"title": "Westmarch", "tags": ["location"]}, "A windy border region.")
    sid = c.create_session("The Drowned Chapel", 23)
    segs = [
        {"start": 1.0, "end": 4.0, "speaker": "GM", "text": "You arrive in Westmarch."},
        {"start": 4.5, "end": 6.0, "speaker": "GM", "text": "John greets you."},
        {"start": 7.0, "end": 9.0, "speaker": "Players 00", "text": "We ask about the chapel."},
    ]
    worker.write_outputs(str(c.session_dir(sid)), segs, {"speakers": {}, "duration": 10})
    c.sid = sid
    return c


# ---- worker helpers --------------------------------------------------------------

def test_worker_assign_speakers_and_outputs(tmp_path):
    segs = [{"start": 0, "end": 2, "speaker": "Players", "text": "a"}, {"start": 3, "end": 5, "speaker": "Players", "text": "b"}]
    worker.assign_speakers(segs, [(0, 2.5, "SPEAKER_00"), (2.6, 6, "SPEAKER_01")], "Players")
    assert [s["speaker"] for s in segs] == ["Players 00", "Players 01"]
    worker.write_outputs(str(tmp_path), segs, {"speakers": {}})
    assert "00:00:03,000 --> 00:00:05,000" in (tmp_path / "transcript.srt").read_text()
    assert json.loads((tmp_path / "transcript.json").read_text())["segments"][1]["text"] == "b"


def test_transcript_text_and_speaker_names(camp):
    text = camp.transcript_text(camp.sid)
    assert text.splitlines()[0] == "[00:00:01] GM: You arrive in Westmarch. John greets you."
    camp.save_speakers(camp.sid, {"Players 00": "Jane"})
    assert "Jane: We ask about the chapel." in camp.transcript_text(camp.sid)
    assert camp.session_list()[0]["status"] == "transcribed"


def test_glossary_puts_names_first(camp):
    camp.save_info({"party": [{"character": "Jane Rowan", "player": "Sam"}]})
    g = transcription.glossary(camp).split()
    assert g[:2] == ["Jane", "Rowan"]
    assert "John" in g and "Westmarch" in g


def test_default_tracks():
    from studio.api import default_tracks
    settings.save({"obs_gm_track": 2, "obs_players_track": 3, "diarize_players": True})
    assert default_tracks(3) == [{"stream": 1, "speaker": "GM", "diarize": False}, {"stream": 2, "speaker": "Players", "diarize": True, "voices": None}]
    assert default_tracks(1) == []


# ---- Claude drafts -----------------------------------------------------------------

class FakeAnthropic:
    def __init__(self):
        self.bodies = []

    def __call__(self, req, timeout=None):
        body = json.loads(req.data)
        self.bodies.append(body)
        if body.get("tools"):
            content = [{"type": "tool_use", "name": "record_threads", "input": {
                "new": [{"title": "What lies in the chapel", "detail": "John hinted at it.", "kind": "question", "t": "00:00:05"}],
                "progressed": [], "resolved": []}}]
        else:
            content = [{"type": "text", "text": "## Summary\nThey met John. {t:00:00:04}"}]
        data = json.dumps({"content": content, "usage": {"input_tokens": 10, "output_tokens": 5}}).encode()
        return _Resp(data)


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_recap_draft_with_fake_claude(camp):
    settings.save({"anthropic_api_key": "sk-test"})
    camp.update_session(camp.sid, {"claude_notes": "Before recording: the party left Millbrook at dawn."})
    fake = FakeAnthropic()
    task = Task("test")
    recaps.run_draft(task, camp, camp.sid, opener=fake)
    draft = camp.read_draft(camp.sid)
    assert draft["gm"].startswith("## Summary") and draft["player"]
    assert draft["threads"] == {"new": 1, "suggestions": 0}
    th = camp.threads()[0]
    assert th["status"] == "proposed" and th["sessions"] == [camp.sid]
    # prompt caching on the primer, and GM secrets never in the player prompt
    gm_call, player_call = fake.bodies[0], fake.bodies[1]
    assert gm_call["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "She is a spy" in gm_call["messages"][0]["content"]
    assert "She is a spy" not in player_call["messages"][0]["content"]
    assert "left Millbrook at dawn" in gm_call["messages"][0]["content"] and "left Millbrook at dawn" in player_call["messages"][0]["content"]
    # accepting moves drafts into place
    recaps.accept_draft(camp, camp.sid)
    s = camp.read_session(camp.sid)
    assert "They met John" in s["recap"] and camp.player_recap(camp.sid)
    assert camp.read_draft(camp.sid) is None


def test_thread_suggestions(camp):
    tid = camp.add_thread("Pay back the guild", kind="debt")
    res = recaps.apply_threads(camp, camp.sid, {"new": [], "progressed": [], "resolved": [{"id": tid, "note": "Paid in full."}]})
    assert res == {"new": 0, "suggestions": 1}
    assert camp.threads()[0]["suggestion"]["type"] == "resolve"


# ---- Discord --------------------------------------------------------------------------

def test_discord_markdown_and_split(camp):
    md = "Opening\n\n:::gm\nsecret\n:::\n\nThey met [[John Doe|John]]. {t:00:01:02}\n\n#### Small heading"
    out = discord.to_discord_markdown(md)
    assert "secret" not in out and "{t:" not in out and "John." in out and "**Small heading**" in out
    callout = discord.to_discord_markdown(":::callout\n**Teaser**\n:::\n\nThe group set off.")
    assert callout == "**Teaser**\n\nThe group set off."
    long = "\n\n".join("word " * 200 for _ in range(10))
    parts = discord.split(long, 1900)
    assert all(len(p) <= 1900 for p in parts) and len(parts) > 3


def test_discord_build_and_post(camp):
    camp.save_info({"discord": {"title": "Session {number}: {title}", "ping_role": "123", "color": "#ff0000"}})
    s = camp.read_session(camp.sid)
    msgs = discord.build(camp, s, "Recap text " * 800)
    assert len(msgs) >= 2
    assert msgs[0]["embeds"][0]["title"] == "Session 23: The Drowned Chapel"
    assert msgs[0]["content"] == "<@&123>" and msgs[0]["allowed_mentions"]["roles"] == ["123"]
    assert msgs[0]["embeds"][0]["color"] == 0xFF0000
    assert "footer" in msgs[-1]["embeds"][0]
    sent = []

    def opener(req, timeout=None):
        sent.append(json.loads(req.data))
        assert req.full_url.endswith("?wait=true")
        return _Resp(json.dumps({"id": str(len(sent))}).encode())
    url = "https://discord.com/api/webhooks/123/abcDEF_-"
    assert discord.post(url, msgs, opener=opener) == [str(i + 1) for i in range(len(msgs))]
    with pytest.raises(ValueError):
        discord.post("https://example.com/hook", msgs, opener=opener)


# ---- OBS --------------------------------------------------------------------------------

def _fake_obs(password, requests):
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    port = srv.getsockname()[1]

    def send(conn, obj):
        data = json.dumps(obj).encode()
        conn.sendall(bytes([0x81, len(data)]) if len(data) < 126 else bytes([0x81, 126]) + struct.pack(">H", len(data)))
        conn.sendall(data)

    def recv(conn):
        b1, b2 = conn.recv(2)
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack(">H", conn.recv(2))[0]
        mask = conn.recv(4)
        data = b""
        while len(data) < n:
            data += conn.recv(n - len(data))
        return json.loads(bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def serve():
        conn, _ = srv.accept()
        head = b""
        while b"\r\n\r\n" not in head:
            head += conn.recv(1024)
        key = [ln.split(b": ")[1] for ln in head.split(b"\r\n") if ln.lower().startswith(b"sec-websocket-key")][0].decode()
        acc = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        conn.sendall(f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {acc}\r\n\r\n".encode())
        salt, challenge = "saltsalt", "chal"
        send(conn, {"op": 0, "d": {"obsWebSocketVersion": "5.5.0", "rpcVersion": 1, "authentication": {"salt": salt, "challenge": challenge}}})
        ident = recv(conn)
        secret = base64.b64encode(hashlib.sha256((password + salt).encode()).digest()).decode()
        want = base64.b64encode(hashlib.sha256((secret + challenge).encode()).digest()).decode()
        assert ident["d"]["authentication"] == want
        send(conn, {"op": 2, "d": {"negotiatedRpcVersion": 1}})
        while True:
            try:
                req = recv(conn)
            except Exception:
                break
            requests.append(req["d"]["requestType"])
            data = {"StopRecord": {"outputPath": "D:/OBS/session.mp4"},
                    "GetRecordStatus": {"outputActive": True, "outputDuration": 61000}}.get(req["d"]["requestType"], {})
            send(conn, {"op": 7, "d": {"requestId": req["d"]["requestId"], "requestType": req["d"]["requestType"],
                                       "requestStatus": {"result": True, "code": 100}, "responseData": data}})
        conn.close()
        srv.close()
    threading.Thread(target=serve, daemon=True).start()
    return port


def test_obs_client_auth_and_requests():
    seen = []
    port = _fake_obs("hunter2", seen)
    with obs.Client("127.0.0.1", port, "hunter2") as c:
        c.request("StartRecord")
        assert c.request("GetRecordStatus")["outputDuration"] == 61000
        assert c.request("StopRecord")["outputPath"] == "D:/OBS/session.mp4"
    assert seen == ["StartRecord", "GetRecordStatus", "StopRecord"]


def test_obs_unreachable():
    with pytest.raises(obs.OBSError):
        with obs.Client("127.0.0.1", 1, "x", timeout=1):
            pass


def test_default_tracks_use_party_size(camp):
    from studio.api import default_tracks
    settings.save({"obs_gm_track": 2, "obs_players_track": 3, "diarize_players": True})
    camp.save_info({"party": [{"character": "Jane"}, {"character": "Rook"}, {"character": "Pip"}, {"player": "Lee"}]})
    assert default_tracks(3, camp)[1]["voices"] == 4


def test_diarize_passes_voice_count(monkeypatch):
    import types
    import numpy as np
    calls = {}

    class Ann:
        def itertracks(self, yield_label=False):
            seg = types.SimpleNamespace(start=0.0, end=1.0)
            yield seg, None, "SPEAKER_00"

    class Pipe:
        def __call__(self, data, **kw):
            calls.update(kw)
            return types.SimpleNamespace(speaker_diarization=Ann())

        def to(self, device):
            return self

    pipeline_cls = types.SimpleNamespace(from_pretrained=lambda *a, **k: Pipe())
    monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(from_numpy=lambda a: types.SimpleNamespace(unsqueeze=lambda i: a), device=lambda d: d))
    monkeypatch.setitem(sys.modules, "pyannote", types.ModuleType("pyannote"))
    monkeypatch.setitem(sys.modules, "pyannote.audio", types.SimpleNamespace(Pipeline=pipeline_cls))
    turns = worker.diarize(np.zeros(16000, dtype="float32"), {}, "cpu", voices=4)
    assert calls == {"num_speakers": 4} and turns == [(0.0, 1.0, "SPEAKER_00")]
    calls.clear()
    worker.diarize(np.zeros(16000, dtype="float32"), {}, "cpu", voices=None)
    assert calls == {}


def test_costs():
    from studio import claude
    assert claude.cost("claude-sonnet-5-5", 1_000_000, 100_000) == 3.0
    assert claude.cost_of_usage("claude-sonnet-5-5", [{"input": 50_000, "output": 2_000, "cache_write": 3_000, "cache_read": 0},
                                                      {"input": 48_000, "output": 1_000, "cache_write": 0, "cache_read": 3_000}]) == round(0.1 + 0.02 + 0.0075 + 0.096 + 0.01 + 0.0006, 4)
    assert claude.cost("some-future-model", 1000, 1000) is None


def test_truncated_parts_are_flagged_and_redone(camp):
    settings.save({"anthropic_api_key": "sk-test"})

    class Cut(FakeAnthropic):
        def __init__(self, cut):
            super().__init__()
            self.cut = cut

        def __call__(self, req, timeout=None):
            body = json.loads(req.data)
            self.bodies.append(body)
            data = {"content": [{"type": "text", "text": "partial"}], "usage": {"input_tokens": 1, "output_tokens": 1},
                    "stop_reason": "max_tokens" if self.cut else "end_turn"}
            return _Resp(json.dumps(data).encode())
    recaps.run_draft(Task("t"), camp, camp.sid, parts=("gm", "player"), opener=Cut(True))
    assert camp.read_draft(camp.sid)["truncated"] == ["gm", "player"]
    fake = Cut(False)
    recaps.run_draft(Task("t"), camp, camp.sid, parts=("player",), opener=fake)
    d = camp.read_draft(camp.sid)
    assert d["truncated"] == ["gm"] and len(d["usage"]) == 3
    assert fake.bodies[0]["max_tokens"] == recaps.PLAYER_MAX


def test_fix_names_everywhere_and_remember(camp):
    camp.create_page(None, "Elara")
    camp.write_draft(camp.sid, {"gm": "Talia met Elera. Talia's tattoo.", "player": "Talia smiled. Talian stew."})
    camp.write_session_text(camp.sid, "recap", "Old recap mentions Talia.")
    seg_file = camp.session_dir(camp.sid) / "transcript.json"
    data = json.loads(seg_file.read_text())
    data["segments"][0]["text"] = "Talia is here."
    seg_file.write_text(json.dumps(data))
    sugg = camp.suggest_name_fixes(camp.sid)
    assert ["Elera", "Elara", 1] in sugg
    camp.write_draft(camp.sid, {**camp.read_draft(camp.sid), "player": camp.read_draft(camp.sid)["player"] + " John's plan."})
    assert not any(w.startswith("John") for w, _, _ in camp.suggest_name_fixes(camp.sid))
    counts = camp.fix_names(camp.sid, [("Talia", "Thalia"), ("Elera", "Elara")])
    assert counts == {"Talia": 5, "Elera": 1}
    d = camp.read_draft(camp.sid)
    assert d["gm"] == "Thalia met Elara. Thalia's tattoo." and "Talian stew" in d["player"]
    assert "Thalia" in camp.read_session(camp.sid)["recap"]
    assert camp.read_transcript(camp.sid)["segments"][0]["text"] == "Thalia is here."
    assert camp.spellings() == {"Talia": "Thalia", "Elera": "Elara"}
    # remembered: suggested next time, sent to Claude, and given to Whisper as a hint
    camp.write_draft(camp.sid, {"gm": "Talia again.", "player": ""})
    assert ["Talia", "Thalia", 1] in camp.suggest_name_fixes(camp.sid)
    assert "Thalia (not Talia)" in recaps.primer(camp, True)
    assert "Thalia" in transcription.glossary(camp).split()
