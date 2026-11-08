"""Header images for lore pages ("banners").

A page's banner is stored in its frontmatter as `banner:` — a path inside the campaign (assets/banners/...) or, for
pages imported from LegendKeeper before their images were downloaded, a web address. `banner_y` (0-100) is which part
of the image shows in the strip.
"""
import base64
import hashlib
import re
import urllib.request
from pathlib import Path

from .campaign import CampaignError

IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"}
MAX_BYTES = 25 * 1024 * 1024


def _slug(text):
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:50] or "banner"


def _save(camp, pid, data, ext):
    if len(data) > MAX_BYTES:
        raise CampaignError("That image is over 25 MB. Pick a smaller one.")
    d = camp.root / "assets" / "banners"
    d.mkdir(parents=True, exist_ok=True)
    name = f"{_slug(pid.replace('/index', '').rsplit('/', 1)[-1])}-{hashlib.sha1(data).hexdigest()[:8]}{ext}"
    (d / name).write_bytes(data)
    return f"assets/banners/{name}"


def _download(url, opener=None, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "lore-studio"})
    with (opener or urllib.request.urlopen)(req, timeout=timeout) as r:
        data = r.read(MAX_BYTES + 1)
        ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip()
    ext = Path(url.split("?")[0]).suffix.lower()
    if ext not in IMAGE_TYPES:
        ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
               "image/avif": ".avif"}.get(ctype, ".jpg")
    return data, (".jpg" if ext == ".jpeg" else ext)


def store(camp, pid, image, opener=None):
    """image: {"path": a file on this computer} | {"data_url": "data:image/..."} | {"url": "https://..."}.
    Returns the banner value to put in the page's frontmatter."""
    if image.get("path"):
        src = Path(image["path"]).expanduser()
        ext = src.suffix.lower()
        if not src.is_file() or ext not in IMAGE_TYPES:
            raise CampaignError("Pick a PNG, JPG, WebP, AVIF or GIF image.")
        return _save(camp, pid, src.read_bytes(), ".jpg" if ext == ".jpeg" else ext)
    if image.get("data_url"):
        m = re.match(r"data:image/([\w+.-]+);base64,(.*)$", image["data_url"], re.S)
        if not m:
            raise CampaignError("That isn't an image.")
        ext = "." + {"jpeg": "jpg", "svg+xml": "svg"}.get(m.group(1), m.group(1))
        if ext not in IMAGE_TYPES:
            raise CampaignError("Pick a PNG, JPG, WebP, AVIF or GIF image.")
        return _save(camp, pid, base64.b64decode(m.group(2)), ext)
    url = (image.get("url") or "").strip()
    if url.startswith(("http://", "https://")):
        try:
            data, ext = _download(url, opener)
            return _save(camp, pid, data, ext)
        except Exception:
            return url          # couldn't fetch it now: keep the link, it still shows while online
    raise CampaignError("No image given.")


def set_banner(camp, pid, image=None, y=None, remove=False, opener=None):
    page = camp.read_page(pid)
    meta, body = dict(page["meta"]), page["body"]
    old = meta.get("banner") or ""
    if remove:
        meta.pop("banner", None)
        meta.pop("banner_y", None)
    if image:
        meta["banner"] = store(camp, pid, image, opener)
        meta.pop("banner_y", None)
    if y is not None:
        meta["banner_y"] = max(0, min(100, int(round(float(y)))))
    camp.write_page(pid, meta, body)
    if old and old != meta.get("banner") and old.startswith("assets/banners/"):
        _remove_if_unused(camp, old)
    return camp.read_page(pid)


def _remove_if_unused(camp, rel):
    if any(p.get("banner") == rel for p in camp.pages()):
        return
    f = camp.root / rel
    if f.is_file():
        trash = camp.root / ".trash" / "banners"
        trash.mkdir(parents=True, exist_ok=True)
        f.replace(trash / f.name)


def download_all(camp, log=print, opener=None):
    """Save every banner that is still a web link into the campaign, so pages look right offline."""
    done = failed = 0
    for p in camp.pages():
        url = p.get("banner") or ""
        if not url.startswith(("http://", "https://")):
            continue
        try:
            data, ext = _download(url, opener)
            page = camp.read_page(p["id"])
            meta = dict(page["meta"])
            meta["banner"] = _save(camp, p["id"], data, ext)
            camp.write_page(p["id"], meta, page["body"])
            done += 1
            log(f"Saved the banner for {p['title']}")
        except Exception as e:
            failed += 1
            log(f"Couldn't download the banner for {p['title']}: {e}")
    return {"saved": done, "failed": failed}


def remote_count(camp):
    return sum(1 for p in camp.pages() if str(p.get("banner") or "").startswith(("http://", "https://")))
