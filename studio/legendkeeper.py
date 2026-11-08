"""Import a LegendKeeper project export (the JSON from "Export project") into a campaign folder.

What comes across:
  - every wiki page, as Markdown, keeping the page tree (a page with subpages becomes a folder
    with an index.md), tags, aliases, banners and page order
  - LegendKeeper secret blocks become :::gm blocks (GM-only, stripped from player exports)
  - callout panels become :::callout blocks, subpage indexes become {{children}}
  - the "Campaign Log" pages become sessions (sessions/NNN-title/recap.md)
  - maps (image, bounds, pins linked to pages) are kept in maps/ for the map viewer
  - calendars and timelines are kept as JSON so nothing is lost
  - top-level template pages (Character, Location...) go to templates/, not into your lore

Images stay on LegendKeeper's servers for now; their links are kept.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

from . import campaign as campaign_mod
from . import frontmatter
from . import maps as maps_mod
from .util import natural_key, safe_name, write_json

LOG_NAMES = ("campaign log", "session log", "sessions", "session recaps")

# Top-level folder names -> the tag every page inside them gets (anything else: the folder name itself)
CATEGORY_TAGS = {
    "characters": "character", "npcs": "npc", "people": "character",
    "world map": "location", "locations": "location", "places": "location", "world": "location",
    "planes of existence": "plane", "planes": "plane",
    "history": "history", "society": "society", "organizations / groups": "organization",
    "organizations": "organization", "factions": "faction", "religion": "religion",
    "items": "item", "artifacts": "artifact", "creatures": "creature", "bestiary": "creature",
}


def tag_slug(name):
    return re.sub(r"[^\w]+", "-", (name or "").strip().lower(), flags=re.UNICODE).strip("-")


def auto_tags(ancestors):
    """Tags a page gets from where it sits: the closest category folder above it
    (Characters -> character), plus its parent's name when the parent isn't a category itself."""
    if not ancestors:
        return []
    low = [a.strip().lower() for a in ancestors]
    cat = next((CATEGORY_TAGS[a] for a in reversed(low) if a in CATEGORY_TAGS), tag_slug(low[0]))
    tags = [cat]
    if len(ancestors) > 1 and low[-1] not in CATEGORY_TAGS:
        tags.append(tag_slug(ancestors[-1]))
    return [t for i, t in enumerate(tags) if t and t not in tags[:i]]


# ---- ProseMirror -> Markdown ----------------------------------------------

def _escape(text):
    return re.sub(r"([\\*`\[\]])", r"\\\1", text)


def _inline(nodes):
    out = []
    for n in nodes or []:
        t = n.get("type")
        if t == "text":
            text = _escape(n.get("text", ""))
            marks = {m.get("type") for m in n.get("marks") or []}
            href = next((m.get("attrs", {}).get("href") for m in n.get("marks") or [] if m.get("type") == "link"), None)
            core = text.strip()
            if core:
                lead = text[: len(text) - len(text.lstrip())]
                trail = text[len(text.rstrip()):]
                if "underline" in marks and "strong" not in marks:
                    core = f"<u>{core}</u>"
                if "em" in marks:
                    core = f"*{core}*"
                if "strong" in marks:
                    core = f"**{core}**"
                if "code" in marks:
                    core = f"`{n.get('text', '').strip()}`"
                if href:
                    core = f"[{core}]({href})"
                text = lead + core + trail
            out.append(text)
        elif t == "hardBreak":
            out.append("  \n")
        elif t in ("mention", "inlineCard"):
            label = (n.get("attrs") or {}).get("text") or (n.get("attrs") or {}).get("name") or ""
            out.append(f"[[{label.lstrip('@')}]]" if label else "")
        elif n.get("content"):
            out.append(_inline(n["content"]))
    return "".join(out)


def _blocks(nodes, ctx, depth=0):
    parts = []
    for n in nodes or []:
        md = _block(n, ctx, depth)
        if md is not None and md.strip() != "":
            parts.append(md.rstrip())
    return "\n\n".join(parts)


def _quote(text, prefix="> "):
    return "\n".join((prefix + line) if line.strip() else prefix.rstrip() for line in text.splitlines())


def _block(n, ctx, depth):
    t = n.get("type")
    attrs = n.get("attrs") or {}
    content = n.get("content") or []
    if t == "paragraph":
        return _inline(content)
    if t == "heading":
        level = max(1, min(6, int(attrs.get("level") or 2)))
        text = _inline(content).strip()
        # LegendKeeper headings are often fully bold/underlined; Markdown headings are bold already
        text = re.sub(r"^\*\*(.*)\*\*$", r"\1", text)
        return ("#" * level + " " + text) if text else ""
    if t == "blockquote":
        return _quote(_blocks(content, ctx, depth))
    if t == "panel":
        return ":::callout\n" + _blocks(content, ctx, depth) + "\n:::"
    if t == "rule":
        return "---"
    if t in ("bulletList", "orderedList"):
        lines = []
        for i, item in enumerate(content, 1):
            body = _blocks(item.get("content"), ctx, depth + 1)
            marker = f"{i}. " if t == "orderedList" else "- "
            first, *rest = body.splitlines() or [""]
            lines.append(marker + first)
            lines.extend(("   " if t == "orderedList" else "  ") + r if r.strip() else "" for r in rest)
        return "\n".join(lines)
    if t == "codeBlock":
        return "```\n" + "".join(c.get("text", "") for c in content) + "\n```"
    if t == "table":
        rows = []
        for row in content:
            cells = [re.sub(r"\s*\n\s*", " <br> ", _blocks(c.get("content"), ctx, depth)).replace("|", "\\|")
                     for c in row.get("content") or []]
            rows.append(cells)
        if not rows:
            return ""
        width = max(len(r) for r in rows)
        rows = [r + [""] * (width - len(r)) for r in rows]
        lines = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * width]
        lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
        return "\n".join(lines)
    if t == "bodiedExtension":
        key = (attrs.get("extensionKey") or "")
        inner = _blocks(content, ctx, depth)
        if "secret" in key:
            ctx["secrets"] += 1
            return ":::gm\n" + inner + "\n:::"
        return inner
    if t == "extension":
        key = attrs.get("extensionKey") or ""
        if key == "block-resource-collection":
            return "{{children}}"
        ctx["skipped"][key or "extension"] += 1
        return ""
    if t == "mediaSingle" or t == "media" or t == "image":
        src = attrs.get("url") or attrs.get("src") or ""
        for c in content:
            src = src or (c.get("attrs") or {}).get("url", "")
        return f"![]({src})" if src else ""
    if content:
        ctx["skipped"][t or "unknown"] += 1
        return _blocks(content, ctx, depth)
    if t:
        ctx["skipped"][t] += 1
    return ""


# ---- importer ---------------------------------------------------------------

def _sorted_children(kids):
    return sorted(kids, key=lambda r: (r.get("pos") or "", natural_key(r.get("name") or "")))


def _page_body(res, ctx):
    """Markdown body for a resource: its text documents in order (extra documents get a heading)."""
    docs = [d for d in res.get("documents") or [] if d.get("type") == "page"]
    parts = []
    for i, d in enumerate(sorted(docs, key=lambda d: d.get("pos") or "")):
        body = _blocks((d.get("content") or {}).get("content"), ctx)
        if not body.strip():
            continue
        if i > 0 or (len(docs) > 1 and d.get("name") not in ("Main", "Overview")):
            parts.append(f"## {d.get('name')}")
        parts.append(body)
    return "\n\n".join(parts).strip() + "\n"


def _meta(res, title=None, order=None, ancestors=None):
    meta = {"title": title or res.get("name") or "Untitled"}
    if res.get("aliases"):
        meta["aliases"] = [a if isinstance(a, str) else a.get("name", "") for a in res["aliases"]]
    tags = [tag_slug(t if isinstance(t, str) else t.get("name", "")) for t in res.get("tags") or []]
    tags += [t for t in auto_tags(ancestors or []) if t not in tags]
    if tags:
        meta["tags"] = tags
    if res.get("isHidden"):
        meta["visibility"] = "gm"
    banner = res.get("banner") or {}
    if banner.get("enabled") and banner.get("url"):
        meta["banner"] = banner["url"]
    if order is not None:
        meta["order"] = order
    meta["legendkeeper_id"] = res.get("id")
    return meta


def summarize(json_path):
    """Quick look at an export before importing: counts and the suggested campaign name."""
    data = json.loads(Path(json_path).read_text(encoding="utf-8"))
    res = data.get("resources") or []
    if not res or "documents" not in res[0]:
        raise campaign_mod.CampaignError("That doesn't look like a LegendKeeper project export (JSON).")
    kids = defaultdict(list)
    ids = {r["id"] for r in res}
    for r in res:
        kids[r.get("parentId") if r.get("parentId") in ids else None].append(r)
    roots = kids[None]

    def count(r):
        return 1 + sum(count(c) for c in kids[r["id"]])
    main = max(roots, key=count)
    log = next((r for r in res if (r.get("name") or "").strip().lower() in LOG_NAMES), None)
    under_main = set()
    stack = [main]
    while stack:
        r = stack.pop()
        under_main.add(r["id"])
        stack.extend(kids[r["id"]])
    maps = sum(1 for r in res if r["id"] in under_main for d in r.get("documents") or [] if d.get("type") == "map")
    stem = Path(json_path).stem.replace("_", " ").replace("-", " ").strip()
    return {"pages": len(res), "main": main.get("name"), "templates": [r["name"] for r in roots if r is not main],
            "sessions": len(kids[log["id"]]) if log else 0, "maps": maps,
            "suggested_name": stem or main.get("name") or "My Campaign"}


def import_project(json_path, dest, name, log=print, download_images=True):
    """Create a new campaign at dest from a LegendKeeper export. Returns a summary dict."""
    data = json.loads(Path(json_path).read_text(encoding="utf-8"))
    res = data.get("resources") or []
    if not res:
        raise campaign_mod.CampaignError("The export has no pages in it.")
    camp = campaign_mod.create(dest, name)
    root = camp.root
    (root / "lore" / "index.md").unlink(missing_ok=True)

    byid = {r["id"]: r for r in res}
    kids = defaultdict(list)
    for r in res:
        kids[r.get("parentId") if r.get("parentId") in byid else None].append(r)

    def count(r):
        return 1 + sum(count(c) for c in kids[r["id"]])
    roots = kids[None]
    main = max(roots, key=count)
    templates = [r for r in roots if r is not main]
    log_node = next((r for r in res if (r.get("name") or "").strip().lower() in LOG_NAMES), None)

    ctx = {"secrets": 0, "skipped": defaultdict(int)}
    where = {}          # resource id -> lore page id (for map pins and timelines)
    written = 0

    def write(path, meta, body):
        nonlocal written
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(frontmatter.dump(meta, body), encoding="utf-8")
        written += 1

    def place(r, folder, order, ancestors):
        children = _sorted_children(kids[r["id"]])
        is_log = r is log_node
        body = _page_body(r, ctx)
        if is_log:
            body = body.replace("{{children}}", "{{sessions}}")
            if "{{sessions}}" not in body:
                body += "\n{{sessions}}\n"
        lore_children = [] if is_log else children
        base = safe_name(r["name"] or "Untitled")
        if lore_children:
            d = folder / base
            n = 2
            while d.exists() or (folder / f"{d.name}.md").exists():
                d = folder / f"{base} ({n})"
                n += 1
            write(d / "index.md", _meta(r, order=order, ancestors=ancestors), body)
            where[r["id"]] = (d / "index.md").relative_to(root / "lore").with_suffix("").as_posix()
            for i, c in enumerate(lore_children):
                place(c, d, i, ancestors + [r["name"]])
        else:
            f = folder / f"{base}.md"
            n = 2
            while f.exists() or f.with_suffix("").exists():
                f = folder / f"{base} ({n}).md"
                n += 1
            write(f, _meta(r, order=order, ancestors=ancestors), body)
            where[r["id"]] = f.relative_to(root / "lore").with_suffix("").as_posix()

    log(f"Importing pages under “{main['name']}”…")
    write(root / "lore" / "index.md", _meta(main, title=main["name"]), _page_body(main, ctx))
    where[main["id"]] = "index"
    for i, c in enumerate(_sorted_children(kids[main["id"]])):
        place(c, root / "lore", i, [])

    # sessions from the campaign log
    sessions = 0
    if log_node:
        log("Turning the campaign log into sessions…")
        for i, r in enumerate(_sorted_children(kids[log_node["id"]])):
            m = re.match(r"^\s*(\d+)\s*[.:)\-]\s*(.*)$", r.get("name") or "")
            number, title = (int(m.group(1)), m.group(2).strip()) if m else (i + 1, r.get("name") or f"Session {i + 1}")
            sid = camp.create_session(title, number)
            d = camp.sessions_dir / sid
            info = json.loads((d / "session.json").read_text(encoding="utf-8"))
            info.update({"source": "legendkeeper", "legendkeeper_id": r["id"]})
            write_json(d / "session.json", info)
            (d / "recap.md").write_text(frontmatter.dump({"title": title}, _page_body(r, ctx)), encoding="utf-8")
            where[r["id"]] = None
            sessions += 1

    # templates, kept out of the lore tree
    if templates:
        log("Keeping LegendKeeper templates in templates/…")
        for r in templates:
            folder = root / "templates"
            folder.mkdir(exist_ok=True)
            body = _page_body(r, ctx)
            (folder / f"{safe_name(r['name'])}.md").write_text(frontmatter.dump(_meta(r), body), encoding="utf-8")

    # maps, calendars, timelines
    maps = 0
    for r in res:
        for d in r.get("documents") or []:
            if d.get("type") == "map" and r["id"] in where:
                m = d.get("map") or {}
                pins = []
                for p in (d.get("content") or {}).get("pins") or []:
                    uri = p.get("uri") or ""
                    target = uri.rsplit("/", 1)[-1] if uri.startswith("lk://resources/") else None
                    pins.append({"name": p.get("name"), "pos": p.get("pos"), "page": where.get(target),
                                 "color": p.get("iconColor"), "icon": p.get("iconGlyph"), "rank": p.get("rank")})
                name = r["name"] if d.get("name") in (None, "Main", "Map") else f"{r['name']} - {d['name']}"
                v1 = {"name": name, "page": where.get(r["id"]), "image": m.get("mapId") or m.get("locatorId"),
                      "bounds": [[m.get("min_y"), m.get("min_x")], [m.get("max_y"), m.get("max_x")]],
                      "max_zoom": m.get("max_zoom"), "pins": pins, "source": "legendkeeper"}
                mid = maps_mod._slug(name)
                write_json(root / "maps" / f"{mid}.json", maps_mod.convert_v1(v1))
                if download_images:
                    try:
                        log(f"Downloading the map image for “{name}”…")
                        maps_mod.download_image(camp, mid)
                    except Exception as e:  # keep the link; the map still works online
                        log(f"Couldn't download it ({e}); the map uses LegendKeeper's copy for now.")
                maps += 1
            elif d.get("type") == "time":
                content = d.get("content") or {}
                for ev in content.get("events") or []:
                    ev["page"] = where.get(ev.get("uri"))
                write_json(root / "timeline.legendkeeper.json", {"name": r["name"], "calendarId": d.get("calendarId"), **content})
    if data.get("calendars"):
        write_json(root / "calendar.json", {"source": "legendkeeper", "calendars": data["calendars"]})

    if download_images:
        from . import banners
        if banners.remote_count(camp):
            log("Downloading page banners…")
            r = banners.download_all(camp, log=lambda m: None)
            log(f"Saved {r['saved']} banners" + (f"; {r['failed']} stay as links for now." if r["failed"] else "."))
    camp.save_info({"imported_from": "legendkeeper", "legendkeeper_export": data.get("exportedAt")})
    summary = {"path": str(root), "pages": written, "sessions": sessions, "maps": maps,
               "secrets": ctx["secrets"], "templates": len(templates),
               "skipped": dict(ctx["skipped"])}
    log(f"Done: {written} pages, {sessions} sessions, {maps} maps, {ctx['secrets']} secret blocks.")
    return summary
