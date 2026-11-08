"""AI tag suggestions for lore pages. Nothing is tagged until the GM approves it.

The AI (Claude or a local model) reads pages a few at a time, with the campaign's existing tags so it reuses them,
and proposes tags. Proposals wait in <campaign>/tag-suggestions.json until accepted or dismissed.
"""
import re
import time

from . import claude, recaps
from .util import Task, read_json, write_json

TOOL = {
    "name": "suggest_tags",
    "description": "Suggest tags for each lore page.",
    "input_schema": {"type": "object", "properties": {"pages": {"type": "array", "items": {"type": "object", "properties": {
        "id": {"type": "string", "description": "The page id exactly as given"},
        "tags": {"type": "array", "items": {"type": "string"}, "description": "1 to 4 new tags, lowercase"}},
        "required": ["id", "tags"]}}}, "required": ["pages"]},
}

TASK = """Suggest tags for these lore pages from the tabletop campaign “{name}”, so the GM can search and filter them.

Tags already used in this campaign (tag: pages). Reuse these whenever one fits; only invent a new tag when nothing fits:
{vocab}

Good tags say what a page is (character, npc, location, city, organization, item, deity, event…), where it belongs
(a region or plane), and what it's part of (a faction, an arc). Use lowercase, single words or hyphenated-words.
Suggest 1 to 4 tags per page, never ones the page already has. Skip a page (empty list) if it already has good tags.

{pages}

Call suggest_tags once with every page id."""


def _file(camp):
    return camp.root / "tag-suggestions.json"


def clean_tag(t):
    t = re.sub(r"[^\w\s-]", "", str(t or "").strip().lower().lstrip("#"))
    return re.sub(r"[\s_]+", "-", t).strip("-")[:40]


def pending(camp):
    """{page id: {"add": [...], "created", "model"}}, dropping pages that no longer exist or tags they already have."""
    data = read_json(_file(camp), {}) or {}
    pages = {p["id"]: p for p in camp.pages()}
    out = {}
    for pid, s in data.items():
        p = pages.get(pid)
        if not p:
            continue
        have = {t.lower() for t in p["tags"]}
        add = [t for t in s.get("add", []) if t not in have]
        if add:
            out[pid] = {**s, "add": add, "title": p["title"], "tags": p["tags"]}
    return out


def _save(camp, data):
    write_json(_file(camp), {pid: {k: v for k, v in s.items() if k in ("add", "created", "model")} for pid, s in data.items()})


def accept(camp, pid, tags=None):
    """Add the suggested tags (or just `tags`) to the page."""
    data = pending(camp)
    s = data.get(pid)
    if not s:
        return {"added": []}
    chosen = [t for t in (tags or s["add"]) if t in s["add"]]
    page = camp.read_page(pid)
    meta = dict(page["meta"])
    current = meta.get("tags") or []
    if isinstance(current, str):
        current = [x.strip() for x in current.split(",") if x.strip()]
    meta["tags"] = current + [t for t in chosen if t not in current]
    camp.write_page(pid, meta, page["body"])
    s["add"] = [t for t in s["add"] if t not in chosen]
    if not s["add"]:
        data.pop(pid)
    _save(camp, data)
    return {"added": chosen}


def dismiss(camp, pid, tags=None):
    data = pending(camp)
    if pid in data:
        if tags:
            data[pid]["add"] = [t for t in data[pid]["add"] if t not in tags]
        if not tags or not data[pid]["add"]:
            data.pop(pid)
        _save(camp, data)
    return True


def accept_all(camp):
    n = 0
    for pid in list(pending(camp)):
        n += len(accept(camp, pid)["added"])
    return n


def pick_pages(camp, scope="untagged", pid=None, folder=None):
    pages = camp.pages()
    if scope == "page":
        return [p for p in pages if p["id"] == pid]
    if scope == "folder" and folder:
        base = folder[:-len("/index")] if folder.endswith("/index") else folder
        return [p for p in pages if p["id"] == folder or p["id"].startswith(base + "/")]
    if scope == "untagged":
        return [p for p in pages if not p["tags"]]
    return pages


def _batch_size():
    return 3 if claude.is_local() else 8


def _excerpt_chars():
    return 900 if claude.is_local() else 1600


def estimate(camp, scope="untagged", pid=None, folder=None):
    pages = [p for p in pick_pages(camp, scope, pid, folder) if p["body"].strip() or p["title"]]
    calls = -(-len(pages) // _batch_size()) if pages else 0
    per_call_in = 900 + claude.estimate_tokens("x" * (_excerpt_chars() + 150)) * _batch_size()
    model = claude.current_model()
    return {"pages": len(pages), "calls": calls, "model": model, "local": claude.is_local(),
            "cost": claude.cost(model, per_call_in * calls, 120 * _batch_size() * calls)}


def _page_block(p):
    folder = p["id"].rsplit("/", 1)[0] if "/" in p["id"] else ""
    text = recaps._cut(re.sub(r"\{\{\w+\}\}", "", p["body"]), _excerpt_chars()) or "(no text yet)"
    return (f'<page id="{p["id"]}" title="{p["title"]}" folder="{folder}" current_tags="{", ".join(p["tags"])}">\n'
            f"{text}\n</page>")


def run(task, camp, pids, opener=None):
    model = claude.current_model()
    pages = {p["id"]: p for p in camp.pages()}
    pids = [x for x in pids if x in pages]
    size = _batch_size()
    found = read_json(_file(camp), {}) or {}
    total = 0
    for i in range(0, len(pids), size):
        batch = [pages[x] for x in pids[i:i + size]]
        task.progress = {"stage": "tags", "done": i, "total": len(pids)}
        task.log(f"Reading {', '.join(p['title'] for p in batch)}…")
        vocab = "\n".join(f"{t['tag']}: {t['count']}" for t in camp.tags()[:150]) or "(none yet)"
        block = "\n\n".join(_page_block(p) for p in batch)
        resp = claude.message(model, ["You organise a game master's lore notes. Be consistent and conservative with tags."],
                              [{"role": "user", "content": TASK.format(name=camp.name, vocab=vocab, pages=block)}],
                              max_tokens=1500, tools=[TOOL], tool_choice={"type": "tool", "name": "suggest_tags"}, opener=opener)
        out = claude.tool_input(resp, "suggest_tags") or {}
        for item in out.get("pages") or []:
            pid = item.get("id")
            if pid not in pages:
                continue
            have = {t.lower() for t in pages[pid]["tags"]}
            add = []
            for t in item.get("tags") or []:
                t = clean_tag(t)
                if t and t not in have and t not in add:
                    add.append(t)
            if add:
                prev = found.get(pid, {}).get("add", [])
                found[pid] = {"add": prev + [t for t in add[:4] if t not in prev], "created": time.strftime("%Y-%m-%d %H:%M"), "model": model}
                total += len(add[:4])
        write_json(_file(camp), found)
    task.progress = {"stage": "done", "done": len(pids), "total": len(pids)}
    task.log(f"Done: {total} tags suggested for {len([p for p in pids if p in found])} pages. Review them on the Lore page.")
    return {"suggested": total}


def start(camp, scope="untagged", pid=None, folder=None):
    claude.ready()
    pids = [p["id"] for p in pick_pages(camp, scope, pid, folder)]
    if not pids:
        raise claude.ClaudeError("No pages to tag." if scope != "untagged" else "Every page already has tags.")
    task = Task.spawn(f"Suggesting tags for {len(pids)} page{'s' if len(pids) != 1 else ''}", run, camp, pids)
    task.kind = "tags"
    return task.id
