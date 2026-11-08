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
