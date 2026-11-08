"""Maps with pins. One JSON file per map in the campaign's maps/ folder, the image beside it.

    maps/world-map.json
    {
      "version": 2, "name": "World Map", "page": "World Map/index",
      "image": "maps/world-map.png",          # a file in the campaign, or an https:// URL until downloaded
      "pins": [{"id": "p1", "name": "Westmarch", "x": 0.21, "y": 0.78,      # 0..1 across and down the image
                "page": "World Map/Westmarch/index", "map": "westmarch", # optional: a page and/or a sub-map
                "color": "#2629ea", "gm": false}]
    }

Maps imported from LegendKeeper (version 1, Leaflet coordinates) are converted on first read.
"""
import base64
import re
import time
import urllib.request
import uuid
from pathlib import Path

from .campaign import CampaignError
from .util import read_json, write_json

IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def _dir(camp):
    d = camp.root / "maps"
    d.mkdir(exist_ok=True)
    return d


def _path(camp, mid):
    mid = (mid or "").strip()
    if not mid or "/" in mid or "\\" in mid or mid.startswith("."):
        raise CampaignError("Bad map id.")
    return _dir(camp) / f"{mid}.json"


def _slug(name):
    s = re.sub(r"[^\w\- ]+", "", name or "", flags=re.UNICODE).strip().replace(" ", "-").lower()
    return s[:60] or "map"


def convert_v1(data):
    """LegendKeeper/Leaflet CRS.Simple pins -> fractions of the image."""
    (min_y, min_x), (max_y, max_x) = data.get("bounds") or [[-1, 0], [0, 1]]
    z = 2 ** int(data.get("max_zoom") or 0)
    w0 = (max_x - min_x) / z or 1
    h0 = (max_y - min_y) / z or 1
    pins = []
    for i, p in enumerate(data.get("pins") or []):
        lat, lng = (p.get("pos") or [0, 0])[:2]
        x = (lng - min_x / z) / w0
        y = (max_y / z - lat) / h0
        pins.append({"id": f"lk{i}", "name": p.get("name") or "", "x": round(min(1, max(0, x)), 5), "y": round(min(1, max(0, y)), 5),
                     "page": p.get("page"), "map": None, "color": p.get("color") or "#9381FF", "gm": False})
    return {"version": 2, "name": data.get("name") or "Map", "page": data.get("page"), "image": data.get("image") or "",
            "width": max_x - min_x, "height": max_y - min_y, "pins": pins, "source": data.get("source", "")}


def read(camp, mid):
    f = _path(camp, mid)
    data = read_json(f, None)
    if data is None:
        raise CampaignError("Map not found.")
    if data.get("version") != 2:
        data = convert_v1(data)
        write_json(f, data)
    data["id"] = mid
    img = data.get("image") or ""
    data["image_url"] = img if img.startswith(("http://", "https://")) else (f"/c/{img}" if img else "")
    data["remote"] = img.startswith(("http://", "https://"))
    return data


def _save(camp, mid, data):
    data = {k: v for k, v in data.items() if k not in ("id", "image_url", "remote")}
    write_json(_path(camp, mid), data)
    return read(camp, mid)


def list_maps(camp):
    out = []
    for f in sorted(_dir(camp).glob("*.json")):
        try:
            m = read(camp, f.stem)
        except Exception:
            continue
        out.append({"id": f.stem, "name": m["name"], "pins": len(m["pins"]), "page": m.get("page"),
                    "image_url": m["image_url"], "remote": m["remote"]})
    out.sort(key=lambda m: m["name"].lower())
    return out


def _store_image(camp, mid, image):
    """image: {"path": local file} or {"data_url": "...", "filename": "x.png"}. Returns the campaign-relative path."""
    if image.get("path"):
        src = Path(image["path"]).expanduser()
        ext = src.suffix.lower()
        if not src.is_file() or ext not in IMAGE_TYPES:
            raise CampaignError("Pick a PNG, JPG, WebP or GIF image.")
        data = src.read_bytes()
    elif image.get("data_url"):
        m = re.match(r"data:image/(\w+);base64,(.*)$", image["data_url"], re.S)
        if not m:
            raise CampaignError("That isn't an image.")
        ext = "." + ("jpg" if m.group(1) == "jpeg" else m.group(1))
        if ext not in IMAGE_TYPES:
            raise CampaignError("Pick a PNG, JPG, WebP or GIF image.")
        data = base64.b64decode(m.group(2))
    else:
        raise CampaignError("No image given.")
    dest = _dir(camp) / f"{mid}{ext}"
    for old in _dir(camp).glob(f"{mid}.*"):
        if old.suffix.lower() in IMAGE_TYPES and old != dest:
            old.unlink()
    dest.write_bytes(data)
    return f"maps/{dest.name}"


def create(camp, name, image=None, page=None):
    name = (name or "").strip() or "New map"
    mid = _slug(name)
    n = 2
    while _path(camp, mid).exists():
        mid = f"{_slug(name)}-{n}"
        n += 1
    data = {"version": 2, "name": name, "page": page, "image": "", "pins": []}
    write_json(_path(camp, mid), data)
    if image:
        data["image"] = _store_image(camp, mid, image)
    return _save(camp, mid, data)


def update(camp, mid, patch):
    data = read(camp, mid)
    for k in ("name", "page"):
        if k in (patch or {}):
            data[k] = patch[k]
    if patch.get("image"):
        data["image"] = _store_image(camp, mid, patch["image"])
    return _save(camp, mid, data)


def delete(camp, mid):
    f = _path(camp, mid)
    trash = camp.root / ".trash" / time.strftime("%Y%m%d-%H%M%S") / "maps"
    trash.mkdir(parents=True, exist_ok=True)
    for p in [f, *[x for x in _dir(camp).glob(f"{mid}.*") if x.suffix.lower() in IMAGE_TYPES]]:
        if p.exists():
            p.replace(trash / p.name)
    for other in list_maps(camp):          # unlink pins that pointed at this map
        d = read(camp, other["id"])
        if any(p.get("map") == mid for p in d["pins"]):
            for p in d["pins"]:
                if p.get("map") == mid:
                    p["map"] = None
            _save(camp, other["id"], d)
    return True


def save_pin(camp, mid, pin):
    """Add (no id) or update a pin."""
    data = read(camp, mid)
    clean = {"name": (pin.get("name") or "").strip(), "x": float(pin.get("x", 0.5)), "y": float(pin.get("y", 0.5)),
             "page": pin.get("page") or None, "map": pin.get("map") or None,
             "color": pin.get("color") or "#9381FF", "gm": bool(pin.get("gm"))}
    clean["x"] = min(1.0, max(0.0, clean["x"]))
    clean["y"] = min(1.0, max(0.0, clean["y"]))
    if clean["map"] == mid:
        clean["map"] = None
    if pin.get("id"):
        for p in data["pins"]:
            if p["id"] == pin["id"]:
                p.update(clean)
                break
        else:
            raise CampaignError("Pin not found.")
    else:
        clean["id"] = "p" + uuid.uuid4().hex[:8]
        data["pins"].append(clean)
    return _save(camp, mid, data)


def delete_pin(camp, mid, pin_id):
    data = read(camp, mid)
    data["pins"] = [p for p in data["pins"] if p["id"] != pin_id]
    return _save(camp, mid, data)


def pins_for_page(camp, pid):
    """Where a lore page appears on maps: [{"map", "name", "pin"}]."""
    out = []
    for m in list_maps(camp):
        d = read(camp, m["id"])
        for p in d["pins"]:
            if p.get("page") == pid:
                out.append({"map": m["id"], "name": d["name"], "pin": p["id"], "gm": p.get("gm", False)})
        if d.get("page") == pid and not any(o["map"] == m["id"] for o in out):
            out.append({"map": m["id"], "name": d["name"], "pin": None, "gm": False})
    return out


def download_image(camp, mid, opener=None, timeout=120):
    """Fetch a remote map image (e.g. from LegendKeeper) into the campaign, so the map works offline."""
    data = read(camp, mid)
    url = data.get("image") or ""
    if not url.startswith(("http://", "https://")):
        return data
    ext = Path(url.split("?")[0]).suffix.lower()
    if ext not in IMAGE_TYPES:
        ext = ".png"
    req = urllib.request.Request(url, headers={"User-Agent": "lore-studio"})
    with (opener or urllib.request.urlopen)(req, timeout=timeout) as r:
        body = r.read()
    dest = _dir(camp) / f"{mid}{ext}"
    dest.write_bytes(body)
    data["image"] = f"maps/{dest.name}"
    return _save(camp, mid, data)

