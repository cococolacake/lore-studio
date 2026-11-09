"""Inspiration boards: a free canvas of pictures, sticky notes, page cards and links, joined by strings.

Stored in <campaign>/boards/<id>.json, with pictures in boards/img/. A board can belong to a lore page or a session.
"""
import base64
import hashlib
import re
import time
import uuid
from pathlib import Path

from .campaign import CampaignError
from .util import read_json, write_json

IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"}
ITEM_TYPES = {"image", "note", "page", "link", "text"}


def _dir(camp):
    d = camp.root / "boards"
    (d / "img").mkdir(parents=True, exist_ok=True)
    return d


def _path(camp, bid):
    if not re.fullmatch(r"[\w-]{3,64}", bid or ""):
        raise CampaignError("Bad board id.")
    return _dir(camp) / f"{bid}.json"


def list_boards(camp):
    out = []
    for f in _dir(camp).glob("*.json"):
        b = read_json(f, None)
        if b:
            imgs = [i["src"] for i in b.get("items", []) if i.get("type") == "image" and i.get("src")]
            out.append({"id": b["id"], "name": b.get("name") or "Board", "page": b.get("page"), "session": b.get("session"),
                        "items": len(b.get("items") or []), "updated": b.get("updated", ""), "cover": imgs[0] if imgs else ""})
    return sorted(out, key=lambda b: b["updated"], reverse=True)


def read(camp, bid):
    b = read_json(_path(camp, bid), None)
    if not b:
        raise CampaignError("That board doesn't exist anymore.")
    return b


def create(camp, name="New board", page=None, session=None):
    bid = time.strftime("%Y%m%d-") + uuid.uuid4().hex[:6]
    b = {"id": bid, "name": (name or "New board").strip()[:80], "page": page or None, "session": session or None,
         "items": [], "links": [], "created": time.strftime("%Y-%m-%d %H:%M"), "updated": time.strftime("%Y-%m-%d %H:%M")}
    write_json(_path(camp, bid), b)
    return b


def _num(v, lo, hi, default):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


def save(camp, board):
    """Replace a board's contents (the canvas saves the whole board after each change)."""
    old = read(camp, board["id"])
    items = []
    for it in board.get("items") or []:
        t = it.get("type")
        if t not in ITEM_TYPES:
            continue
        clean = {"id": str(it.get("id") or "i" + uuid.uuid4().hex[:8])[:20], "type": t,
                 "x": _num(it.get("x"), -1e6, 1e6, 0), "y": _num(it.get("y"), -1e6, 1e6, 0),
                 "w": _num(it.get("w"), 40, 4000, 220), "h": _num(it.get("h"), 30, 4000, 160),
                 "color": str(it.get("color") or "")[:9], "rot": _num(it.get("rot"), -20, 20, 0)}
        if t == "image":
            clean["src"] = str(it.get("src") or "")[:300]
            clean["caption"] = str(it.get("caption") or "")[:300]
            if it.get("cap") is not None:
                clean["cap"] = bool(it.get("cap"))
        elif t in ("note", "text"):
            clean["text"] = str(it.get("text") or "")[:5000]
        elif t == "page":
            clean["page"] = str(it.get("page") or "")[:300]
        elif t == "link":
            url = str(it.get("url") or "")
            clean["url"] = url[:1000] if url.startswith(("http://", "https://")) else ""
            clean["title"] = str(it.get("title") or "")[:200]
        items.append(clean)
    ids = {i["id"] for i in items}
    def spot(a):
        """Where a string is pinned on an item, as fractions of its size; None = the old default (top middle)."""
        if not isinstance(a, dict):
            return None
        return {"x": _num(a.get("x"), 0, 1, 0.5), "y": _num(a.get("y"), 0, 1, 0.5)}

    links = []
    for l in board.get("links") or []:
        if l.get("from") in ids and l.get("to") in ids and l["from"] != l["to"]:
            link = {"from": l["from"], "to": l["to"], "color": str(l.get("color") or "#E5626A")[:9], "label": str(l.get("label") or "")[:80]}
            for end in ("fa", "ta"):
                if spot(l.get(end)):
                    link[end] = spot(l.get(end))
            links.append(link)
    old.update({"name": str(board.get("name") or old["name"]).strip()[:80], "page": board.get("page", old.get("page")) or None,
                "session": board.get("session", old.get("session")) or None, "items": items, "links": links,
                "updated": time.strftime("%Y-%m-%d %H:%M")})
    write_json(_path(camp, board["id"]), old)
    return old


def delete(camp, bid):
    f = _path(camp, bid)
    trash = camp.root / ".trash" / "boards"
    trash.mkdir(parents=True, exist_ok=True)
    if f.exists():
        f.replace(trash / f.name)
    return True


def add_image(camp, image):
    """Store a picture for boards; returns its campaign-relative path."""
    if image.get("path"):
        src = Path(image["path"]).expanduser()
        ext = src.suffix.lower()
        if not src.is_file() or ext not in IMAGE_TYPES:
            raise CampaignError("Pick a PNG, JPG, WebP, AVIF or GIF image.")
        data = src.read_bytes()
    elif image.get("data_url"):
        m = re.match(r"data:image/([\w+.-]+);base64,(.*)$", image["data_url"], re.S)
        if not m:
            raise CampaignError("That isn't an image.")
        ext = "." + {"jpeg": "jpg"}.get(m.group(1), m.group(1))
        if ext not in IMAGE_TYPES:
            raise CampaignError("Pick a PNG, JPG, WebP, AVIF or GIF image.")
        data = base64.b64decode(m.group(2))
    else:
        raise CampaignError("No image given.")
    if len(data) > 30 * 1024 * 1024:
        raise CampaignError("That image is over 30 MB.")
    name = hashlib.sha1(data).hexdigest()[:14] + (".jpg" if ext == ".jpeg" else ext)
    (_dir(camp) / "img" / name).write_bytes(data)
    return f"boards/img/{name}"


def for_page(camp, pid):
    return [b for b in list_boards(camp) if b["page"] == pid]


def for_session(camp, sid):
    return [b for b in list_boards(camp) if b["session"] == sid]
