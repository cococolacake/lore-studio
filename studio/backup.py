"""Export everything: one .zip with the whole campaign, the app settings that go with it, and (if you like) the
recordings. Restore puts it back on this or another computer.

    campaign/            the campaign folder, exactly as Lore Studio keeps it
    app/settings.json    Lore Studio's settings (API keys, passwords and tokens blanked unless you include them)
    app/themes/          your saved colour themes
    recordings/          session recordings that live outside the campaign folder (only if you include them)
    manifest.json        what's in here, for restoring
    README.txt           the same, for people
"""
import json
import os
import time
import zipfile
from pathlib import Path

from . import __version__, paths, settings
from .util import read_json, write_json

SKIP_DIRS = {"player-site", "__pycache__", ".git"}            # rebuilt from the campaign at any time
MEDIA = {".mp4", ".mkv", ".mov", ".flv", ".webm", ".wav", ".mp3", ".m4a", ".ogg", ".opus", ".flac", ".aac", ".mka"}


def _safe(name):
    return "".join(c for c in name if c not in '<>:"/\\|?*').strip() or "Campaign"


def default_name(camp):
    return f"{_safe(camp.name)} backup {time.strftime('%Y-%m-%d')}.zip"


def _campaign_files(root, include_media):
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = Path(dirpath).relative_to(root)
        dirnames[:] = [d for d in dirnames if not (rel_dir == Path(".") and d in SKIP_DIRS) and d not in ("__pycache__", ".git")]
        for f in filenames:
            p = Path(dirpath) / f
            if not include_media and p.suffix.lower() in MEDIA:
                continue
            yield p, rel_dir / f


def _scrub_campaign_info(info, keep_secrets):
    info = json.loads(json.dumps(info))
    if not keep_secrets:
        for w in (info.get("discord") or {}).get("webhooks") or []:
            if isinstance(w, dict) and w.get("url"):
                w["url"] = ""
                w["removed"] = "webhook removed from the backup; paste it again in Settings → Discord"
    return info


def _scrub_settings(s, keep_secrets):
    s = dict(s)
    if not keep_secrets:
        for k in settings.SECRET_KEYS:
            if s.get(k):
                s[k] = ""
        for k in ("foundry_token",):
            s.pop(k, None)
    return s


def export(camp, dest, include_media=False, include_settings=True, include_secrets=False, log=print, progress=None):
    """Write the backup .zip to dest (a folder, or a path ending in .zip). Returns its path."""
    dest = Path(dest).expanduser()
    if dest.suffix.lower() != ".zip":
        dest.mkdir(parents=True, exist_ok=True)
        dest = dest / default_name(camp)
    root = camp.root.resolve()
    if dest.resolve().is_relative_to(root):
        raise ValueError("Save the backup outside the campaign folder, or it would end up inside itself.")
    files = list(_campaign_files(root, include_media))
    recordings = []
    if include_media:
        for sdir in sorted((root / "sessions").glob("*")):
            rec = read_json(sdir / "recording.json", {}) or {}
            for src in [rec.get("path")] + [t.get("file") for t in rec.get("tracks") or []]:
                if not src:
                    continue
                p = Path(src)
                if p.is_file() and p.suffix.lower() in MEDIA and not p.resolve().is_relative_to(root):
                    recordings.append((p, Path("recordings") / sdir.name / p.name, sdir.name, str(p)))
    total = sum(p.stat().st_size for p, _ in files) + sum(p.stat().st_size for p, *_ in recordings) or 1
    done = 0
    counts = {"pages": 0, "sessions": len([d for d in (root / "sessions").glob("*") if d.is_dir()]),
              "monsters": len(list((root / "monsters").glob("*.json"))), "files": 0, "recordings": len(recordings)}
    tmp = dest.with_suffix(".zip.part")
    log(f"Packing {camp.name} into {dest.name}…")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p, rel in files:
            arc = Path("campaign") / rel
            if rel == Path("campaign.json"):
                z.writestr(str(arc).replace(os.sep, "/"), json.dumps(_scrub_campaign_info(read_json(p, {}) or {}, include_secrets), indent=2, ensure_ascii=False))
            else:
                ctype = zipfile.ZIP_STORED if p.suffix.lower() in MEDIA | {".png", ".jpg", ".jpeg", ".webp", ".gif", ".zip"} else zipfile.ZIP_DEFLATED
                z.write(p, str(arc).replace(os.sep, "/"), compress_type=ctype)
            if rel.parts[0] == "lore" and p.suffix == ".md":
                counts["pages"] += 1
            counts["files"] += 1
            done += p.stat().st_size
            if progress:
                progress(done / total)
        for p, arc, sid, original in recordings:
            log(f"Adding the recording for {sid} ({p.stat().st_size / 1e9:.1f} GB)…" if p.stat().st_size > 5e8 else f"Adding {p.name}…")
            z.write(p, str(arc).replace(os.sep, "/"), compress_type=zipfile.ZIP_STORED)
            done += p.stat().st_size
            if progress:
                progress(done / total)
        if include_settings:
            z.writestr("app/settings.json", json.dumps(_scrub_settings(settings.load(), include_secrets), indent=2, ensure_ascii=False))
            for t in sorted(paths.themes_dir().glob("*.json")):
                z.write(t, f"app/themes/{t.name}")
        manifest = {"lore_studio": __version__, "exported": time.strftime("%Y-%m-%d %H:%M"), "campaign": camp.name,
                    "folder_name": root.name, "includes": {"recordings": bool(include_media), "settings": bool(include_settings),
                                                            "secrets": bool(include_secrets)},
                    "counts": counts, "recordings": [{"session": sid, "file": str(arc).replace(os.sep, "/"), "was": orig}
                                                     for _, arc, sid, orig in recordings]}
        z.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
        z.writestr("README.txt", _readme(manifest))
    os.replace(tmp, dest)
    log(f"Done: {counts['pages']} pages, {counts['sessions']} sessions, {counts['files']} files"
        + (f", {len(recordings)} recordings" if recordings else "") + f" ({dest.stat().st_size / 1e6:.1f} MB).")
    return str(dest)


def _readme(m):
    inc = m["includes"]
    return f"""Lore Studio backup of "{m['campaign']}", made {m['exported']} with Lore Studio {m['lore_studio']}.

campaign/     The whole campaign folder: lore pages (Markdown), sessions (plans, transcripts, recaps, live notes,
              Foundry logs), maps, monsters, encounters, boards, handouts, calendar, timeline, clocks, threads,
              chats and the party. It opens in Lore Studio as it is.
app/          {'Lore Studio settings and saved themes.' if inc['settings'] else '(not included)'}
              {'API keys, passwords, tokens and Discord webhooks ARE included. Keep this file private.' if inc['secrets'] else 'API keys, passwords, tokens and Discord webhooks were removed; enter them again after restoring.'}
recordings/   {'Session recordings that were stored outside the campaign folder.' if inc['recordings'] else '(not included: recordings stay where OBS saved them)'}

To restore: in Lore Studio, choose "Restore a backup" (on the welcome screen or in Settings > Campaign) and pick this
.zip. Or unzip it and open the campaign/ folder with "Open a campaign".
The player lore book website isn't included: rebuild it from Settings > Player lore book.
"""


def inspect(zip_path):
    """What a backup holds, before restoring it."""
    with zipfile.ZipFile(Path(zip_path).expanduser()) as z:
        try:
            m = json.loads(z.read("manifest.json"))
        except KeyError:
            raise ValueError("That .zip isn't a Lore Studio backup (it has no manifest.json).")
        m["size_mb"] = round(sum(i.file_size for i in z.infolist()) / 1e6, 1)
        return m


def restore(zip_path, parent, restore_settings=False, log=print, progress=None):
    """Unpack a backup into a new folder inside parent. Returns the campaign folder. Never overwrites anything."""
    zip_path = Path(zip_path).expanduser()
    m = inspect(zip_path)
    parent = Path(parent).expanduser()
    parent.mkdir(parents=True, exist_ok=True)
    name = _safe(m.get("folder_name") or m["campaign"])
    target, n = parent / name, 2
    while target.exists():
        target, n = parent / f"{name} (restored {n})", n + 1
    log(f"Restoring {m['campaign']} into {target}…")
    with zipfile.ZipFile(zip_path) as z:
        members = z.infolist()
        total = sum(i.file_size for i in members) or 1
        done = 0
        rec_dir = target.parent / f"{target.name} recordings"
        moved = {}
        for i in members:
            parts = Path(i.filename).parts
            if not parts or i.is_dir() or ".." in parts or Path(i.filename).is_absolute():
                continue
            if parts[0] == "campaign":
                out = target.joinpath(*parts[1:])
            elif parts[0] == "recordings":
                out = rec_dir.joinpath(*parts[1:])
                moved["/".join(parts)] = str(out)
            else:
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            with z.open(i) as src, open(out, "wb") as dst:
                while chunk := src.read(1 << 20):
                    dst.write(chunk)
            done += i.file_size
            if progress:
                progress(done / total)
        # recordings that came along: point their sessions at the restored copies
        for r in m.get("recordings") or []:
            new = moved.get(r["file"])
            rj = target / "sessions" / r["session"] / "recording.json"
            if new and rj.exists():
                rec = read_json(rj, {}) or {}
                if rec.get("path") == r["was"]:
                    rec["path"] = new
                for t in rec.get("tracks") or []:
                    if t.get("file") == r["was"]:
                        t["file"] = new
                write_json(rj, rec)
        if restore_settings and "app/settings.json" in z.namelist():
            incoming = json.loads(z.read("app/settings.json"))
            current = settings.load()
            # keys and passwords you already have here stay, unless the backup actually carries them
            merged = {**current, **{k: v for k, v in incoming.items() if not (k in settings.SECRET_KEYS and not v)}}
            merged.pop("foundry_token", None)
            settings.save({k: v for k, v in merged.items() if k != "foundry_token"})
            for name_ in z.namelist():
                if name_.startswith("app/themes/") and name_.endswith(".json"):
                    (paths.themes_dir() / Path(name_).name).write_bytes(z.read(name_))
            log("Settings restored.")
    log("Restored.")
    return str(target)
