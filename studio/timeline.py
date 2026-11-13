"""The campaign timeline: lanes of blocks (events and spans) placed on the in-world calendar.

Stored in <campaign>/timeline.json. Dates are calendar dates {"y", "m", "d"}; "m"/"d" may be left out for a block
that's only known to the year. Sessions with an in-world date show up on their own lane by themselves.
A LegendKeeper timeline (timeline.legendkeeper.json from the importer) is converted the first time it's opened.
"""
import uuid

from . import worldcal
from .campaign import CampaignError
from .util import read_json, write_json

COLORS = ["#9381FF", "#E5626A", "#F0A04B", "#4FB477", "#4A90E2", "#B06AD9", "#3FA9A3", "#E9C64A"]


def _file(camp):
    return camp.root / "timeline.json"


def calendar_for(camp):
    """The campaign calendar, or a plain Gregorian one for the arithmetic when there isn't one."""
    return worldcal.read(camp) or worldcal.normalize(worldcal.blank("gregorian"))


def read(camp):
    data = read_json(_file(camp), None)
    if data is None:
        data = {"lanes": [{"id": "l" + uuid.uuid4().hex[:6], "name": "World history", "color": COLORS[0]}], "blocks": []}
        lk = read_json(camp.root / "timeline.legendkeeper.json", None)
        if lk:
            data = from_legendkeeper(camp, lk)
        write_json(_file(camp), data)
    return data


def _date(d, cal):
    if not d:
        return None
    y = int(d["y"])
    if d.get("m") is None:
        return {"y": y}
    m = max(0, min(len(cal["months"]) - 1, int(d["m"])))
    if d.get("d") is None:
        return {"y": y, "m": m}
    return worldcal.clamp(cal, {"y": y, "m": m, "d": int(d["d"])})


def save_block(camp, block):
    data = read(camp)
    cal = calendar_for(camp)
    lanes = {l["id"] for l in data["lanes"]}
    clean = {"title": str(block.get("title") or "").strip()[:160] or "Untitled", "lane": block.get("lane") if block.get("lane") in lanes else data["lanes"][0]["id"],
             "start": _date(block.get("start"), cal), "end": _date(block.get("end"), cal),
             "page": block.get("page") or None, "color": str(block.get("color") or "")[:9], "gm": bool(block.get("gm")),
             "note": str(block.get("note") or "")[:2000]}
    if not clean["start"]:
        raise CampaignError("A block needs a date.")
    if clean["end"] and day(cal, clean["end"], True) < day(cal, clean["start"]):
        clean["start"], clean["end"] = clean["end"], clean["start"]
    if block.get("id"):
        for b in data["blocks"]:
            if b["id"] == block["id"]:
                b.update(clean)
                break
        else:
            raise CampaignError("That block doesn't exist anymore.")
        bid = block["id"]
    else:
        bid = "b" + uuid.uuid4().hex[:8]
        data["blocks"].append({"id": bid, **clean})
    write_json(_file(camp), data)
    return next(b for b in data["blocks"] if b["id"] == bid)


def delete_block(camp, bid):
    data = read(camp)
    data["blocks"] = [b for b in data["blocks"] if b["id"] != bid]
    write_json(_file(camp), data)
    return True


def save_lanes(camp, lanes):
    data = read(camp)
    clean = [{"id": l.get("id") or "l" + uuid.uuid4().hex[:6], "name": str(l.get("name") or "Lane")[:60],
              "color": str(l.get("color") or COLORS[i % len(COLORS)])[:9], "gm": bool(l.get("gm"))} for i, l in enumerate(lanes or [])]
    if not clean:
        raise CampaignError("Keep at least one lane.")
    ids = {l["id"] for l in clean}
    for b in data["blocks"]:
        if b["lane"] not in ids:
            b["lane"] = clean[0]["id"]
    data["lanes"] = clean
    write_json(_file(camp), data)
    return data


def day(cal, d, end=False):
    """Day number of a (possibly partial) date; with end, the last day it covers."""
    if d.get("m") is None:
        n = worldcal.year_start(cal, d["y"])
        return n + worldcal.year_length(cal, d["y"]) - 1 if end else n
    if d.get("d") is None:
        n = worldcal.to_days(cal, {"y": d["y"], "m": d["m"], "d": 1})
        return n + worldcal.month_length(cal, d["y"], d["m"]) - 1 if end else n
    return worldcal.to_days(cal, d)


def view(camp):
    """Everything the timeline page draws, with day numbers worked out."""
    cal = calendar_for(camp)
    data = read(camp)
    blocks = []
    for b in data["blocks"]:
        blocks.append({**b, "a": day(cal, b["start"]), "b": day(cal, b["end"] or b["start"], True),
                       "label": label(cal, b["start"]) + (" – " + label(cal, b["end"]) if b.get("end") else "")})
    sessions = []
    for s in camp.sessions():
        if s.get("world_date"):
            n = worldcal.to_days(cal, s["world_date"])
            e = worldcal.to_days(cal, s["world_date_end"]) if s.get("world_date_end") else n
            sessions.append({"id": s["id"], "number": s["number"], "title": s["title"], "a": n, "b": max(n, e),
                             "label": worldcal.format_range(cal, s["world_date"], s.get("world_date_end"))})
    real = worldcal.read(camp)
    return {"lanes": data["lanes"], "blocks": blocks, "sessions": sessions, "has_calendar": bool(real),
            "today": worldcal.to_days(cal, cal["current"]) if real else None,
            "cal": {"months": [{"name": m["name"], "days": m["days"]} for m in cal["months"]], "leap": cal["leap"],
                    "eras": cal["eras"], "has_year_zero": cal["has_year_zero"]}}


def label(cal, d):
    if not d:
        return ""
    if d.get("m") is None:
        return worldcal.year_label(cal, d["y"])
    if d.get("d") is None:
        return f"{cal['months'][d['m']]['name']} {worldcal.year_label(cal, d['y'])}"
    return worldcal.format_date(cal, d)


def from_legendkeeper(camp, lk):
    cal = calendar_for(camp)
    lanes = [{"id": l["id"], "name": l.get("name") or "Lane", "color": COLORS[i % len(COLORS)]} for i, l in enumerate(lk.get("lanes") or [])]
    if not lanes:
        lanes = [{"id": "l" + uuid.uuid4().hex[:6], "name": "History", "color": COLORS[0]}]
    if len(lanes) == 1 and not lk["lanes"][0].get("name"):
        lanes[0]["name"] = lk.get("name") or "History"
    blocks = []
    for e in lk.get("events") or []:
        start = worldcal.lk_minutes_to_date(cal, e.get("start") or 0)
        end = worldcal.lk_minutes_to_date(cal, e["end"]) if e.get("end") is not None else None
        detail = e.get("detail")
        if detail is not None and detail <= 1:           # LegendKeeper "year" precision
            start = {"y": start["y"]}
            end = {"y": end["y"]} if end else None
        blocks.append({"id": "b" + (e.get("id") or uuid.uuid4().hex[:8]), "title": e.get("name") or "", "lane": e.get("laneId") or lanes[0]["id"],
                       "start": start, "end": end, "page": e.get("page") or None, "color": e.get("color") or "", "gm": False, "note": ""})
    lane_ids = {l["id"] for l in lanes}
    for b in blocks:
        if b["lane"] not in lane_ids:
            b["lane"] = lanes[0]["id"]
    return {"lanes": lanes, "blocks": blocks, "source": "legendkeeper"}
