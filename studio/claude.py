"""A small client for the Anthropic Messages API (standard library only).

The key is the user's own, stored in Lore Studio's app-data settings, never in the campaign folder.
"""
import json
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


def cost(model, input_tokens=0, output_tokens=0, cache_write=0, cache_read=0):
    """Dollars for some token counts, or None for a model we have no prices for."""
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
    pass


def key():
    k = (settings.get("anthropic_api_key") or "").strip()
    if not k:
        raise ClaudeError("Add your Anthropic API key in Settings → Claude first.")
    return k


def estimate_tokens(text):
    """Rough count for showing an estimate before a job (about 3.6 characters per token for English prose)."""
    return int(len(text or "") / 3.6) + 1


def message(model, system, messages, max_tokens=4096, tools=None, tool_choice=None, timeout=600, opener=None):
    """One Messages API call. `system` is a list of text blocks; mark big stable ones with "cache": True."""
    blocks = []
    for b in system:
        if isinstance(b, str):
            b = {"text": b}
        block = {"type": "text", "text": b["text"]}
        if b.get("cache"):
            block["cache_control"] = {"type": "ephemeral"}
        blocks.append(block)
    body = {"model": model or DEFAULT_MODEL, "max_tokens": max_tokens, "system": blocks, "messages": messages}
    if tools:
        body["tools"] = tools
    if tool_choice:
        body["tool_choice"] = tool_choice
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
                raise ClaudeError("Anthropic didn't accept the API key. Check it in Settings → Claude.") from None
            raise ClaudeError(f"Claude returned an error ({e.code}): {detail or e.reason}") from None
        except urllib.error.URLError as e:
            last = str(e.reason)
            if attempt < 3:
                time.sleep(3)
                continue
    raise ClaudeError(f"Couldn't reach Claude: {last}")


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
    resp = message(settings.get("recap_model") or DEFAULT_MODEL, ["Reply with one short sentence."],
                   [{"role": "user", "content": "Say hello to a game master."}], max_tokens=60, timeout=60)
    return {"ok": True, "reply": text_of(resp), "model": resp.get("model")}
