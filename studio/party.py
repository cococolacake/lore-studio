"""The Party page: a profile for each player character.

Profiles live in the campaign's party list (campaign.json → party), the same list recaps and the transcriber use,
so a character's name, player and transcript label stay in one place. Each profile adds: about the player, a
backstory synopsis, the GM's private plans for it, and a linked Foundry sheet whose numbers are read from Foundry.
Portraits are kept in <campaign>/party/: one you chose, and a copy of the Foundry portrait so it shows without Foundry.
"""
import hashlib
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import PurePosixPath

from . import boards, foundry

TEXT_FIELDS = ("character", "player", "speaker", "pronouns", "about", "backstory", "plans", "hooks", "level", "foundry_id")


def _ensure_ids(party):
    changed = False
    for p in party:
        if not p.get("id"):
            p["id"] = uuid.uuid4().hex[:8]
            changed = True
    return changed


def get_all(camp):
    party = [dict(p) for p in camp.info.get("party") or [] if isinstance(p, dict)]
    if _ensure_ids(party):
        camp.save_info({"party": party})
    return party


def _save_all(camp, party):
    camp.save_info({"party": party})
    return party


def save(camp, entry):
    party = get_all(camp)
    entry = {k: v for k, v in (entry or {}).items() if k in TEXT_FIELDS or k in ("id", "sheet", "hp_backup")}
    for k in TEXT_FIELDS:
        if k in entry:
            entry[k] = str(entry[k] or "").strip()[:8000 if k in ("about", "backstory", "plans", "hooks") else 200]
    if not (entry.get("character") or entry.get("player")):
        raise ValueError("Give the character (or the player) a name first.")
    old = next((p for p in party if p["id"] == entry.get("id")), None)
    stale = None
    if old:
        if entry.get("foundry_id", old.get("foundry_id")) != old.get("foundry_id"):
            old.pop("sheet", None)
            stale = old.pop("foundry_portrait", None)
        old.update(entry)
        result = old
    else:
        entry["id"] = uuid.uuid4().hex[:8]
        party.append(entry)
        result = entry
    _save_all(camp, party)
    _remove_unused(camp, party, stale)
    return result


def delete(camp, pid):
    party = get_all(camp)
    gone = [p for p in party if p["id"] == pid]
    party = _save_all(camp, [p for p in party if p["id"] != pid])
    for p in gone:
        _remove_unused(camp, party, p.get("portrait"), p.get("foundry_portrait"))


def _store_file(camp, data, ext):
    d = camp.root / "party"
    d.mkdir(exist_ok=True)
    # named by content, so a replaced portrait gets a new URL and the app doesn't show the old one from its cache
    name = hashlib.sha1(data).hexdigest()[:14] + ext
    (d / name).write_bytes(data)
    return f"party/{name}"


def _remove_unused(camp, party, *rels):
    """Delete old portrait files that no character uses anymore (files are shared when two pictures are identical)."""
    used = {p.get(k) for p in party for k in ("portrait", "foundry_portrait")}
    for rel in rels:
        # campaign.json can come from a backup or another computer, so only ever delete inside party/
        f = camp.file_for_url(rel) if rel and rel not in used and rel.startswith("party/") else None
        if f:
            f.unlink()


def _find(party, pid):
    p = next((x for x in party if x["id"] == pid), None)
    if not p:
        raise ValueError("That character isn't in the party anymore.")
    return p


def set_portrait(camp, pid, image):
    """Use a picture you chose as the character's portrait, in place of the Foundry one."""
    party = get_all(camp)
    p = _find(party, pid)
    old, p["portrait"] = p.get("portrait"), _store_file(camp, *boards.read_image(image))
    _save_all(camp, party)
    _remove_unused(camp, party, old)
    return p


def remove_portrait(camp, pid):
    party = get_all(camp)
    p = _find(party, pid)
    old = p.pop("portrait", None)
    _save_all(camp, party)
    _remove_unused(camp, party, old)
    return p


def _download_foundry_portrait(camp, img):
    """A campaign copy of the sheet's portrait, or None when Foundry's web server can't be reached."""
    origin = (foundry.status().get("origin") or "").rstrip("/")
    # only from the Foundry server itself: a player can put any address in their actor's image
    if not img or not origin or "://" in img:
        return None
    # Foundry stores paths already encoded (spaces as %20), sometimes with a ?cache-buster
    path, _, query = img.partition("?")
    path = urllib.parse.quote(urllib.parse.unquote(path.lstrip("/")))
    url = f"{origin}/{path}" + (f"?{query}" if query else "")
    ext = PurePosixPath(path).suffix.lower()
    if ext not in boards.IMAGE_TYPES:
        return None
    cap = 30 * 1024 * 1024
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            data = r.read(cap + 1)
    except (urllib.error.URLError, OSError, ValueError):
        return None
    if len(data) > cap:
        return None
    return _store_file(camp, data, ".jpg" if ext == ".jpeg" else ext)


def sync(camp, pid):
    """Read the linked Foundry character sheet into the profile (class, level, HP, AC, abilities...)."""
    party = get_all(camp)
    p = _find(party, pid)
    if not p.get("foundry_id"):
        raise ValueError("Link a Foundry character first.")
    sheet = foundry.request("character", {"id": p["foundry_id"]})
    sheet["read"] = time.time()
    p["sheet"] = sheet
    # if Foundry's web server can't be reached, keep the copy from the last time
    old = p.get("foundry_portrait")
    copy = _download_foundry_portrait(camp, sheet.get("img"))
    if copy:
        p["foundry_portrait"] = copy
    if sheet.get("level"):
        p["level"] = str(sheet["level"])
    _save_all(camp, party)
    if copy:
        _remove_unused(camp, party, old)
    return p


def levels(camp):
    """Each character's level, from their Foundry sheet or what you typed. Characters without one are skipped."""
    out = []
    for p in get_all(camp):
        lv = (p.get("sheet") or {}).get("level") or p.get("level")
        try:
            lv = int(lv)
        except (TypeError, ValueError):
            continue
        if 1 <= lv <= 20:
            out.append(lv)
    return out


def hp_breakdown(detail):
    """What max HP should be from the level-up choices, and what looks off (dnd5e rules: level 1 of your first class
    is the full die; after that, the average (half the die + 1), the max, or what you rolled; plus Constitution each level).
    "problems" are things to fix; "notes" are things that are fine if you meant them (a max set by hand, a bonus)."""
    if not detail:
        return None
    con = int(detail.get("con") or 0)
    rows, total, problems, notes = [], 0, [], []
    level = 0
    for c in detail.get("classes") or []:
        die = int(c.get("die") or 8)
        if c.get("has_record") is False:
            msg = f"{c['name']} has no hit points recorded for its levels (common with homebrew classes)"
            if detail.get("override") not in (None, "") and detail.get("max"):
                notes.append(msg + ". That's fine: max HP is set by hand.")
            else:
                problems.append(msg + ".")
        for lv in range(1, int(c.get("levels") or 0) + 1):
            level += 1
            v = (c.get("rolls") or {}).get(str(lv))
            if v == "max":
                n = die
            elif v == "avg":
                n = die // 2 + 1
            else:
                try:
                    n = int(v)
                except (TypeError, ValueError):
                    n = None
            if n is None and c.get("has_record") is not False:
                problems.append(f"{c['name']} level {lv} has no hit points chosen.")
            elif n is not None and (n > die or n < 1):
                problems.append(f"{c['name']} level {lv} gives {n}, but a d{die} can only give 1–{die}.")
            rows.append({"class_id": c["id"], "class": c["name"], "level": lv, "die": die, "value": v, "hp": n})
            total += n or 0
    bonus = 0
    for key, per_level in (("bonus_level", True), ("bonus_overall", False)):
        raw = str(detail.get(key) or "").strip()
        if raw:
            try:
                b = int(raw)
                bonus += b * (level if per_level else 1)
                notes.append(f"A hit point bonus of {raw}{' per level' if per_level else ''} is on the sheet.")
            except ValueError:
                notes.append(f"A hit point bonus formula is on the sheet: {raw}")
    expected = total + con * level + bonus
    if detail.get("override") not in (None, ""):
        notes.append(f"Max HP is set by hand to {detail['override']}, so level-ups don't change it.")
    if not detail.get("max"):
        problems.append("Foundry shows 0 max HP.")
    return {"rows": rows, "from_levels": total, "con": con, "level": level, "con_total": con * level, "bonus": bonus,
            "expected": expected, "without_bonus": total + con * level, "foundry_max": detail.get("max"), "current": detail.get("value"),
            "override": detail.get("override"), "problems": problems, "notes": notes,
            "complete": all(r["hp"] is not None for r in rows) and bool(rows)}


def fix_hp(camp, pid, changes):
    """Write hit point fixes to the linked Foundry sheet, keep a backup of what was there, then read it back."""
    party = get_all(camp)
    p = next((x for x in party if x["id"] == pid), None)
    if not p or not p.get("foundry_id"):
        raise ValueError("Link a Foundry character first.")
    allowed = {k: v for k, v in (changes or {}).items() if k in ("override", "bonus_overall", "bonus_level", "value", "class_hp", "fill")}
    if "override" in allowed and allowed["override"] not in (None, ""):
        try:
            if int(allowed["override"]) < 1:
                raise ValueError
        except (TypeError, ValueError):
            raise ValueError("Max HP has to be a number of 1 or more.")
    sheet = foundry.request("character_fix", {"id": p["foundry_id"], **allowed}, timeout=25)
    backup = sheet.pop("backup", None)
    if backup:
        p["hp_backup"] = {**backup, "saved": time.time()}
    sheet["read"] = time.time()
    p["sheet"] = sheet
    _save_all(camp, party)
    return p


def undo_hp(camp, pid):
    """Put back exactly what the last hit point fix changed."""
    party = get_all(camp)
    p = next((x for x in party if x["id"] == pid), None)
    if not p or not p.get("hp_backup"):
        raise ValueError("There's no hit point fix to undo.")
    b = p["hp_backup"]
    payload = {"override": b.get("override"), "bonus_overall": b.get("bonus_overall", ""), "bonus_level": b.get("bonus_level", ""),
               "class_hp": b.get("class_hp") or {}, "replace": True}
    if b.get("value") not in (None, ""):
        payload["value"] = b["value"]
    sheet = foundry.request("character_fix", {"id": p["foundry_id"], **payload}, timeout=25)
    sheet.pop("backup", None)
    sheet["read"] = time.time()
    p["sheet"] = sheet
    p.pop("hp_backup", None)
    _save_all(camp, party)
    return p
