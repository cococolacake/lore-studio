"""Foundry VTT bridge: a small Foundry module (foundry/lore-studio-bridge) talks to Lore Studio over HTTP on localhost.

Foundry -> Lore Studio   POST /foundry/events   chat, rolls, combat turns and scene changes, saved to the
                                                session being played as foundry-log.jsonl
Lore Studio -> Foundry   GET  /foundry/outbox   journal entries to create or update (lore pages, player recaps)

Every request carries the token from Settings -> Foundry. The module runs in a GM's browser on the same PC.
"""
import json
import os
import re
import secrets
import shutil
import threading
import time
from pathlib import Path

from . import plans, settings
from .paths import APP_DIR

MODULE_DIR = APP_DIR / "foundry" / "lore-studio-bridge"
_lock = threading.Lock()
_outbox = []
_status = {"last_seen": 0, "events": 0, "world": "", "user": "", "foundry": "", "system": ""}


def token():
    t = settings.get("foundry_token")
    if not t:
        t = secrets.token_urlsafe(18)
        settings.save({"foundry_token": t})
    return t


def check(t):
    return bool(t) and secrets.compare_digest(str(t), token())


def status():
    s = dict(_status)
    s["connected"] = bool(s["last_seen"]) and time.time() - s["last_seen"] < 20
    s["queued"] = len(_outbox)
    return s


def touch():
    _status["last_seen"] = time.time()


def hello(info):
    _status.update({k: str(info.get(k, ""))[:80] for k in ("world", "user", "foundry", "system")})
    _status["last_seen"] = time.time()


def log_events(camp, sid, events):
    """Append events to the session's foundry-log.jsonl."""
    _status["last_seen"] = time.time()
    if not camp or not sid or not events:
        return 0
    f = camp.session_dir(sid) / "foundry-log.jsonl"
    with _lock, open(f, "a", encoding="utf-8") as out:
        for ev in events[:500]:
            clean = {k: v for k, v in ev.items() if k in ("type", "time", "speaker", "author", "text", "flavor", "rolls",
                                                            "whisper", "round", "turn", "combatant", "scene")}
            if isinstance(clean.get("text"), str):
                clean["text"] = clean["text"][:600]
            out.write(json.dumps(clean, ensure_ascii=False) + "\n")
    _status["events"] += len(events)
    return len(events)


def read_log(camp, sid, limit=None):
    f = camp.session_dir(sid) / "foundry-log.jsonl"
    if not f.exists():
        return []
    out = []
    for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out[-limit:] if limit else out


def _ts(iso):
    """Seconds since the epoch for an ISO time; times without a zone are local (Foundry sends UTC with Z)."""
    from datetime import datetime
    d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    return d.timestamp()


def log_text(camp, sid, max_lines=400):
    """The Foundry log as lines for Claude, stamped with recording time when the recording start is known."""
    events = read_log(camp, sid)
    if not events:
        return ""
    started = (camp.read_recording(sid).get("live_started") or "")
    t0 = None
    if started:
        try:
            t0 = time.mktime(time.strptime(started, "%Y-%m-%d %H:%M:%S"))
        except ValueError:
            t0 = None
    lines = []
    for ev in events:
        stamp = ev.get("time", "")
        if t0 and ev.get("time"):
            try:
                t = _ts(ev["time"]) - t0
                if t >= 0:
                    stamp = f"{int(t) // 3600:02d}:{int(t) % 3600 // 60:02d}:{int(t) % 60:02d}"
            except ValueError:
                pass
        kind = ev.get("type")
        who = ev.get("speaker") or ev.get("author") or "?"
        if ev.get("whisper"):
            who += " (whispered, GM-only)"
        if kind == "roll":
            rolls = ", ".join(f"{r.get('formula')} = {r.get('total')}" for r in ev.get("rolls") or [])
            lines.append(f"[{stamp}] {who} rolled {rolls}" + (f" ({ev['flavor']})" if ev.get("flavor") else ""))
        elif kind == "chat":
            lines.append(f"[{stamp}] {who} (chat): {ev.get('text', '')}")
        elif kind == "combat":
            lines.append(f"[{stamp}] Combat round {ev.get('round')}, {ev.get('combatant') or 'turn ' + str(ev.get('turn'))}")
        elif kind == "scene":
            lines.append(f"[{stamp}] Foundry scene: {ev.get('scene')}")
    return "\n".join(lines[-max_lines:])


# ---- outbox --------------------------------------------------------------------

def md_to_html(md, player_safe=True):
    """Lore Studio Markdown -> plain HTML for a Foundry journal page."""
    md = (md or "").replace("\r\n", "\n")
    if player_safe:
        md = re.sub(r"(?ms)^:::[ \t]*gm\b.*?^:::[ \t]*$\n?", "", md)
    md = re.sub(r"\{\{\s*\w+\s*\}\}", "", md)
    md = re.sub(r"\{t:\d{1,2}:\d{2}:\d{2}\}\s?", "", md)
    md = re.sub(r"(?m)^#{1,2}\s+", "### ", md)
    out, pos = [], 0
    # :::callout / :::gm / :::note blocks become blockquotes; everything else is ordinary Markdown
    for m in re.finditer(r"(?ms)^:::[ \t]*(\w*)[^\n]*\n(.*?)^:::[ \t]*$", md):
        out.append(plans.blocks_plain(md[pos:m.start()]))
        label = "<p><b>GM only</b></p>" if m.group(1) == "gm" else ""
        out.append(f"<blockquote>{label}{plans.blocks_plain(m.group(2))}</blockquote>")
        pos = m.end()
    out.append(plans.blocks_plain(md[pos:]))
    return "".join(out)


def push_journal(key, name, html, share=True, folder="Lore Studio"):
    with _lock:
        _outbox[:] = [a for a in _outbox if a.get("key") != key]
        _outbox.append({"type": "journal", "key": key, "name": name, "html": html, "share": bool(share), "folder": folder})
    return len(_outbox)


def take_outbox():
    with _lock:
        out = list(_outbox)
        _outbox.clear()
    return out


# ---- installing the module ---------------------------------------------------------

def default_data_dirs():
    home = Path.home()
    out = []
    if os.name == "nt":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            out.append(Path(local) / "FoundryVTT" / "Data")
    else:
        out += [home / ".local" / "share" / "FoundryVTT" / "Data", home / "foundrydata" / "Data"]
    return [str(p) for p in out if p.is_dir()]


def install_module(data_dir):
    d = Path(data_dir).expanduser()
    if d.name.lower() != "data" and (d / "Data").is_dir():
        d = d / "Data"
    if not (d / "modules").is_dir() and not (d / "worlds").is_dir():
        raise ValueError("That doesn't look like Foundry's Data folder (it should contain modules and worlds).")
    dest = d / "modules" / "lore-studio-bridge"
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(MODULE_DIR, dest)
    return str(dest)


def module_version():
    try:
        return json.loads((MODULE_DIR / "module.json").read_text(encoding="utf-8")).get("version", "")
    except (OSError, ValueError):
        return ""
