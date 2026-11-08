"""The campaign's in-world calendar: any months, weekdays, leap rules, eras, seasons, holidays and moons.

Stored in <campaign>/calendar.json. Dates are {"y": year, "m": month index (0-based), "d": day (1-based)}. Years are
"astronomical": year 1 is the first year of the main era, 0 and below count back (shown in the earlier era).
Internally every date is a day number: day 0 is the first day of year 1.

A LegendKeeper calendar (calendar.json written by the importer) is converted the first time it's read.
"""
import math
import re
import time
import uuid

from .util import read_json, write_json

PRESETS = {
    "gregorian": {
        "name": "Gregorian",
        "months": [{"name": n, "days": d} for n, d in [("January", 31), ("February", 28), ("March", 31), ("April", 30), ("May", 31),
                                                       ("June", 30), ("July", 31), ("August", 31), ("September", 30),
                                                       ("October", 31), ("November", 30), ("December", 31)]],
        "leap": [{"name": "Leap day", "month": 1, "rule": "400,!100,4", "days": 1}],
        "weekdays": ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        "epoch_weekday": 1,
        "eras": [{"name": "Before", "abbr": "BE", "negative": True}, {"name": "Common Era", "abbr": "CE"}],
        "moons": [{"name": "Moon", "cycle": 29.530588, "shift": 10.58, "color": "#E8E4D8"}],
        "seasons": [{"name": "Spring", "month": 2, "day": 20}, {"name": "Summer", "month": 5, "day": 21},
                    {"name": "Autumn", "month": 8, "day": 22}, {"name": "Winter", "month": 11, "day": 21}],
    },
    "simple": {
        "name": "Twelve months of thirty days",
        "months": [{"name": n, "days": 30} for n in ["Deepwinter", "Thaw", "Seedtime", "Rain", "Bloom", "Midsummer", "Harvest",
                                                      "Goldleaf", "Leaffall", "Frost", "Longnight", "Yearsend"]],
        "weekdays": ["Firstday", "Seconday", "Thirdday", "Fourthday", "Fifthday", "Sixthday", "Restday"],
        "eras": [{"name": "Before the Founding", "abbr": "BF", "negative": True}, {"name": "After the Founding", "abbr": "AF"}],
        "moons": [{"name": "The Silver Moon", "cycle": 30, "shift": 0, "color": "#E8E4D8"},
                  {"name": "The Red Moon", "cycle": 45, "shift": 12, "color": "#E5626A"}],
        "seasons": [{"name": "Winter", "month": 0, "day": 1}, {"name": "Spring", "month": 3, "day": 1},
                    {"name": "Summer", "month": 6, "day": 1}, {"name": "Autumn", "month": 9, "day": 1}],
    },
}

PHASES = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"]


def blank(preset="simple"):
    base = PRESETS.get(preset) or PRESETS["simple"]
    cal = {"version": 1, "name": base["name"], "months": [dict(m) for m in base["months"]], "leap": [dict(x) for x in base.get("leap", [])],
           "weekdays": list(base["weekdays"]), "week_resets": False, "epoch_weekday": base.get("epoch_weekday", 0),
           "has_year_zero": False, "eras": [dict(e) for e in base["eras"]], "moons": [dict(m) for m in base["moons"]],
           "seasons": [dict(s) for s in base.get("seasons", [])], "holidays": [], "events": [],
           "current": {"y": 1, "m": 0, "d": 1}}
    return cal


# ---- storage ---------------------------------------------------------------------------

def _file(camp):
    return camp.root / "calendar.json"


def read(camp):
    """The calendar, or None if the campaign doesn't have one yet."""
    data = read_json(_file(camp), None)
    if not data:
        return None
    if data.get("version") != 1:
        if data.get("source") == "legendkeeper" and data.get("calendars"):
            data = from_legendkeeper(data["calendars"][0], raw=data)
            write_json(_file(camp), data)
        else:
            return None
    return normalize(data)


def save(camp, cal):
    cal = normalize(cal)
    write_json(_file(camp), cal)
    return cal


def normalize(cal):
    cal = dict(cal)
    cal["version"] = 1
    cal["months"] = [{"name": str(m.get("name") or f"Month {i + 1}")[:40], "days": max(1, min(400, int(m.get("days") or 30))),
                      "intercalary": bool(m.get("intercalary"))} for i, m in enumerate(cal.get("months") or [])] or blank()["months"]
    n = len(cal["months"])
    cal["leap"] = [{"name": str(x.get("name") or "Leap day")[:40], "month": max(0, min(n - 1, int(x.get("month") or 0))),
                    "rule": re.sub(r"[^0-9,!\s]", "", str(x.get("rule") or "4")).replace(" ", "") or "4",
                    "days": max(1, min(30, int(x.get("days") or 1))), "offset": int(x.get("offset") or 0)}
                   for x in cal.get("leap") or []]
    cal["weekdays"] = [str(w)[:30] for w in cal.get("weekdays") or [] if str(w).strip()] or ["Day"]
    cal["week_resets"] = bool(cal.get("week_resets"))
    cal["epoch_weekday"] = int(cal.get("epoch_weekday") or 0) % len(cal["weekdays"])
    cal["has_year_zero"] = bool(cal.get("has_year_zero"))
    eras = cal.get("eras") or []
    cal["eras"] = [{"name": str(e.get("name") or "")[:40], "abbr": str(e.get("abbr") or "")[:10], "negative": bool(e.get("negative")),
                    "start": int(e.get("start") or 1)} for e in eras]
    cal["moons"] = [{"name": str(mo.get("name") or "Moon")[:40], "cycle": max(0.1, float(mo.get("cycle") or 29.5)),
                     "shift": float(mo.get("shift") or 0), "color": str(mo.get("color") or "#E8E4D8")[:9]} for mo in cal.get("moons") or []]
    cal["seasons"] = [{"name": str(s.get("name") or "")[:40], "month": max(0, min(n - 1, int(s.get("month") or 0))),
                       "day": max(1, int(s.get("day") or 1))} for s in cal.get("seasons") or []]
    cal["holidays"] = [{"id": h.get("id") or "h" + uuid.uuid4().hex[:6], "name": str(h.get("name") or "")[:60],
                        "month": max(0, min(n - 1, int(h.get("month") or 0))), "day": max(1, int(h.get("day") or 1)),
                        "note": str(h.get("note") or "")[:500], "color": str(h.get("color") or "")[:9]}
                       for h in cal.get("holidays") or [] if str(h.get("name") or "").strip()]
    cal["events"] = [_event(e) for e in cal.get("events") or [] if str(e.get("title") or "").strip()]
    cal["current"] = clamp(cal, cal.get("current") or {"y": 1, "m": 0, "d": 1})
    return cal


def _event(e):
    return {"id": e.get("id") or "e" + uuid.uuid4().hex[:8], "title": str(e.get("title") or "")[:120],
            "date": {"y": int(e["date"]["y"]), "m": int(e["date"]["m"]), "d": int(e["date"]["d"])},
            "end": ({"y": int(e["end"]["y"]), "m": int(e["end"]["m"]), "d": int(e["end"]["d"])} if e.get("end") else None),
            "page": e.get("page") or None, "note": str(e.get("note") or "")[:2000], "gm": bool(e.get("gm")),
            "color": str(e.get("color") or "")[:9], "session": e.get("session") or None}


# ---- date arithmetic -------------------------------------------------------------------------

def _rule_hits(rule, y, offset=0):
    """'400,!100,4' -> the first term that divides the year decides (a leading ! means 'not a leap year')."""
    yy = y - offset
    for term in [t for t in str(rule).split(",") if t]:
        neg = term.startswith("!")
        try:
            k = int(term.lstrip("!"))
        except ValueError:
            continue
        if k and yy % k == 0:
            return not neg
    return False


def month_length(cal, y, m):
    n = cal["months"][m]["days"]
    for x in cal["leap"]:
        if x["month"] == m and _rule_hits(x["rule"], y, x.get("offset", 0)):
            n += x["days"]
    return n


def year_length(cal, y):
    return sum(month_length(cal, y, m) for m in range(len(cal["months"])))


def _base_year_len(cal):
    return sum(m["days"] for m in cal["months"])


def _leap_days_between(cal, y0, y1):
    """Leap days added in years y0 <= y < y1 (closed-form per rule, so even huge spans are fast)."""
    total = 0
    for x in cal["leap"]:
        terms = [t for t in x["rule"].split(",") if t]
        off = x.get("offset", 0)
        # count years in [y0, y1) whose first dividing term is positive
        def count(k):
            return (y1 - 1 - off) // k - (y0 - 1 - off) // k

        seen = []
        for t in terms:
            neg = t.startswith("!")
            k = int(t.lstrip("!") or 0)
            if not k:
                continue
            # years divisible by k but not by any earlier term's k
            c = count(k)
            for prev in _subsets(seen):
                lcm = k
                for p in prev:
                    lcm = lcm * p // math.gcd(lcm, p)
                c += (-1) ** len(prev) * count(lcm)
            if not neg:
                total += c * x["days"]
            seen.append(k)
    return total


def _subsets(items):
    out = []
    for i in range(1, 1 << len(items)):
        out.append([items[j] for j in range(len(items)) if i >> j & 1])
    return out


def year_start(cal, y):
    """Day number of the first day of year y."""
    base = _base_year_len(cal)
    if y >= 1:
        return (y - 1) * base + _leap_days_between(cal, 1, y)
    return -((1 - y) * base + _leap_days_between(cal, y, 1))


def to_days(cal, date):
    y, m, d = int(date["y"]), int(date["m"]), int(date["d"])
    n = year_start(cal, y)
    for i in range(m):
        n += month_length(cal, y, i)
    return n + d - 1


def from_days(cal, n):
    base = _base_year_len(cal) or 1
    y = 1 + math.floor(n / (base + 0.0001 + len(cal["leap"]) * 0.25))
    while year_start(cal, y) > n:
        y -= 1
    while year_start(cal, y + 1) <= n:
        y += 1
    rest = n - year_start(cal, y)
    for m in range(len(cal["months"])):
        ml = month_length(cal, y, m)
        if rest < ml:
            return {"y": y, "m": m, "d": rest + 1}
        rest -= ml
    return {"y": y, "m": len(cal["months"]) - 1, "d": month_length(cal, y, len(cal["months"]) - 1)}


def clamp(cal, date):
    y = int(date.get("y", 1))
    m = max(0, min(len(cal["months"]) - 1, int(date.get("m", 0))))
    d = max(1, min(month_length(cal, y, m), int(date.get("d", 1))))
    return {"y": y, "m": m, "d": d}


def add_days(cal, date, days):
    return from_days(cal, to_days(cal, date) + int(days))


def _intercalary_before(cal, n):
    """Intercalary days (outside the week) before day n, counted from day 0 (negative when n < 0)."""
    if not any(m["intercalary"] for m in cal["months"]):
        return 0
    date = from_days(cal, n)
    sign = 1 if n >= 0 else -1
    lo, hi = (1, date["y"]) if n >= 0 else (date["y"] + 1, 1)
    count = 0
    for y in range(lo, hi):                          # whole years between
        count += sum(month_length(cal, y, i) for i, m in enumerate(cal["months"]) if m["intercalary"])
    # part of the date's own year
    part = sum(month_length(cal, date["y"], i) for i in range(date["m"]) if cal["months"][i]["intercalary"])
    if cal["months"][date["m"]]["intercalary"]:
        part += date["d"] - 1
    if n >= 0:
        return count + part
    whole = sum(month_length(cal, date["y"], i) for i, m in enumerate(cal["months"]) if m["intercalary"])
    return -(count + whole - part)


def weekday(cal, date):
    """Index into weekdays, or None on an intercalary (festival) day."""
    if cal["months"][date["m"]]["intercalary"]:
        return None
    w = len(cal["weekdays"])
    if cal["week_resets"]:
        return (date["d"] - 1) % w
    n = to_days(cal, date)
    return (cal["epoch_weekday"] + n - _intercalary_before(cal, n)) % w


def moon_phase(moon, n):
    """0..1 through the cycle (0 = new, 0.5 = full) on day n, and the name of the phase."""
    f = ((n - moon["shift"]) / moon["cycle"]) % 1.0
    return f, PHASES[int((f * 8) + 0.5) % 8]


def year_label(cal, y):
    eras = cal["eras"]
    neg = next((e for e in eras if e["negative"]), None)
    pos = [e for e in eras if not e["negative"]]
    if y < 1 and not cal["has_year_zero"] and neg:
        return f"{1 - y}" + (f" {neg['abbr']}" if neg["abbr"] else "")
    era = None
    for e in sorted(pos, key=lambda e: e["start"]):
        if y >= e["start"]:
            era = e
    if era and era["start"] > 1:
        shown = y - era["start"] + 1
    else:
        shown = y
    return f"{shown}" + (f" {era['abbr']}" if era and era["abbr"] else "")


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def format_date(cal, date, weekday_name=False):
    date = clamp(cal, date)
    s = f"{ordinal(date['d'])} of {cal['months'][date['m']]['name']}, {year_label(cal, date['y'])}"
    if weekday_name:
        w = weekday(cal, date)
        if w is not None:
            s = f"{cal['weekdays'][w]}, {s}"
    return s


# ---- views -----------------------------------------------------------------------------------

def month_view(cal, y, m, sessions=()):
    """Everything the calendar page needs for one month."""
    y, m = int(y), max(0, min(len(cal["months"]) - 1, int(m)))
    length = month_length(cal, y, m)
    first = to_days(cal, {"y": y, "m": m, "d": 1})
    cur = to_days(cal, cal["current"])
    start_w = weekday(cal, {"y": y, "m": m, "d": 1})
    by_day = {}
    for e in cal["events"]:
        a = to_days(cal, e["date"])
        b = to_days(cal, e["end"]) if e.get("end") else a
        for n in range(max(a, first), min(b, first + length - 1) + 1):
            by_day.setdefault(n - first + 1, []).append(e)
    days = []
    for d in range(1, length + 1):
        n = first + d - 1
        moons = []
        for mo in cal["moons"]:
            f, name = moon_phase(mo, n)
            moons.append({"name": mo["name"], "color": mo["color"], "f": round(f, 4), "phase": name,
                          "full": abs(f - 0.5) < 0.5 / mo["cycle"] + 1e-9, "new": min(f, 1 - f) < 0.5 / mo["cycle"] + 1e-9})
        days.append({"d": d, "n": n, "today": n == cur, "moons": moons,
                     "holidays": [h for h in cal["holidays"] if h["month"] == m and h["day"] == d],
                     "seasons": [s["name"] for s in cal["seasons"] if s["month"] == m and s["day"] == d],
                     "events": by_day.get(d, []),
                     "sessions": [s for s in sessions if s.get("world_date") and s["world_date"].get("y") == y
                                  and s["world_date"].get("m") == m and s["world_date"].get("d") == d]})
    return {"y": y, "m": m, "name": cal["months"][m]["name"], "year_label": year_label(cal, y), "length": length,
            "intercalary": cal["months"][m]["intercalary"], "start_weekday": start_w, "days": days,
            "weekdays": cal["weekdays"], "week_resets": cal["week_resets"]}


def today_text(cal):
    """A line about the current date for prompts and the live view."""
    n = to_days(cal, cal["current"])
    bits = [format_date(cal, cal["current"], True)]
    for mo in cal["moons"]:
        bits.append(f"{mo['name']}: {moon_phase(mo, n)[1].lower()}")
    hol = [h["name"] for h in cal["holidays"] if h["month"] == cal["current"]["m"] and h["day"] == cal["current"]["d"]]
    if hol:
        bits.append("today is " + ", ".join(hol))
    return "; ".join(bits)


def upcoming(cal, days=30):
    """Holidays and events in the next `days` days."""
    start = to_days(cal, cal["current"])
    out = []
    for i in range(1, days + 1):
        date = from_days(cal, start + i)
        for h in cal["holidays"]:
            if h["month"] == date["m"] and h["day"] == date["d"]:
                out.append({"in": i, "date": date, "label": format_date(cal, date), "title": h["name"], "kind": "holiday"})
        for e in cal["events"]:
            if e["date"] == date:
                out.append({"in": i, "date": date, "label": format_date(cal, date), "title": e["title"], "kind": "event", "gm": e["gm"]})
    return out


# ---- LegendKeeper --------------------------------------------------------------------------

def from_legendkeeper(lk, raw=None):
    """A LegendKeeper calendar (minutes since year 1) -> this format."""
    months = [{"name": m.get("name") or "", "days": int(m.get("length") or 30), "intercalary": bool(m.get("isIntercalary"))}
              for m in lk.get("months") or []]
    leap = [{"name": x.get("name") or "Leap day", "month": int(x.get("month") or 0), "rule": str(x.get("interval") or "4"),
             "days": 1, "offset": int(x.get("offset") or 0)} for x in lk.get("leapDays") or []]
    weekdays = [w.get("name") or "" for w in lk.get("weekdays") or []]
    eras = []
    ne = lk.get("negativeEra")
    if ne:
        eras.append({"name": ne.get("name") or "", "abbr": "" if ne.get("hideAbbr") else (ne.get("abbr") or ""), "negative": True})
    for e in lk.get("positiveEras") or []:
        eras.append({"name": e.get("name") or "", "abbr": "" if e.get("hideAbbr") else (e.get("abbr") or ""),
                     "start": 1 + int(round((e.get("startsAt") or 0) / 525949.2))})
    mpd = (lk.get("hoursInDay") or 24) * (lk.get("minutesInHour") or 60)
    moons = [{"name": mo.get("name") or "Moon", "cycle": (mo.get("phase") or 42524) / mpd, "shift": (mo.get("shift") or 0) / mpd,
              "color": mo.get("color") or "#E8E4D8"} for mo in lk.get("moons") or []]
    cal = {"version": 1, "name": lk.get("name") or "Calendar", "months": months, "leap": leap, "weekdays": weekdays,
           "week_resets": bool(lk.get("weekResetsEachMonth")), "epoch_weekday": int(lk.get("epochWeekday") or 0),
           "has_year_zero": bool(lk.get("hasZeroYear")), "eras": eras, "moons": moons, "seasons": [], "holidays": [],
           "events": [], "current": {"y": 1, "m": 0, "d": 1}, "minutes_per_day": mpd}
    if raw:
        cal["legendkeeper"] = raw
    return cal


def lk_minutes_to_date(cal, minutes):
    return from_days(cal, math.floor((minutes or 0) / (cal.get("minutes_per_day") or 1440)))


# ---- sessions ----------------------------------------------------------------------------------

def session_dates(camp):
    """Sessions with a structured in-world date, for the month view."""
    return [{"id": s["id"], "number": s["number"], "title": s["title"], "world_date": s["world_date"]}
            for s in camp.sessions() if s.get("world_date")]


def stamp():
    return time.strftime("%Y-%m-%d %H:%M")
