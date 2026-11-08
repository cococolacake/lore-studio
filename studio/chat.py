"""Chat with the AI about the campaign (Claude or a local model, whichever Settings -> AI uses).

Each message is answered with the campaign in view: the landing page and party, the latest session recaps,
open loose threads, and the lore pages the conversation mentions or that match its words. Conversations are
saved in the campaign folder (chats/<id>.json). Replies stream: the UI polls chat_poll() while one is written.
"""
import re
import threading
import time
import uuid

from . import claude, recaps
from .util import read_json, write_json

STOP = set("""a an and are as at be but by can could did do does for from had has have he her his how i if in into is it its
just me my no not of on or our she so some than that the their them then there these they this to up us was we were what
when where which who why will with would you your about any did know tell more like also been was what's who's""".split())

PAGE_CHARS = 3500          # per lore page
LORE_CHARS = 40000         # all lore pages together (Claude); local models get a share of their context
_jobs = {}
_lock = threading.Lock()


def _dir(camp):
    d = camp.root / "chats"
    d.mkdir(exist_ok=True)
    return d


def _path(camp, cid):
    if not re.fullmatch(r"[\w-]{4,64}", cid or ""):
        raise ValueError("Bad chat id.")
    return _dir(camp) / f"{cid}.json"


def list_chats(camp):
    out = []
    for f in _dir(camp).glob("*.json"):
        c = read_json(f, None)
        if c:
            out.append({"id": c["id"], "title": c.get("title") or "New chat", "updated": c.get("updated", ""),
                        "count": len(c.get("messages") or [])})
    return sorted(out, key=lambda c: c["updated"], reverse=True)


def read(camp, cid):
    c = read_json(_path(camp, cid), None)
    if not c:
        raise ValueError("That chat doesn't exist anymore.")
    return c


def create(camp, player_safe=False):
    cid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    now = time.strftime("%Y-%m-%d %H:%M")
    c = {"id": cid, "title": "New chat", "created": now, "updated": now, "player_safe": bool(player_safe), "messages": []}
    write_json(_path(camp, cid), c)
    return c


def update(camp, cid, patch):
    c = read(camp, cid)
    for k in ("title", "player_safe"):
        if k in (patch or {}):
            c[k] = patch[k]
    write_json(_path(camp, cid), c)
    return c


def delete(camp, cid):
    f = _path(camp, cid)
    trash = camp.root / ".trash" / time.strftime("%Y%m%d-%H%M%S") / "chats"
    trash.mkdir(parents=True, exist_ok=True)
    if f.exists():
        f.replace(trash / f.name)
    return True


def truncate(camp, cid, index):
    """Drop message `index` and everything after it (to edit a question or try a reply again)."""
    c = read(camp, cid)
    c["messages"] = c["messages"][:max(0, int(index))]
    write_json(_path(camp, cid), c)
    return c


# ---- context ---------------------------------------------------------------------------

def _words(text):
    return {w for w in re.findall(r"[a-z][a-z'-]{2,}", (text or "").lower()) if w not in STOP}


def find_pages(camp, text, player_safe, budget):
    """Lore pages for the conversation: ones it names (by title, alias or first name), then ones whose words match."""
    named = {}
    names = camp.link_names()
    if names and text:
        rx = re.compile(r"(?<![\w])(" + "|".join(re.escape(n) for n, _ in sorted(names, key=lambda x: -len(x[0]))) + r")(?![\w])", re.I)
        lower = {n.lower(): pid for n, pid in names}
        for m in rx.finditer(text):
            pid = lower.get(m.group(1).lower())
            if pid:
                named[pid] = named.get(pid, 0) + 10
    words = _words(text)
    scores = dict(named)
    pages = {p["id"]: p for p in camp.pages()}
    if words:
        for pid, p in pages.items():
            title_words = _words(p["title"] + " " + " ".join(p.get("aliases") or []) + " " + " ".join(p.get("tags") or []))
            body_words = _words(p["body"][:6000])
            s = 3 * len(words & title_words) + len(words & body_words)
            if s >= 2 or (s and len(words) <= 2):
                scores[pid] = scores.get(pid, 0) + s
    out, used, ids = [], 0, []
    for pid, _ in sorted(scores.items(), key=lambda kv: -kv[1]):
        p = pages.get(pid)
        if not p or (player_safe and p.get("visibility") == "gm"):
            continue
        body = recaps.strip_gm(p["body"]) if player_safe else p["body"]
        body = recaps._cut(re.sub(r"\{\{\w+\}\}", "", body), PAGE_CHARS)
        if used + len(body) > budget:
            continue
        used += len(body)
        out.append((p["title"], body))
        ids.append(pid)
        if len(out) >= 12:
            break
    return out, ids


def _recent_recaps(camp, player_safe, chars):
    out = []
    for s in reversed(camp.sessions()):
        if len(out) >= 3:
            break
        text = ""
        if player_safe:
            text = camp.player_recap(s["id"]) or recaps.strip_gm(camp.read_session(s["id"])["recap"])
        else:
            text = camp.read_session(s["id"])["recap"]
        if text.strip():
            out.append(f"### Session {s['number']}: {s['title']}" + (f" ({s['date']})" if s.get("date") else "") + "\n"
                       + recaps._cut(text, chars))
    return "\n\n".join(reversed(out))


def _session_list(camp):
    return "\n".join(f"- Session {s['number']}: {s['title']}" + (f" ({s['date']})" if s.get("date") else "")
                     + (" [planned]" if s["status"] == "planned" else "") for s in camp.sessions()) or "(none yet)"


def system_prompt(camp, player_safe, question_text):
    local = claude.is_local()
    ctx = claude.local_context() if local else 200000
    lore_budget = min(LORE_CHARS, int(ctx * 0.3 * 3.6)) if local else LORE_CHARS
    pages, ids = find_pages(camp, question_text, player_safe, lore_budget)
    threads = [t for t in camp.threads() if t["status"] == "open"]
    thread_text = "\n".join(f"- {t['title']}" + (f": {t['detail']}" if t.get("detail") else "") for t in threads[:30]) or "(none)"
    recap_chars = int(ctx * 0.06 * 3.6) if local else 6000
    who = ("You are talking with a PLAYER of this campaign, so never reveal GM-only secrets, hidden plans or anything not "
           "in the material below; if asked, say it's something the GM hasn't revealed."
           if player_safe else
           "You are talking with the GAME MASTER, who knows every secret. GM-only material is fine to discuss.")
    text = (recaps.primer(camp, player_safe).split("## About the transcripts")[0]
            + "## How to help\n"
            f"{who} Help them remember, plan and improvise: answer questions about the world and what happened, brainstorm "
            "scenes, NPCs, names, encounters and twists that fit the established lore, and point out connections. "
            "Ground answers in the material below. When something isn't in it, say so plainly, and if you invent something, "
            "say it's a suggestion. Refer to lore pages as [[Page title]] so they become links. Use Markdown. Be concise "
            "unless asked for detail.\n\n"
            f"## Sessions so far\n{_session_list(camp)}\n\n"
            f"## The latest session recaps\n{_recent_recaps(camp, player_safe, recap_chars) or '(no recaps yet)'}\n\n"
            f"## Open loose threads\n{thread_text}\n\n"
            f"## Lore pages that match the conversation\n{recaps._lore_block(pages) if pages else '(none matched; ask about a name to pull its page in)'}")
    return text, ids


def _history(messages, budget_chars):
    """The latest messages that fit, oldest first; always starts with a user message."""
    out, used = [], 0
    for m in reversed(messages):
        n = len(m["content"])
        if out and used + n > budget_chars:
            break
        out.append({"role": m["role"], "content": m["content"]})
        used += n
    out.reverse()
    while out and out[0]["role"] != "user":
        out.pop(0)
    return out


def _visible(raw):
    """Hide a reasoning model's <think> blocks while streaming; True while it's still thinking."""
    shown = re.sub(r"(?s)<think>.*?</think>\s*", "", raw)
    thinking = "<think>" in shown
    if thinking:
        shown = shown[:shown.index("<think>")]
    return shown.lstrip(), thinking


def send(camp, cid, text):
    """Add the user's message and start writing the reply in the background."""
    text = (text or "").strip()
    if not text:
        raise ValueError("Type a message first.")
    claude.ready()
    with _lock:
        if cid in _jobs and not _jobs[cid]["done"]:
            raise ValueError("Still writing the last reply.")
    c = read(camp, cid)
    c["messages"].append({"role": "user", "content": text, "time": time.strftime("%Y-%m-%d %H:%M")})
    if c.get("title") in (None, "", "New chat"):
        c["title"] = recaps._cut(re.sub(r"\s+", " ", text), 60)
    c["updated"] = time.strftime("%Y-%m-%d %H:%M")
    write_json(_path(camp, cid), c)
    return _start(camp, c)


def regenerate(camp, cid):
    """Write the last reply again."""
    c = read(camp, cid)
    while c["messages"] and c["messages"][-1]["role"] == "assistant":
        c["messages"].pop()
    if not c["messages"]:
        raise ValueError("Nothing to answer yet.")
    write_json(_path(camp, cid), c)
    return _start(camp, c)


def _start(camp, c):
    cid = c["id"]
    job = {"raw": "", "text": "", "thinking": False, "done": False, "error": None, "stop": False, "started": time.time()}
    with _lock:
        _jobs[cid] = job

    def run():
        try:
            recent = " ".join(m["content"] for m in c["messages"][-6:])
            system, ids = system_prompt(camp, c.get("player_safe"), recent)
            hist_chars = int(claude.local_context() * 0.35 * 3.6) if claude.is_local() else 120000
            msgs = _history(c["messages"], hist_chars)

            def on_text(chunk):
                job["raw"] += chunk
                job["text"], job["thinking"] = _visible(job["raw"])

            def on_thinking():
                job["thinking"] = True

            res = claude.stream([{"text": system, "cache": True}], msgs, on_text, max_tokens=4000,
                                stop=lambda: job["stop"], on_thinking=on_thinking)
            answer, _ = _visible(res["text"])
            answer = re.sub(r"(?s)<think>.*$", "", answer).strip()
            if job["stop"]:
                answer = (answer + "\n\n*(stopped)*").strip()
            if not answer:
                raise claude.ClaudeError("The model didn't write an answer. A bigger context size or reply length may help.")
            usage = res["usage"]
            fresh = read(camp, cid)
            fresh["messages"].append({"role": "assistant", "content": answer, "time": time.strftime("%Y-%m-%d %H:%M"),
                                      "model": res["model"], "pages": ids,
                                      "cost": claude.cost_of_usage(res["model"], [usage]),
                                      "cut": res.get("stop_reason") == "max_tokens"})
            fresh["updated"] = time.strftime("%Y-%m-%d %H:%M")
            write_json(_path(camp, cid), fresh)
            job["text"] = answer
        except Exception as e:  # shown in the chat
            job["error"] = str(e)
        finally:
            job["done"] = True

    threading.Thread(target=run, daemon=True).start()
    return {"started": True}


def poll(cid):
    job = _jobs.get(cid)
    if not job:
        return {"active": False}
    out = {"active": not job["done"], "text": job["text"], "thinking": job["thinking"] and not job["text"],
           "error": job["error"], "seconds": round(time.time() - job["started"])}
    if job["done"]:
        with _lock:
            _jobs.pop(cid, None)
    return out


def stop(cid):
    job = _jobs.get(cid)
    if job:
        job["stop"] = True
    return True
