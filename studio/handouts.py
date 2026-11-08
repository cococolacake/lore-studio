"""Handouts: pictures and notes to give the players — letters, wanted posters, maps, a portrait of the stranger.

Stored in <campaign>/handouts/handouts.json, with images beside it. A handout can be shown in Foundry (it pops up
for everyone), posted to Discord, and revealed in the player lore book.
"""
import base64
import hashlib
import json
import mimetypes
import re
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from . import __version__
from .campaign import CampaignError
from .util import read_json, write_json

IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"}


def _dir(camp):
    d = camp.root / "handouts"
    d.mkdir(exist_ok=True)
    return d


def all_handouts(camp):
    items = read_json(_dir(camp) / "handouts.json", []) or []
    for x in items:
        x["image_url"] = f"/c/handouts/{x['image']}" if x.get("image") else ""
    return items


def _save_all(camp, items):
    write_json(_dir(camp) / "handouts.json", [{k: v for k, v in x.items() if k != "image_url"} for x in items])


def get(camp, hid):
    x = next((x for x in all_handouts(camp) if x["id"] == hid), None)
    if not x:
        raise CampaignError("That handout doesn't exist anymore.")
    return x


def _store_image(camp, image):
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
        return None
    name = hashlib.sha1(data).hexdigest()[:12] + (".jpg" if ext == ".jpeg" else ext)
    (_dir(camp) / name).write_bytes(data)
    return name


def save(camp, item, image=None):
    items = all_handouts(camp)
    clean = {"title": str(item.get("title") or "").strip()[:120] or "Handout", "text": str(item.get("text") or "")[:20000],
             "page": item.get("page") or None, "session": item.get("session") or None,
             "gm_note": str(item.get("gm_note") or "")[:2000], "revealed": bool(item.get("revealed"))}
    if image:
        clean["image"] = _store_image(camp, image)
    elif item.get("remove_image"):
        clean["image"] = ""
    if item.get("id"):
        for x in items:
            if x["id"] == item["id"]:
                x.update(clean)
                break
        else:
            raise CampaignError("That handout doesn't exist anymore.")
        hid = item["id"]
    else:
        hid = "h" + uuid.uuid4().hex[:8]
        clean.update({"id": hid, "image": clean.get("image") or "", "created": time.strftime("%Y-%m-%d %H:%M"), "shown": []})
        items.append(clean)
    _save_all(camp, items)
    return get(camp, hid)


def delete(camp, hid):
    items = all_handouts(camp)
    x = next((x for x in items if x["id"] == hid), None)
    _save_all(camp, [i for i in items if i["id"] != hid])
    if x and x.get("image") and not any(i.get("image") == x["image"] for i in items if i["id"] != hid):
        f = _dir(camp) / x["image"]
        trash = camp.root / ".trash" / "handouts"
        trash.mkdir(parents=True, exist_ok=True)
        if f.exists():
            f.replace(trash / f.name)
    return True


def mark(camp, hid, where, revealed=None):
    items = all_handouts(camp)
    for x in items:
        if x["id"] == hid:
            if where:
                x.setdefault("shown", []).append({"to": where, "time": time.strftime("%Y-%m-%d %H:%M")})
            if revealed is not None:
                x["revealed"] = bool(revealed)
    _save_all(camp, items)
    return get(camp, hid)


def image_bytes(camp, x):
    if not x.get("image"):
        return None, None
    f = _dir(camp) / x["image"]
    return (f.read_bytes(), x["image"]) if f.is_file() else (None, None)


def data_url(camp, x):
    data, name = image_bytes(camp, x)
    if not data:
        return ""
    mime = mimetypes.guess_type(name)[0] or "image/png"
    return f"data:{mime};base64," + base64.b64encode(data).decode()


# ---- Discord --------------------------------------------------------------------------------

def post_discord(url, message, image=None, filename="handout.png", opener=None):
    """One webhook message, optionally with an image attached and shown in its embed."""
    from . import discord
    if not discord.valid_url(url):
        raise ValueError("That doesn't look like a Discord webhook URL.")
    headers = {"User-Agent": f"DiscordBot (https://github.com/cococolacake/lore-studio, {__version__})"}
    if image:
        for e in message.get("embeds") or []:
            e["image"] = {"url": f"attachment://{filename}"}
        if not message.get("embeds"):
            message["attachments"] = [{"id": 0, "filename": filename}]
        boundary = "lore" + uuid.uuid4().hex
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"payload_json\"\r\nContent-Type: application/json\r\n\r\n"
                f"{json.dumps(message)}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"files[0]\"; filename=\"{filename}\"\r\n"
                f"Content-Type: {mime}\r\n\r\n").encode() + image + f"\r\n--{boundary}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    else:
        body = json.dumps(message).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url + "?wait=true", data=body, method="POST", headers=headers)
    try:
        with (opener or urllib.request.urlopen)(req, timeout=60) as r:
            return json.loads(r.read().decode() or "{}").get("id")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Discord refused the post ({e.code}). {e.read().decode(errors='replace')[:200]}") from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"Couldn't reach Discord: {e.reason}") from None


def discord_message(camp, x, text, cfg):
    from . import discord
    msg = {"allowed_mentions": {"parse": []}}
    if cfg.get("username"):
        msg["username"] = cfg["username"][:80]
    if cfg.get("avatar_url"):
        msg["avatar_url"] = cfg["avatar_url"]
    body = discord.to_discord_markdown(text or "")[:3900]
    msg["embeds"] = [{"title": x["title"][:250], "description": body or None, "color": 0x9381FF}]
    if not body:
        msg["embeds"][0].pop("description")
    return msg
