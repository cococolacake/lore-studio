"""A small client for the Anthropic Messages API, or for a local model (standard library only).

Callers always speak the Messages API shape. With Settings -> AI set to a local model, each call is
translated to an OpenAI-compatible /chat/completions request (Ollama, LM Studio, llama.cpp, KoboldCpp,
vLLM, text-generation-webui...) and the reply is translated back, so recaps, loose threads and scene
suggestions work the same way.

Keys are the user's own, stored in Lore Studio's app-data settings, never in the campaign folder.
"""
import json
import re
import time
import urllib.error
import urllib.request

from . import __version__, settings

API = "https://api.anthropic.com/v1/messages"
MODELS = [
    ["claude-opus-5-5", "Claude Opus 5.5 (best writing, slower, costs more)"],
    ["claude-sonnet-5-5", "Claude Sonnet 5.5 (great balance)"],
    ["claude-haiku-5-5", "Claude Haiku 5.5 (fast and cheap)"],
]
DEFAULT_MODEL = "claude-sonnet-5-5"

# USD per million tokens: input, output, cache write (5 min), cache read. Checked 2026-11-08 against
# published rate cards; Anthropic's pricing page is the source of truth, so estimates say "about".
PRICES = {
    "claude-opus-5-5": (4.00, 20.00, 5.00, 0.20),
    "claude-sonnet-5-5": (2.00, 10.00, 2.50, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.125, 0.01),
}


LOCAL_PREFIX = "local:"
LOCAL_PRESETS = [
    ["Ollama", "http://localhost:11434/v1"],
    ["LM Studio", "http://localhost:1234/v1"],
    ["llama.cpp server", "http://localhost:8080/v1"],
    ["KoboldCpp", "http://localhost:5001/v1"],
    ["vLLM", "http://localhost:8000/v1"],
    ["text-generation-webui", "http://localhost:5000/v1"],
]


def is_local():
    return settings.get("ai_provider") == "local"


def _local_model_name():
    """The local model to use: the one chosen in Settings, else the first one the server lists."""
    name = (settings.get("local_model") or "").strip()
    if name:
        return name
    found = local_models()          # an unreachable server reports itself here
    if not found:
        raise ClaudeError("Pick a model in Settings → AI (your local server didn't list any).")
    return found[0]


def current_model():
    """The model drafts use: a Claude model id, or "local:<name>" for a local model."""
    if is_local():
        return LOCAL_PREFIX + _local_model_name()
    return settings.get("recap_model") or DEFAULT_MODEL


def provider_name():
    return "your local model" if is_local() else "Claude"


def cost(model, input_tokens=0, output_tokens=0, cache_write=0, cache_read=0):
    """Dollars for some token counts, or None for a model we have no prices for. Local models are free."""
    if str(model or "").startswith(LOCAL_PREFIX):
        return 0.0
    p = PRICES.get(model)
    if not p:
        return None
    return round((input_tokens * p[0] + output_tokens * p[1] + cache_write * p[2] + cache_read * p[3]) / 1e6, 4)


def cost_of_usage(model, usage):
    """Dollars for a list of usage_of() results."""
    total = 0.0
    for u in usage or []:
        c = cost(model, u.get("input", 0), u.get("output", 0), u.get("cache_write", 0), u.get("cache_read", 0))
        if c is None:
            return None
        total += c
    return round(total, 4)


class ClaudeError(Exception):
    def __init__(self, msg="", status=None, detail=""):
        super().__init__(msg)
        self.status, self.detail = status, detail


def ready():
    """Raise if the chosen provider isn't set up."""
    if is_local():
        if not (settings.get("local_url") or "").strip():
            raise ClaudeError("Add your local model's server address in Settings → AI first.")
        return True
    return key()


def key():
    k = (settings.get("anthropic_api_key") or "").strip()
    if not k:
        raise ClaudeError("Add your Anthropic API key in Settings → Claude first.")
    return k


def estimate_tokens(text):
    """Rough count for showing an estimate before a job (about 3.6 characters per token for English prose)."""
    return int(len(text or "") / 3.6) + 1


_NO_FORCED_TOOLS = set()   # models that refused tool_choice "tool"/"any" this run: ask nicely instead


def message(model, system, messages, max_tokens=4096, tools=None, tool_choice=None, timeout=600, opener=None):
    """One Messages API call. `system` is a list of text blocks; mark big stable ones with "cache": True."""
    if is_local() or str(model or "").startswith(LOCAL_PREFIX):
        return _local_message(system, messages, max_tokens, tools, tool_choice, opener)
    model = model or DEFAULT_MODEL
    blocks = []
    for b in system:
        if isinstance(b, str):
            b = {"text": b}
        block = {"type": "text", "text": b["text"]}
        if b.get("cache"):
            block["cache_control"] = {"type": "ephemeral"}
        blocks.append(block)
    body = {"model": model, "max_tokens": max_tokens, "system": blocks, "messages": messages}
    if tools:
        body["tools"] = tools
    forced = (tool_choice or {}).get("type") in ("tool", "any")
    if tool_choice and not (forced and model in _NO_FORCED_TOOLS):
        body["tool_choice"] = tool_choice
    elif forced:
        return _ask_for_tool(body, tool_choice, opener, timeout)
    try:
        return _send(body, opener, timeout)
    except ClaudeError as e:
        # Some models (and extended thinking) don't allow forcing a tool. Ask for it in words instead.
        if forced and e.status == 400 and "tool_choice" in (e.detail or ""):
            _NO_FORCED_TOOLS.add(model)
            return _ask_for_tool(body, tool_choice, opener, timeout)
        raise


def _ask_for_tool(body, tool_choice, opener, timeout):
    """tool_choice "auto", with an instruction to call the tool; a JSON-only reply is accepted as the tool call."""
    name = tool_choice.get("name") or (body.get("tools") or [{}])[0].get("name", "")
    body = {**body, "tool_choice": {"type": "auto"},
            "system": body["system"] + [{"type": "text", "text": f"Answer only by calling the {name} tool. Don't reply in prose."}]}
    resp = _send(body, opener, timeout)
    if tool_input(resp, name) is None:
        data = _json_from_text(text_of(resp))
        if data is None:
            raise ClaudeError(f"Claude answered without filling in {name}. Try again, or pick another model in Settings → AI.")
        resp = {**resp, "content": (resp.get("content") or []) + [{"type": "tool_use", "id": "fallback", "name": name, "input": data}]}
    return resp


def _send(body, opener, timeout):
    req = urllib.request.Request(API, data=json.dumps(body).encode(), method="POST", headers={
        "x-api-key": key(), "anthropic-version": "2023-06-01", "content-type": "application/json",
        "user-agent": f"lore-studio/{__version__}",
    })
    opener = opener or urllib.request.urlopen
    last = None
    for attempt in range(4):
        try:
            with opener(req, timeout=timeout) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = json.loads(e.read().decode()).get("error", {}).get("message", "")
            except Exception:
                pass
            if e.code in (429, 500, 502, 503, 529) and attempt < 3:
                last = detail or f"HTTP {e.code}"
                time.sleep(4 * (attempt + 1))
                continue
            if e.code == 401:
                raise ClaudeError("Anthropic didn't accept the API key. Check it in Settings → Claude.", status=401) from None
            raise ClaudeError(f"Claude returned an error ({e.code}): {detail or e.reason}", status=e.code, detail=detail) from None
        except urllib.error.URLError as e:
            last = str(e.reason)
            if attempt < 3:
                time.sleep(3)
                continue
    raise ClaudeError(f"Couldn't reach Claude: {last}")


# ---- local models (OpenAI-compatible chat completions) -------------------------------------

def _local_base():
    return (settings.get("local_url") or "http://localhost:11434/v1").strip().rstrip("/")


def _local_headers():
    h = {"content-type": "application/json", "user-agent": f"lore-studio/{__version__}"}
    k = (settings.get("local_api_key") or "").strip()
    if k:
        h["authorization"] = f"Bearer {k}"
    return h


def _flat(content):
    if isinstance(content, str):
        return content
    return "\n\n".join(b.get("text", "") for b in content or [] if b.get("type", "text") == "text")


def _json_from_text(text):
    """A JSON object from a reply that should have been a tool call (```json fences, or the outermost braces)."""
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text or "", re.S)
    candidates = [m.group(1)] if m else []
    i, j = (text or "").find("{"), (text or "").rfind("}")
    if i != -1 and j > i:
        candidates.append(text[i:j + 1])
    for c in candidates:
        try:
            v = json.loads(c)
            if isinstance(v, dict):
                return v
        except ValueError:
            continue
    return None


def _strip_thinking(text):
    """Reasoning models (DeepSeek-R1, Qwen3...) may put their thinking in <think> tags; keep only the answer."""
    return re.sub(r"(?s)<think>.*?</think>\s*", "", text or "").strip()


# Local servers are on this PC or the local network: never send them through a system proxy.
_direct = urllib.request.build_opener(urllib.request.ProxyHandler({})).open


def _local_post(path, body, opener, timeout, url=None):
    req = urllib.request.Request(url or (_local_base() + path), data=json.dumps(body).encode(), method="POST", headers=_local_headers())
    opener = opener or _direct
    try:
        with opener(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            raw = e.read().decode()
            j = json.loads(raw)
            detail = (j.get("error") or {}).get("message", "") if isinstance(j.get("error"), dict) else str(j.get("error") or raw)
        except Exception:
            pass
        raise ClaudeError(f"Your local model returned an error ({e.code}): {detail or e.reason}") from None
    except urllib.error.URLError as e:
        raise ClaudeError(f"Couldn't reach your local model at {_local_base()}: {e.reason}. Is the server running?") from None


def local_context():
    try:
        return max(4096, int(settings.get("local_context") or 32768))
    except (TypeError, ValueError):
        return 32768


def local_max_out():
    """Longest reply to ask a local model for, leaving most of its context for the input."""
    return max(2048, min(8192, local_context() // 4))


# ---- Ollama's own API ---------------------------------------------------------------------
# Ollama's OpenAI-compatible endpoint can't set the context window, and Ollama silently cuts prompts that are longer
# than its default (often 4k-8k tokens). That cut is what makes a local recap describe the wrong things. So when the
# server is Ollama, Lore Studio uses Ollama's own /api/chat, which takes num_ctx with every request.

_ollama = {}


def _ollama_root():
    return re.sub(r"/v1/?$", "", _local_base())


def is_ollama():
    base = _local_base()
    if base not in _ollama:
        try:
            with _direct(urllib.request.Request(_ollama_root() + "/api/version", headers=_local_headers()), timeout=3) as r:
                _ollama[base] = "version" in json.loads(r.read().decode())
        except Exception:
            _ollama[base] = False
    return _ollama[base]


def _ollama_body(model, msgs, max_tokens, stream):
    return {"model": model, "messages": msgs, "stream": stream, "think": False,
            "options": {"num_ctx": local_context(), "num_predict": int(max_tokens)}}


def _ollama_chat(body, opener, timeout):
    """POST /api/chat, dropping options a model doesn't support (thinking, tools) and trying again."""
    url = _ollama_root() + "/api/chat"
    for _ in range(3):
        try:
            return _local_post(None, body, opener, timeout, url=url)
        except ClaudeError as e:
            msg = str(e).lower()
            if "think" in msg and "think" in body:
                body.pop("think")
            elif "tool" in msg and "tools" in body:
                body.pop("tools")
            else:
                raise
    return _local_post(None, body, opener, timeout, url=url)


def _prompt_tokens(msgs):
    return estimate_tokens("".join(m["content"] for m in msgs))


def _local_message(system, messages, max_tokens, tools, tool_choice, opener, timeout=3600):
    max_tokens = min(int(max_tokens), local_max_out())
    if opener is None and is_ollama():
        return _ollama_message(system, messages, max_tokens, tools, timeout)
    sys_text = "\n\n".join((b if isinstance(b, str) else b["text"]) for b in system)
    tool = tools[0] if tools else None
    if tool:
        sys_text += ("\n\nWhen you answer, call the function " + tool["name"] + ". If you can't call functions, reply with "
                     "only one JSON object that matches this JSON schema, and nothing else:\n" + json.dumps(tool["input_schema"]))
    msgs = [{"role": "system", "content": sys_text}] + [{"role": m["role"], "content": _flat(m["content"])} for m in messages]
    body = {"model": _local_model_name(), "messages": msgs,
            "max_tokens": int(max_tokens), "stream": False}
    if tool:
        body["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t.get("description", ""),
                                                          "parameters": t["input_schema"]}} for t in tools]
        if tool_choice and tool_choice.get("name"):
            body["tool_choice"] = {"type": "function", "function": {"name": tool_choice["name"]}}
    try:
        data = _local_post("/chat/completions", body, opener, timeout)
    except ClaudeError:
        if not tool:
            raise
        body.pop("tools", None)           # some servers refuse tools: fall back to plain JSON in the reply
        body.pop("tool_choice", None)
        data = _local_post("/chat/completions", body, opener, timeout)
    choice = (data.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    text = _strip_thinking(msg.get("content") or "")
    content = []
    for call in msg.get("tool_calls") or []:
        fn = call.get("function") or {}
        args = fn.get("arguments")
        if isinstance(args, str):
            args = _json_from_text(args) or {}
        content.append({"type": "tool_use", "name": fn.get("name"), "input": args or {}})
    if tool and not content:
        found = _json_from_text(text)
        if found is not None:
            content.append({"type": "tool_use", "name": tool["name"], "input": found})
    if text and not (tool and content):
        content.insert(0, {"type": "text", "text": text})
    u = data.get("usage") or {}
    sent, seen = _prompt_tokens(msgs), u.get("prompt_tokens", 0)
    return {"model": LOCAL_PREFIX + str(data.get("model") or body["model"]), "content": content,
            "stop_reason": "max_tokens" if choice.get("finish_reason") == "length" else "end_turn",
            "input_cut": bool(seen) and sent > seen * 1.4 + 300,
            "usage": {"input_tokens": seen, "output_tokens": u.get("completion_tokens", 0)}}


def _ollama_message(system, messages, max_tokens, tools, timeout):
    sys_text = "\n\n".join((b if isinstance(b, str) else b["text"]) for b in system)
    tool = tools[0] if tools else None
    if tool:
        sys_text += ("\n\nWhen you answer, call the function " + tool["name"] + ". If you can't call functions, reply with "
                     "only one JSON object that matches this JSON schema, and nothing else:\n" + json.dumps(tool["input_schema"]))
    msgs = [{"role": "system", "content": sys_text}] + [{"role": m["role"], "content": _flat(m["content"])} for m in messages]
    body = _ollama_body(_local_model_name(), msgs, max_tokens, False)
    if tool:
        body["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t.get("description", ""),
                                                          "parameters": t["input_schema"]}} for t in tools]
    data = _ollama_chat(body, None, timeout)
    msg = data.get("message") or {}
    text = _strip_thinking(msg.get("content") or "")
    content = []
    for call in msg.get("tool_calls") or []:
        fn = call.get("function") or {}
        args = fn.get("arguments")
        if isinstance(args, str):
            args = _json_from_text(args) or {}
        content.append({"type": "tool_use", "name": fn.get("name"), "input": args or {}})
    if tool and not content:
        found = _json_from_text(text)
        if found is not None:
            content.append({"type": "tool_use", "name": tool["name"], "input": found})
    if text and not (tool and content):
        content.insert(0, {"type": "text", "text": text})
    sent, seen = _prompt_tokens(msgs), data.get("prompt_eval_count") or 0
    return {"model": LOCAL_PREFIX + str(data.get("model") or body["model"]), "content": content,
            "stop_reason": "max_tokens" if data.get("done_reason") == "length" else "end_turn",
            "input_cut": bool(seen) and sent > seen * 1.4 + 300,
            "usage": {"input_tokens": seen, "output_tokens": data.get("eval_count", 0)}}


def local_models(url=None, api_key=None):
    """The models a local server offers (GET /models)."""
    base = (url or _local_base()).strip().rstrip("/")
    h = _local_headers()
    if api_key:
        h["authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(base + "/models", headers=h)
    try:
        with _direct(req, timeout=10) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise ClaudeError(f"The server at {base} answered {e.code}. Check the address (it usually ends in /v1).") from None
    except (urllib.error.URLError, OSError) as e:
        raise ClaudeError(f"Couldn't reach {base}: {getattr(e, 'reason', e)}. Is the server running?") from None
    return sorted({m.get("id") for m in data.get("data") or [] if m.get("id")})


# ---- streaming (chat) ---------------------------------------------------------------

def _sse(resp, stop):
    """JSON objects from a text/event-stream response, until it ends or stop() says so."""
    while True:
        if stop and stop():
            return
        line = resp.readline()
        if not line:
            return
        line = line.decode("utf-8", "replace").strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            return
        try:
            yield json.loads(data)
        except ValueError:
            continue


def stream(system, messages, on_text, max_tokens=4096, stop=None, on_thinking=None, timeout=600):
    """Stream one reply. on_text(chunk) gets text as it arrives; on_thinking() is called while a reasoning model
    thinks. Returns {"text", "usage", "model", "stop_reason"}. Uses the provider chosen in Settings -> AI."""
    model = current_model()
    if model.startswith(LOCAL_PREFIX) and is_ollama():
        return _ollama_stream(model, system, messages, on_text, min(int(max_tokens), local_max_out()), stop, on_thinking, timeout)
    if model.startswith(LOCAL_PREFIX):
        max_tokens = min(int(max_tokens), local_max_out())
        sys_text = "\n\n".join((b if isinstance(b, str) else b["text"]) for b in system)
        body = {"model": model[len(LOCAL_PREFIX):], "stream": True, "max_tokens": max_tokens,
                "messages": [{"role": "system", "content": sys_text}] + [{"role": m["role"], "content": _flat(m["content"])} for m in messages],
                "stream_options": {"include_usage": True}}
        req = urllib.request.Request(_local_base() + "/chat/completions", data=json.dumps(body).encode(), method="POST", headers=_local_headers())
        opener = _direct
    else:
        blocks = []
        for b in system:
            b = {"text": b} if isinstance(b, str) else b
            blk = {"type": "text", "text": b["text"]}
            if b.get("cache"):
                blk["cache_control"] = {"type": "ephemeral"}
            blocks.append(blk)
        body = {"model": model, "max_tokens": max_tokens, "system": blocks, "messages": messages, "stream": True}
        req = urllib.request.Request(API, data=json.dumps(body).encode(), method="POST", headers={
            "x-api-key": key(), "anthropic-version": "2023-06-01", "content-type": "application/json",
            "user-agent": f"lore-studio/{__version__}"})
        opener = urllib.request.urlopen
    text, usage, stop_reason = [], {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}, "end_turn"
    try:
        with opener(req, timeout=timeout) as r:
            for ev in _sse(r, stop):
                if model.startswith(LOCAL_PREFIX):
                    for ch in ev.get("choices") or []:
                        d = ch.get("delta") or {}
                        if (d.get("reasoning") or d.get("reasoning_content")) and on_thinking:
                            on_thinking()
                        if d.get("content"):
                            text.append(d["content"])
                            on_text(d["content"])
                        if ch.get("finish_reason") == "length":
                            stop_reason = "max_tokens"
                    u = ev.get("usage") or {}
                    if u:
                        usage["input"], usage["output"] = u.get("prompt_tokens", 0), u.get("completion_tokens", 0)
                else:
                    t = ev.get("type")
                    if t == "content_block_delta" and (ev.get("delta") or {}).get("type") == "text_delta":
                        chunk = ev["delta"]["text"]
                        text.append(chunk)
                        on_text(chunk)
                    elif t == "message_start":
                        u = (ev.get("message") or {}).get("usage") or {}
                        usage.update({"input": u.get("input_tokens", 0), "cache_read": u.get("cache_read_input_tokens", 0),
                                      "cache_write": u.get("cache_creation_input_tokens", 0)})
                    elif t == "message_delta":
                        usage["output"] = (ev.get("usage") or {}).get("output_tokens", usage["output"])
                        stop_reason = (ev.get("delta") or {}).get("stop_reason") or stop_reason
                    elif t == "error":
                        raise ClaudeError(f"Claude returned an error: {(ev.get('error') or {}).get('message', 'unknown')}")
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            j = json.loads(e.read().decode())
            detail = (j.get("error") or {}).get("message", "") if isinstance(j.get("error"), dict) else str(j.get("error") or "")
        except Exception:
            pass
        if e.code == 401 and not model.startswith(LOCAL_PREFIX):
            raise ClaudeError("Anthropic didn't accept the API key. Check it in Settings → AI.") from None
        who = "Your local model" if model.startswith(LOCAL_PREFIX) else "Claude"
        raise ClaudeError(f"{who} returned an error ({e.code}): {detail or e.reason}") from None
    except urllib.error.URLError as e:
        if model.startswith(LOCAL_PREFIX):
            raise ClaudeError(f"Couldn't reach your local model at {_local_base()}: {e.reason}. Is the server running?") from None
        raise ClaudeError(f"Couldn't reach Claude: {e.reason}") from None
    return {"text": "".join(text), "usage": usage, "model": model, "stop_reason": stop_reason}


def _ollama_stream(model, system, messages, on_text, max_tokens, stop, on_thinking, timeout):
    sys_text = "\n\n".join((b if isinstance(b, str) else b["text"]) for b in system)
    msgs = [{"role": "system", "content": sys_text}] + [{"role": m["role"], "content": _flat(m["content"])} for m in messages]
    body = _ollama_body(model[len(LOCAL_PREFIX):], msgs, max_tokens, True)
    url = _ollama_root() + "/api/chat"
    text, usage, stop_reason = [], {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}, "end_turn"
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers=_local_headers())
            with _direct(req, timeout=timeout) as r:
                while True:
                    if stop and stop():
                        break
                    line = r.readline()
                    if not line:
                        break
                    try:
                        ev = json.loads(line)
                    except ValueError:
                        continue
                    if ev.get("error"):
                        raise ClaudeError(f"Your local model returned an error: {ev['error']}")
                    m = ev.get("message") or {}
                    if m.get("thinking") and on_thinking:
                        on_thinking()
                    if m.get("content"):
                        text.append(m["content"])
                        on_text(m["content"])
                    if ev.get("done"):
                        usage["input"], usage["output"] = ev.get("prompt_eval_count", 0), ev.get("eval_count", 0)
                        stop_reason = "max_tokens" if ev.get("done_reason") == "length" else "end_turn"
            break
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = json.loads(e.read().decode()).get("error", "")
            except Exception:
                pass
            if attempt == 0 and "think" in str(detail).lower():
                body.pop("think", None)
                continue
            raise ClaudeError(f"Your local model returned an error ({e.code}): {detail or e.reason}") from None
        except urllib.error.URLError as e:
            raise ClaudeError(f"Couldn't reach your local model at {_local_base()}: {e.reason}. Is the server running?") from None
    return {"text": "".join(text), "usage": usage, "model": model, "stop_reason": stop_reason}


def text_of(resp):
    return "".join(b.get("text", "") for b in resp.get("content") or [] if b.get("type") == "text").strip()


def tool_input(resp, name):
    for b in resp.get("content") or []:
        if b.get("type") == "tool_use" and b.get("name") == name:
            return b.get("input") or {}
    return None


def usage_of(resp):
    u = resp.get("usage") or {}
    return {"input": u.get("input_tokens", 0), "output": u.get("output_tokens", 0),
            "cache_read": u.get("cache_read_input_tokens", 0), "cache_write": u.get("cache_creation_input_tokens", 0)}


def test():
    resp = message(current_model(), ["Reply with one short sentence."],
                   [{"role": "user", "content": "Say hello to a game master."}], max_tokens=400 if is_local() else 60, timeout=60)
    model = str(resp.get("model") or "")
    return {"ok": True, "reply": text_of(resp), "model": model[len(LOCAL_PREFIX):] if model.startswith(LOCAL_PREFIX) else model}
