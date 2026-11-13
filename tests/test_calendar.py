"""In-world calendar arithmetic."""
import datetime
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from studio import worldcal as wc  # noqa: E402


def greg():
    return wc.normalize(wc.blank("gregorian"))


def test_gregorian_matches_python():
    cal = greg()
    rnd = random.Random(4)
    for _ in range(300):
        d = datetime.date.fromordinal(rnd.randint(1, 800000))
        date = {"y": d.year, "m": d.month - 1, "d": d.day}
        n = wc.to_days(cal, date)
        assert n == d.toordinal() - 1
        assert wc.from_days(cal, n) == date
        assert cal["weekdays"][wc.weekday(cal, date)] == d.strftime("%A")
    assert wc.month_length(cal, 2000, 1) == 29 and wc.month_length(cal, 1900, 1) == 28 and wc.month_length(cal, 2024, 1) == 29


def test_negative_years_and_eras():
    cal = greg()
    for n in [-1, -365, -366, -100000, -2000000]:
        assert wc.to_days(cal, wc.from_days(cal, n)) == n
    assert wc.from_days(cal, -1) == {"y": 0, "m": 11, "d": 31}
    assert wc.year_label(cal, 0) == "1 BE" and wc.year_label(cal, -4) == "5 BE" and wc.year_label(cal, 1042) == "1042 CE"
    assert wc.format_date(cal, {"y": 1042, "m": 2, "d": 3}) == "3rd of March, 1042 CE"


def test_intercalary_days_skip_the_week():
    cal = wc.normalize({**wc.blank("simple"), "months": [{"name": "A", "days": 30}, {"name": "Midwinter", "days": 1, "intercalary": True},
                                                           {"name": "B", "days": 30}], "weekdays": ["One", "Two", "Three"]})
    a30 = {"y": 1, "m": 0, "d": 30}
    b1 = {"y": 1, "m": 2, "d": 1}
    assert wc.weekday(cal, {"y": 1, "m": 1, "d": 1}) is None
    assert wc.weekday(cal, b1) == (wc.weekday(cal, a30) + 1) % 3
    y2 = {"y": 2, "m": 0, "d": 1}
    assert wc.weekday(cal, y2) == (wc.weekday(cal, {"y": 1, "m": 2, "d": 30}) + 1) % 3


def test_moons_and_month_view():
    cal = wc.normalize(wc.blank("simple"))
    cal["moons"] = [{"name": "Silver", "cycle": 30, "shift": 0, "color": "#fff"}, {"name": "Red", "cycle": 45, "shift": 12, "color": "#f00"}]
    cal["holidays"] = [{"name": "Founding Day", "month": 0, "day": 15}]
    cal["events"] = [{"title": "The bridge washes out", "date": {"y": 1, "m": 0, "d": 3}, "end": {"y": 1, "m": 0, "d": 5}}]
    cal = wc.normalize(cal)
    assert wc.moon_phase(cal["moons"][0], 0)[1] == "New moon" and wc.moon_phase(cal["moons"][0], 15)[1] == "Full moon"
    v = wc.month_view(cal, 1, 0, [{"id": "s1", "world_date": {"y": 1, "m": 0, "d": 4}}])
    assert v["length"] == 30 and v["days"][14]["holidays"][0]["name"] == "Founding Day"
    assert [len(d["events"]) for d in v["days"][1:6]] == [0, 1, 1, 1, 0]
    assert v["days"][3]["sessions"][0]["id"] == "s1"
    assert v["days"][0]["moons"][0]["new"] and v["days"][15]["moons"][0]["full"]


def test_legendkeeper_calendar():
    lk = {"name": "Custom", "hasZeroYear": False,
          "months": [{"name": n, "length": d, "isIntercalary": False} for n, d in [("Natalis", 31), ("Exuviae", 28), ("Germinatio", 31), ("M4", 30),
                     ("M5", 31), ("M6", 30), ("M7", 31), ("M8", 31), ("M9", 30), ("M10", 31), ("M11", 30), ("M12", 31)]],
          "leapDays": [{"name": "Leap Day", "month": 1, "interval": "400,!100,4", "offset": 0}],
          "weekdays": [{"name": n} for n in "ABCDEFG"], "epochWeekday": 1,
          "negativeEra": {"name": "The Before", "abbr": "TB", "startsAt": -2629746720}, "positiveEras": [{"name": "After", "abbr": "AF", "startsAt": 0}],
          "moons": [{"name": "Moon", "phase": 42524.0463, "shift": 15238, "color": "#FFFFFF"}], "hoursInDay": 24, "minutesInHour": 60}
    cal = wc.normalize(wc.from_legendkeeper(lk))
    assert abs(cal["moons"][0]["cycle"] - 29.53) < 0.01
    d = wc.lk_minutes_to_date(cal, -2629746720)
    assert d["y"] == -4999 and wc.year_label(cal, d["y"]) == "5000 TB"
    assert wc.month_length(cal, 4, 1) == 29


def test_clocks(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import campaign, clocks, recaps
    camp = campaign.create(tmp_path / "C", "C")
    c = clocks.save(camp, {"name": "The guild takes the docks", "segments": 4, "page": "Thieves", "when_full": "They own the harbour."})
    assert c["filled"] == 0 and c["gm"] is True
    assert clocks.tick(camp, c["id"], 2, "Bribed the harbourmaster")["filled_now"] is False
    r = clocks.tick(camp, c["id"], 5)
    assert r["filled_now"] and r["clock"]["filled"] == 4 and r["clock"]["history"][-1]["delta"] == 2
    assert clocks.tick(camp, c["id"], 1)["filled_now"] is False          # already full: nothing changes
    r = clocks.tick(camp, c["id"], -1, "Set back")
    assert r["clock"]["filled"] == 3 and "completed" not in r["clock"]
    c = clocks.save(camp, {**r["clock"], "segments": 2})
    assert c["filled"] == 2
    assert clocks.for_page(camp, "Thieves")[0]["id"] == c["id"]
    assert "The guild takes the docks (faction): 2/2" in recaps.primer(camp, False) and "They own the harbour" in recaps.primer(camp, False)
    assert "guild" not in recaps.primer(camp, True)


def test_timeline(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    import json
    from studio import campaign, timeline
    camp = campaign.create(tmp_path / "C", "C")
    # a LegendKeeper timeline converts on first read (no calendar: Gregorian arithmetic)
    (camp.root / "timeline.legendkeeper.json").write_text(json.dumps({"name": "History", "lanes": [{"id": "ln1", "name": ""}], "events": [
        {"id": "e1", "laneId": "ln1", "detail": 1, "start": -2629746720, "name": "The Old War", "page": "History/War"},
        {"id": "e2", "laneId": "ln1", "detail": 1, "start": -2629746720, "end": -788924160, "name": "Reformation"}]}))
    v = timeline.view(camp)
    assert [l["name"] for l in v["lanes"]] == ["History"] and len(v["blocks"]) == 2
    war = v["blocks"][0]
    assert war["start"] == {"y": -4999} and war["page"] == "History/War" and war["label"] == "5000 BE" and war["b"] > war["a"]
    lane = v["lanes"][0]["id"]
    b = timeline.save_block(camp, {"title": "The bridge washes out", "lane": lane, "start": {"y": 1042, "m": 0, "d": 1}})
    b = timeline.save_block(camp, {**b, "end": {"y": 1041}})          # reversed: swapped
    assert b["start"] == {"y": 1041} and b["end"] == {"y": 1042, "m": 0, "d": 1}
    data = timeline.save_lanes(camp, [{"id": "new", "name": "The party"}])
    assert all(x["lane"] == "new" for x in data["blocks"])
    timeline.delete_block(camp, b["id"])
    assert len(timeline.view(camp)["blocks"]) == 2


def test_player_site_timeline(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    import json
    from studio import campaign, playersite, timeline
    camp = campaign.create(tmp_path / "C", "C")
    lanes = timeline.save_lanes(camp, [{"name": "History"}, {"name": "Secrets", "gm": True}])["lanes"]
    timeline.save_block(camp, {"title": "The Founding", "lane": lanes[0]["id"], "start": {"y": 1}})
    timeline.save_block(camp, {"title": "Hidden coup", "lane": lanes[0]["id"], "start": {"y": 5}, "gm": True})
    timeline.save_block(camp, {"title": "Cult rises", "lane": lanes[1]["id"], "start": {"y": 3}})
    playersite.build(camp, log=lambda m: None)
    text = (camp.root / "player-site" / "data.js").read_text()
    data = json.loads(text[len("window.LORE = "):-2])
    assert [b["title"] for b in data["timeline"]] == ["The Founding"] and "Hidden coup" not in text and "Cult rises" not in text


def test_session_date_ranges(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import campaign, timeline
    from studio.api import Api
    camp = campaign.create(tmp_path / "C", "C")
    cal = greg()
    wc.save(camp, cal)
    cal = wc.read(camp)
    sid = camp.create_session("Road trip", 1)
    # played over two evenings; an end before the start is dropped
    s = camp.update_session(sid, {"date": "2026-10-03", "date_end": "2026-10-04"})
    assert s["date_end"] == "2026-10-04" and s["date_label"] == "2026-10-03 – 2026-10-04"
    assert camp.update_session(sid, {"date_end": "2026-10-01"})["date_label"] == "2026-10-03"
    # in-world: one day, then three days
    api = Api.__new__(Api)
    api._camp = lambda: camp
    api.session_full = lambda x: camp.read_session(x)
    a, b = {"y": 1042, "m": 0, "d": 4}, {"y": 1042, "m": 0, "d": 6}
    assert api.set_session_world_date(sid, a)["in_world_date"] == wc.format_date(cal, a)
    s = api.set_session_world_date(sid, a, b)
    assert s["world_date_end"] == b and s["in_world_date"] == "4th – 6th of January, 1042 CE"
    assert wc.format_range(cal, {"y": 1042, "m": 0, "d": 30}, {"y": 1042, "m": 1, "d": 2}) == "30th of January – 2nd of February, 1042 CE"
    days = wc.month_view(cal, 1042, 0, wc.session_dates(camp))["days"]
    assert [d["d"] for d in days if d["sessions"]] == [4, 5, 6]
    t = timeline.view(camp)["sessions"][0]
    assert t["b"] - t["a"] == 2 and "4th – 6th" in t["label"]
    # moving it from the calendar page keeps its three days
    s = api.set_session_world_date(sid, {"y": 1042, "m": 0, "d": 10}, "keep")
    assert s["world_date_end"] == {"y": 1042, "m": 0, "d": 12}
    # back to one day, and clearing the date clears the end too
    s = api.set_session_world_date(sid, a, a)
    assert s["world_date_end"] is None
    s = api.set_session_world_date(sid, None)
    assert s["world_date"] is None and s["world_date_end"] is None
