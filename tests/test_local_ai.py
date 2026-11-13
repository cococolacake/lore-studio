"""Local models: an OpenAI-compatible server stands in for Ollama / LM Studio / llama.cpp."""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class FakeServer:
    """Answers /v1/models and /v1/chat/completions. `tools_ok=False` behaves like a server that rejects tools."""

    def __init__(self, tools_ok=True):
        self.tools_ok = tools_ok
        self.requests = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, obj):
                data = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                if self.path == "/v1/models":
                    return self._send(200, {"data": [{"id": "tiny-model"}, {"id": "other-model"}]})
                self._send(404, {"error": "nope"})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.requests.append({"body": body, "auth": self.headers.get("Authorization")})
                if body.get("stream"):
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.end_headers()
                    for piece in ["<think>hmm", " still thinking</think>", "John Doe is ", "a human ", "fighter."]:
                        ev = {"choices": [{"delta": {"content": piece}, "finish_reason": None}]}
                        self.wfile.write(f"data: {json.dumps(ev)}\n\n".encode())
                        self.wfile.flush()
                    self.wfile.write(b'data: {"choices":[],"usage":{"prompt_tokens":50,"completion_tokens":9}}\n\ndata: [DONE]\n\n')
                    return
                prompt = body["messages"][-1]["content"]
                if body.get("tools") and not outer.tools_ok:
                    return self._send(400, {"error": {"message": "tools are not supported"}})
                msg = {"role": "assistant", "content": ""}
                if body.get("tools"):
                    args = {"new": [{"title": "Who rang the bell?", "detail": "Nobody was in the tower.", "kind": "question"}]}
                    msg["tool_calls"] = [{"id": "c1", "type": "function", "function": {"name": "record_threads", "arguments": json.dumps(args)}}]
                elif "Write detailed notes of this part" in prompt:
                    msg["content"] = "- [00:00:01] The party reached the chapel."
                elif "JSON schema" in body["messages"][0]["content"]:
                    msg["content"] = 'Here you go:\n```json\n{"new": [{"title": "The bell", "detail": "", "kind": "question"}]}\n```'
                else:
                    msg["content"] = "<think>Let me plan this.</think>\n## Summary\nThe party reached the chapel. {t:00:00:01}"
                self._send(200, {"model": body["model"], "choices": [{"message": msg, "finish_reason": "stop"}],
                                 "usage": {"prompt_tokens": 100, "completion_tokens": 20}})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}/v1"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import campaign, settings
    camp = campaign.create(tmp_path / "Camp", "Demo")
    camp.create_page(None, "John Doe")
    camp.write_page("John Doe", {"title": "John Doe", "tags": ["character"]}, "A human fighter.")
    sid = camp.create_session("The Drowned Chapel", 3)
    segs = [{"start": i * 10.0, "end": i * 10.0 + 5, "speaker": "GM" if i % 2 else "Players 00",
             "text": f"Line {i}: John Doe walks toward the chapel and looks around carefully."} for i in range(400)]
    (camp.session_dir(sid) / "transcript.json").write_text(json.dumps({"segments": segs, "speakers": {}}))
    servers = []

    def make(tools_ok=True, context=32768):
        srv = FakeServer(tools_ok)
        servers.append(srv)
        settings.save({"ai_provider": "local", "local_url": srv.url, "local_model": "tiny-model",
                       "local_api_key": "secret", "local_context": context})
        return srv
    yield camp, sid, make
    for s in servers:
        s.close()


def test_local_test_models_and_cost(setup):
    from studio import claude
    camp, sid, make = setup
    srv = make()
    assert claude.local_models() == ["other-model", "tiny-model"]
    r = claude.test()
    assert r["model"] == "tiny-model" and r["reply"].startswith("## Summary") and "think" not in r["reply"]
    assert srv.requests[0]["auth"] == "Bearer secret"
    assert claude.current_model() == "local:tiny-model" and claude.cost("local:tiny-model", 10**6, 10**6) == 0.0
    claude.ready()      # no Anthropic key needed


def test_local_draft_with_tools(setup):
    from studio import recaps
    from studio.util import Task
    camp, sid, make = setup
    srv = make(tools_ok=True, context=131072)
    recaps.run_draft(Task("t"), camp, sid)
    d = camp.read_draft(sid)
    assert d["gm"].startswith("## Summary") and "<think>" not in d["gm"] and d["player"]
    assert d["model"] == "local:tiny-model" and d["cost"] == 0.0
    assert any(t["title"] == "Who rang the bell?" for t in camp.threads())
    assert all(r["body"]["max_tokens"] <= 8192 for r in srv.requests)
    assert not any("Write detailed notes" in r["body"]["messages"][-1]["content"] for r in srv.requests)   # big context: no condensing


def test_local_draft_small_context_condenses_and_falls_back_to_json(setup):
    from studio import recaps
    from studio.util import Task
    camp, sid, make = setup
    srv = make(tools_ok=False, context=8192)
    est = recaps.estimate(camp, sid)
    assert est["local"] and est["condense_parts"] >= 2 and est["cost"] == 0.0
    recaps.run_draft(Task("t"), camp, sid)
    condense = [r for r in srv.requests if "Write detailed notes" in r["body"]["messages"][-1]["content"]]
    assert len(condense) >= 2
    gm_call = next(r for r in srv.requests if "Write the GM's recap" in r["body"]["messages"][-1]["content"])
    assert "detailed notes of it" in gm_call["body"]["messages"][-1]["content"]
    total = sum(len(m["content"]) for m in gm_call["body"]["messages"]) / 3.6 + gm_call["body"]["max_tokens"]
    assert total < 8192
    assert any(t["title"] == "The bell" for t in camp.threads())      # tools refused -> JSON in the reply


def test_unreachable_server_message(setup):
    from studio import claude, settings
    camp, sid, make = setup
    settings.save({"ai_provider": "local", "local_url": "http://127.0.0.1:9/v1"})
    with pytest.raises(claude.ClaudeError, match="Is the server running"):
        claude.test()


def test_chat_streams_and_saves(setup):
    import time as _t
    from studio import chat
    camp, sid, make = setup
    srv = make()
    c = chat.create(camp)
    chat.send(camp, c["id"], "Who is John Doe?")
    for _ in range(100):
        r = chat.poll(c["id"])
        if not r.get("active"):
            break
        _t.sleep(0.05)
    saved = chat.read(camp, c["id"])
    assert [m["role"] for m in saved["messages"]] == ["user", "assistant"]
    reply = saved["messages"][1]
    assert reply["content"] == "John Doe is a human fighter." and "John Doe" in reply["pages"] and reply["cost"] == 0.0
    assert saved["title"] == "Who is John Doe?"
    system = srv.requests[-1]["body"]["messages"][0]["content"]
    assert "### John Doe" in system and "A human fighter." in system
    # player-safe chats leave GM-only pages out
    camp.write_page("John Doe", {"title": "John Doe", "visibility": "gm"}, "Secret prince.")
    text, ids = chat.system_prompt(camp, True, "Tell me about John Doe")
    assert "Secret prince" not in text and "John Doe" not in ids
    chat.regenerate(camp, c["id"])
    for _ in range(100):
        if not chat.poll(c["id"]).get("active"):
            break
        _t.sleep(0.05)
    assert len(chat.read(camp, c["id"])["messages"]) == 2
    assert len(chat.list_chats(camp)) == 1


def test_claude_stream_parsing(setup, monkeypatch):
    from studio import claude, settings
    camp, sid, make = setup
    settings.save({"ai_provider": "claude", "anthropic_api_key": "sk-test"})
    events = [{"type": "message_start", "message": {"usage": {"input_tokens": 120}}},
              {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello "}},
              {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "GM."}},
              {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 3}}]
    raw = "".join(f"event: x\ndata: {json.dumps(e)}\n\n" for e in events).encode()

    class Resp:
        def __init__(self):
            import io
            self.b = io.BytesIO(raw)
        def readline(self):
            return self.b.readline()
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False

    monkeypatch.setattr(claude.urllib.request, "urlopen", lambda req, timeout=None: Resp())
    got = []
    r = claude.stream(["sys"], [{"role": "user", "content": "hi"}], got.append)
    assert r["text"] == "Hello GM." and got == ["Hello ", "GM."] and r["usage"]["input"] == 120 and r["usage"]["output"] == 3


class FakeOllama:
    """Ollama's own API: /api/version, /api/chat (with num_ctx). `cut_to` pretends the server truncated the prompt."""

    def __init__(self, cut_to=None, thinking_ok=True):
        self.requests, outer = [], self
        self.cut_to, self.thinking_ok = cut_to, thinking_ok

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, obj):
                data = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                if self.path == "/api/version":
                    return self._send(200, {"version": "0.12.0"})
                if self.path == "/v1/models":
                    return self._send(200, {"data": [{"id": "qwen3:14b"}]})
                self._send(404, {"error": "nope"})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.requests.append(body)
                if "think" in body and not outer.thinking_ok:
                    return self._send(400, {"error": "\"qwen3:14b\" does not support thinking"})
                sent = sum(len(m["content"]) for m in body["messages"]) // 4
                seen = outer.cut_to or sent
                if body.get("stream"):
                    self.send_response(200)
                    self.send_header("Content-Type", "application/x-ndjson")
                    self.end_headers()
                    for piece in ["Hello ", "there."]:
                        self.wfile.write((json.dumps({"message": {"content": piece}, "done": False}) + "\n").encode())
                    self.wfile.write((json.dumps({"message": {"content": ""}, "done": True, "done_reason": "stop",
                                                  "prompt_eval_count": seen, "eval_count": 2}) + "\n").encode())
                    return
                msg = {"role": "assistant", "content": "## Summary\nThey crossed the bridge."}
                if body.get("tools"):
                    msg = {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "record_threads",
                           "arguments": {"new": [{"title": "Old debt", "detail": "Still unpaid.", "kind": "debt"}], "progressed": [], "resolved": []}}}]}
                self._send(200, {"model": body["model"], "message": msg, "done": True, "done_reason": "stop",
                                 "prompt_eval_count": seen, "eval_count": 30})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}/v1"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()


def test_ollama_native_sets_context(setup):
    from studio import claude, recaps, settings
    from studio.util import Task
    camp, sid, make = setup
    o = FakeOllama(thinking_ok=False)
    settings.save({"ai_provider": "local", "local_url": o.url, "local_model": "qwen3:14b", "local_context": 32768})
    claude._ollama.clear()
    assert claude.is_ollama()
    recaps.run_draft(Task("t"), camp, sid)
    chats = [r for r in o.requests if "messages" in r]
    assert all(r["options"]["num_ctx"] == 32768 for r in chats)
    assert any(r.get("tools") for r in chats)
    assert camp.read_draft(sid)["gm"].startswith("## Summary") and not camp.read_draft(sid).get("warnings")
    assert any(t["title"] == "Old debt" for t in camp.threads())
    got = []
    r = claude.stream(["sys"], [{"role": "user", "content": "hi"}], got.append)
    assert r["text"] == "Hello there." and got == ["Hello ", "there."]
    o.httpd.shutdown()


def test_cut_input_is_flagged(setup):
    from studio import claude, recaps, settings
    from studio.util import Task
    camp, sid, make = setup
    o = FakeOllama(cut_to=2000)
    settings.save({"ai_provider": "local", "local_url": o.url, "local_model": "qwen3:14b", "local_context": 32768})
    claude._ollama.clear()
    recaps.run_draft(Task("t"), camp, sid, parts=("gm",))
    assert "cut part of the input" in camp.read_draft(sid)["warnings"][0]
    o.httpd.shutdown()


def test_scan_past_recaps(setup):
    from studio import claude, recaps, settings
    from studio.util import Task
    camp, sid, make = setup
    o = FakeOllama()
    settings.save({"ai_provider": "local", "local_url": o.url, "local_model": "qwen3:14b"})
    claude._ollama.clear()
    s1 = camp.create_session("The Bridge", 1)
    camp.write_session_text(s1, "recap", "John Doe borrowed money from the guild.")
    s2 = camp.create_session("The Fog", 2)
    assert [c["id"] for c in recaps.scan_candidates(camp)] == [s1]
    recaps.run_scan(Task("t"), camp, [s1])
    th = [t for t in camp.threads() if t["title"] == "Old debt"]
    assert th and th[0]["status"] == "proposed" and th[0]["sessions"] == [s1]
    assert recaps.scan_candidates(camp) == [] and recaps.scan_candidates(camp, only_new=False)[0]["scanned"]
    # a later recap settling a thread nobody reviewed files it as resolved
    recaps._apply_scan(camp, s2, {"resolved": [{"id": th[0]["id"], "note": "Paid back."}]})
    t = next(x for x in camp.threads() if x["id"] == th[0]["id"])
    assert t["status"] == "resolved" and t["notes"][-1]["text"] == "Paid back." and s2 in t["sessions"]
    o.httpd.shutdown()


def test_tag_suggestions(setup, monkeypatch):
    from studio import autotag, claude
    from studio.util import Task
    camp, sid, make = setup
    make()
    camp.write_page("Westmarch", {"title": "Westmarch", "tags": ["region"]}, "A windy border region.")
    camp.write_page("Millbrook", {"title": "Millbrook"}, "A market town in Westmarch.")

    def fake_message(model, system, messages, max_tokens=0, tools=None, tool_choice=None, opener=None, **k):
        text = messages[0]["content"]
        assert "region: 1" in text and 'id="Millbrook"' in text
        return {"model": model, "stop_reason": "end_turn", "usage": {}, "content": [{"type": "tool_use", "name": "suggest_tags", "input": {"pages": [
            {"id": "Millbrook", "tags": ["Town", "#Westmarch", "town"]}, {"id": "Westmarch", "tags": ["region", "Border Lands"]},
            {"id": "Nowhere", "tags": ["x"]}]}}]}
    monkeypatch.setattr(claude, "message", fake_message)
    est = autotag.estimate(camp, "all")
    assert est["pages"] == len(camp.pages()) and est["calls"] == 2 and est["cost"] == 0.0   # local models: 3 pages per call
    autotag.run(Task("t"), camp, ["Millbrook", "Westmarch"])
    s = autotag.pending(camp)
    assert s["Millbrook"]["add"] == ["town", "westmarch"] and s["Westmarch"]["add"] == ["border-lands"]
    assert "town" not in camp.read_page("Millbrook")["meta"].get("tags", [])          # nothing changes until approved
    assert autotag.accept(camp, "Millbrook", ["town"]) == {"added": ["town"]}
    assert camp.read_page("Millbrook")["meta"]["tags"] == ["town"]
    autotag.dismiss(camp, "Westmarch")
    assert list(autotag.pending(camp)) == ["Millbrook"] and autotag.accept_all(camp) == 1
    assert camp.read_page("Millbrook")["meta"]["tags"] == ["town", "westmarch"] and autotag.pending(camp) == {}
    untagged = [p["id"] for p in autotag.pick_pages(camp, "untagged")]
    assert "Millbrook" not in untagged and "Westmarch" not in untagged


def test_session_tags_and_suggestions(setup, monkeypatch):
    from studio import autotag, claude
    from studio.util import Task
    camp, sid, make = setup
    make()
    camp.write_page("Westmarch", {"title": "Westmarch", "tags": ["region"]}, "A windy border region.")
    camp.write_page("Millbrook", {"title": "Millbrook", "tags": ["town", "heist"]}, "A market town.")
    s1 = camp.create_session("The Vault", 1)
    camp.write_session_text(s1, "recap", "The party robbed the Millbrook bank.")
    s2 = camp.create_session("Empty", 2)
    # tags typed by hand are cleaned up
    camp.update_session(s2, {"tags": "#Road Trip, travel, travel"})
    assert camp.read_session(s2)["tags"] == ["road-trip", "travel"]
    camp.update_session(s2, {"tags": []})
    assert "tags" not in __import__("json").loads((camp.sessions_dir / s2 / "session.json").read_text())

    # sessions without notes aren't sent; sessions with a recap are
    assert [x["id"] for x in autotag.pick_pages(camp, "sessions")] == ["session:" + s1]

    def fake_message(model, system, messages, max_tokens=0, tools=None, tool_choice=None, opener=None, **k):
        text = messages[0]["content"]
        assert 'kind="session"' in text and "robbed the Millbrook bank" in text
        return {"model": model, "stop_reason": "end_turn", "usage": {}, "content": [{"type": "tool_use", "name": "suggest_tags", "input": {"pages": [
            {"id": "session:" + s1, "tags": ["Heist", "session", "westmarch"]}]}}]}
    monkeypatch.setattr(claude, "message", fake_message)
    autotag.run(Task("t"), camp, ["session:" + s1])
    p = autotag.pending(camp)
    assert p["session:" + s1]["add"] == ["heist", "westmarch"] and p["session:" + s1]["kind"] == "session"
    assert autotag.accept(camp, "session:" + s1, ["heist"]) == {"added": ["heist"]}
    assert camp.read_session(s1)["tags"] == ["heist"]

    # #tag search and the tag list include sessions
    assert {r["kind"] for r in camp.search("#heist")} == {"page", "session"}
    assert {"tag": "heist", "count": 2} in camp.tags()

    # the graph joins pages and sessions through a shared tag, kept apart from mention links
    g = camp.graph()
    assert any(n["id"] == "tag:heist" and n["kind"] == "tag" and n["degree"] == 2 for n in g["nodes"])
    assert ["Millbrook", "tag:heist"] in g["tag_edges"] and ["session:" + s1, "tag:heist"] in g["tag_edges"]
    assert not any(n["id"] == "tag:region" for n in g["nodes"])          # a tag on one thing links nothing
    assert all(not e[1].startswith("tag:") for e in g["edges"])
