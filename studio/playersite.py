"""The player lore book: a self-contained website with only what the players are allowed to see.

It's a folder of static files (index.html, data.js, styles, images) that opens from disk or from any static host
(GitHub Pages, Netlify, Neocities, a shared drive). GM-only pages, GM blocks, GM map pins, GM clocks and calendar
events never leave the campaign: they're removed here, before anything is written, not hidden in the browser.
"""
import json
import re
import shutil
import time
from pathlib import Path

from . import clocks as clocks_mod, handouts as handouts_mod, maps as maps_mod, worldcal
from .recaps import strip_gm

TEMPLATE = Path(__file__).resolve().parent / "site"
WEB = Path(__file__).resolve().parent.parent / "web"

DEFAULTS = {"out_dir": "", "gm_recaps": False, "maps": True, "handouts": True, "calendar": True, "clocks": True,
            "hidden": [], "title": ""}


def options(camp):
    return {**DEFAULTS, **(camp.info.get("player_site") or {})}


def default_dir(camp):
    return camp.root / "player-site"


def _visible_pages(camp, hidden):
    hidden = set(hidden or [])
    pages = [p for p in camp.pages() if p["visibility"] != "gm" and p["id"] not in hidden]
    # a page inside a hidden or GM folder is hidden too
    blocked = {p["id"].rsplit("/index", 1)[0] for p in camp.pages() if p["id"].endswith("/index") and (p["visibility"] == "gm" or p["id"] in hidden)}
    return [p for p in pages if not any(p["id"] == b + "/index" or p["id"].startswith(b + "/") for b in blocked if p["id"] != b + "/index")]


def _tree(node, ok):
    out = []
    for n in node:
        kids = _tree(n.get("children") or [], ok)
        if n.get("id") in ok or kids:
            out.append({"id": n["id"] if n.get("id") in ok else None, "title": n["title"], "children": kids})
    return out


class _Assets:
    """Copies campaign files the site needs and gives their site-relative paths."""

    def __init__(self, camp, out):
        self.camp, self.out, self.done = camp, out, {}

    def add(self, rel):
        rel = (rel or "").lstrip("/")
        if rel.startswith("c/"):
            rel = rel[2:]
        if not rel or rel.startswith(("http://", "https://")):
            return rel
        if rel in self.done:
            return self.done[rel]
        src = self.camp.file_for_url(rel)
        if not src:
            self.done[rel] = ""
            return ""
        dest = self.out / "files" / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        self.done[rel] = "files/" + rel
        return self.done[rel]

    def rewrite(self, md):
        """Images in Markdown that point into the campaign (/c/...) are copied and pointed at the copy."""
        return re.sub(r"\]\((/c/[^\s)]+)\)", lambda m: f"]({self.add(m.group(1)) or '#'})", md or "")


def build(camp, out_dir=None, opts=None, log=print):
    opts = {**options(camp), **(opts or {})}
    out = Path(out_dir or opts.get("out_dir") or default_dir(camp)).expanduser()
    if out.exists() and any(out.iterdir()) and not (out / "data.js").exists():
        raise ValueError(f"{out} isn't empty and isn't a player lore book. Pick an empty folder.")
    if out.exists():
        shutil.rmtree(out / "files", ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)
    assets = _Assets(camp, out)

    pages = _visible_pages(camp, opts.get("hidden"))
    ok = {p["id"] for p in pages}
    log(f"{len(pages)} pages for players")
    data_pages = {}
    for p in pages:
        full = camp.read_page(p["id"])
        meta = full["meta"]
        banner = meta.get("banner") or ""
        data_pages[p["id"]] = {
            "title": p["title"], "body": assets.rewrite(strip_gm(full["body"])), "tags": p["tags"], "aliases": p["aliases"],
            "banner": assets.add(banner) if banner else "", "banner_y": meta.get("banner_y"),
            "crumbs": [c for c in full.get("crumbs", []) if c["id"] in ok],
            "children": [c for c in full.get("children", []) if c["id"] in ok],
        }
    names = [[n, pid] for n, pid in camp.link_names() if pid in ok]
    tree = camp.tree()

    # recaps
    recaps = []
    for s in camp.sessions():
        text = camp.player_recap(s["id"]).strip()
        if not text and opts.get("gm_recaps"):
            text = strip_gm(camp.read_session(s["id"])["recap"]).strip()
        if text:
            recaps.append({"id": s["id"], "number": s["number"], "title": s["title"], "date": s.get("date") or "",
                           "world": s.get("in_world_date") or "", "body": assets.rewrite(re.sub(r"\{t:\d{1,2}:\d{2}:\d{2}\}\s?", "", text))})
    log(f"{len(recaps)} session recaps")

    # maps
    maps = []
    if opts.get("maps"):
        for m in maps_mod.list_maps(camp):
            if m.get("page") and m["page"] not in ok and any(p["id"] == m["page"] for p in camp.pages()):
                continue                                  # the map belongs to a page players can't see
            full = maps_mod.read(camp, m["id"])
            img = full.get("image") or ""
            src = img if img.startswith(("http://", "https://")) else assets.add(img)
            if not src:
                continue
            pins = [{"name": p["name"], "x": p["x"], "y": p["y"], "page": p.get("page") if p.get("page") in ok else None,
                     "map": p.get("map"), "color": p.get("color"), "icon": p.get("icon") or "", "size": p.get("size") or "m",
                     "label": p.get("label") or "hover", "zmin": p.get("zmin"), "zmax": p.get("zmax"), "note": p.get("note") or ""}
                    for p in full["pins"] if not p.get("gm")]
            maps.append({"id": m["id"], "name": full["name"], "image": src, "page": full.get("page") if full.get("page") in ok else None, "pins": pins})
        ids = {m["id"] for m in maps}
        for m in maps:
            for p in m["pins"]:
                if p["map"] not in ids:
                    p["map"] = None
        log(f"{len(maps)} maps")

    # handouts the players already have
    handouts = []
    if opts.get("handouts"):
        for x in handouts_mod.all_handouts(camp):
            if x.get("revealed"):
                handouts.append({"title": x["title"], "text": x.get("text") or "",
                                 "image": assets.add("handouts/" + x["image"]) if x.get("image") else ""})
        log(f"{len(handouts)} handouts")

    # calendar: today, holidays, events players know about, dated sessions
    calendar = None
    if opts.get("calendar"):
        cal = worldcal.read(camp)
        if cal:
            evs = sorted((e for e in cal["events"] if not e.get("gm")), key=lambda e: worldcal.to_days(cal, e["date"]))
            calendar = {"name": cal["name"], "today": worldcal.format_date(cal, cal["current"], True),
                        "today_text": worldcal.today_text(cal),
                        "months": [m["name"] for m in cal["months"]], "weekdays": cal["weekdays"],
                        "moons": [{"name": m["name"], "color": m["color"],
                                   "phase": worldcal.moon_phase(m, worldcal.to_days(cal, cal["current"]))[1],
                                   "f": worldcal.moon_phase(m, worldcal.to_days(cal, cal["current"]))[0]} for m in cal["moons"]],
                        "holidays": [{"name": h["name"], "date": f"{worldcal.ordinal(h['day'])} of {cal['months'][h['month']]['name']}", "note": h.get("note", "")}
                                     for h in sorted(cal["holidays"], key=lambda h: (h["month"], h["day"]))],
                        "events": [{"title": e["title"], "date": worldcal.format_date(cal, e["date"]),
                                    "end": worldcal.format_date(cal, e["end"]) if e.get("end") else "",
                                    "page": e.get("page") if e.get("page") in ok else None, "note": e.get("note", "")} for e in evs]}

    clocks = []
    if opts.get("clocks"):
        clocks = [{"name": c["name"], "segments": c["segments"], "filled": c["filled"], "color": c["color"], "note": c.get("note", ""),
                   "kind": c.get("kind", ""), "page": c.get("page") if c.get("page") in ok else None}
                  for c in clocks_mod.all_clocks(camp) if not c.get("gm") and not c.get("archived")]

    data = {"name": opts.get("title") or camp.name, "built": time.strftime("%Y-%m-%d %H:%M"), "home": "index" if "index" in ok else None,
            "tree": _tree(tree["children"], ok), "pages": data_pages, "names": names, "recaps": recaps, "maps": maps,
            "handouts": handouts, "calendar": calendar, "clocks": clocks}
    (out / "data.js").write_text("window.LORE = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    for name in ("index.html", "style.css"):
        shutil.copy2(TEMPLATE / name, out / name)
    # one classic script (ES modules don't load from file://, and the site should open straight from disk)
    parts = []
    for f in (WEB / "js" / "markdown.js", WEB / "js" / "pinicons.js"):
        parts.append(re.sub(r"^export\s+", "", f.read_text(encoding="utf-8"), flags=re.M))
    parts.append((TEMPLATE / "viewer.js").read_text(encoding="utf-8"))
    (out / "site.js").write_text("(function () {\n" + "\n".join(parts) + "\n})();\n", encoding="utf-8")
    for old in ("md.js", "pinicons.js", "viewer.js"):
        (out / old).unlink(missing_ok=True)
    fav = WEB / "assets" / "favicon.png"
    if fav.exists():
        shutil.copy2(fav, out / "favicon.png")
    log(f"Done: {out}")
    return {"path": str(out), "pages": len(data_pages), "recaps": len(recaps), "maps": len(maps), "handouts": len(handouts),
            "index": str(out / "index.html")}
