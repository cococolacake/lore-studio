"""Progress clocks: what factions, villains and looming threats are doing off-screen.

Stored in <campaign>/clocks.json. A clock has a number of segments and how many are filled; every tick is kept in
its history with the session and in-world date it happened on.
"""
import time
import uuid

from .campaign import CampaignError
from .util import read_json, write_json

KINDS = ["faction", "threat", "project", "countdown", "other"]


def _file(camp):
    return camp.root / "clocks.json"


def all_clocks(camp):
    return read_json(_file(camp), []) or []


def _save(camp, clocks):
    write_json(_file(camp), clocks)


def get(camp, cid):
    c = next((c for c in all_clocks(camp) if c["id"] == cid), None)
    if not c:
        raise CampaignError("That clock doesn't exist anymore.")
    return c


def save(camp, clock):
    """Create (no id) or update a clock's settings."""
    clocks = all_clocks(camp)
    segs = max(2, min(24, int(clock.get("segments") or 6)))
    clean = {"name": str(clock.get("name") or "").strip()[:80] or "New clock", "segments": segs,
             "kind": clock.get("kind") if clock.get("kind") in KINDS else "faction",
             "page": clock.get("page") or None, "color": str(clock.get("color") or "#E5626A")[:9],
             "gm": bool(clock.get("gm", True)), "note": str(clock.get("note") or "")[:2000],
             "when_full": str(clock.get("when_full") or "")[:1000], "archived": bool(clock.get("archived"))}
    if clock.get("id"):
        for c in clocks:
            if c["id"] == clock["id"]:
                c.update(clean)
                c["filled"] = min(c.get("filled", 0), segs)
                break
        else:
            raise CampaignError("That clock doesn't exist anymore.")
    else:
        clean.update({"id": "c" + uuid.uuid4().hex[:8], "filled": max(0, min(segs, int(clock.get("filled") or 0))),
                      "history": [], "created": time.strftime("%Y-%m-%d %H:%M")})
        clocks.append(clean)
    _save(camp, clocks)
    return get(camp, clock.get("id") or clean["id"])


def tick(camp, cid, delta=1, note="", session=None, world_date=None, world_label=""):
    """Move a clock forward (or back). Returns the clock and whether this tick filled it."""
    clocks = all_clocks(camp)
    c = next((c for c in clocks if c["id"] == cid), None)
    if not c:
        raise CampaignError("That clock doesn't exist anymore.")
    before = c.get("filled", 0)
    c["filled"] = max(0, min(c["segments"], before + int(delta)))
    if c["filled"] == before:
        return {"clock": c, "filled_now": False}
    c.setdefault("history", []).append({"time": time.strftime("%Y-%m-%d %H:%M"), "delta": c["filled"] - before, "to": c["filled"],
                                        "note": str(note or "")[:500], "session": session, "world_date": world_date,
                                        "world_label": world_label})
    filled_now = c["filled"] == c["segments"] and before < c["segments"]
    if filled_now:
        c["completed"] = time.strftime("%Y-%m-%d %H:%M")
    elif c["filled"] < c["segments"]:
        c.pop("completed", None)
    _save(camp, clocks)
    return {"clock": c, "filled_now": filled_now}


def delete(camp, cid):
    _save(camp, [c for c in all_clocks(camp) if c["id"] != cid])
    return True


def for_page(camp, pid):
    return [c for c in all_clocks(camp) if c.get("page") == pid and not c.get("archived")]


def prompt_text(camp, player_safe=False):
    """Active clocks, for the AI primer."""
    lines = []
    for c in all_clocks(camp):
        if c.get("archived") or (player_safe and c.get("gm")):
            continue
        last = (c.get("history") or [{}])[-1].get("note", "")
        lines.append(f"- {c['name']} ({c['kind']}): {c['filled']}/{c['segments']}"
                     + (f". {c['note']}" if c.get("note") else "")
                     + (f" When full: {c['when_full']}" if c.get("when_full") and not player_safe else "")
                     + (f" Last tick: {last}" if last else ""))
    return "\n".join(lines)
