"""The Party page: a profile for each player character.

Profiles live in the campaign's party list (campaign.json → party), the same list recaps and the transcriber use,
so a character's name, player and transcript label stay in one place. Each profile adds: about the player, a
backstory synopsis, the GM's private plans for it, and a linked Foundry sheet whose numbers are read from Foundry.
"""
import time
import uuid

from . import foundry

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
    if old:
        if entry.get("foundry_id", old.get("foundry_id")) != old.get("foundry_id"):
            old.pop("sheet", None)
        old.update(entry)
        result = old
    else:
        entry["id"] = uuid.uuid4().hex[:8]
        party.append(entry)
        result = entry
    _save_all(camp, party)
    return result


def delete(camp, pid):
    _save_all(camp, [p for p in get_all(camp) if p["id"] != pid])


def sync(camp, pid):
    """Read the linked Foundry character sheet into the profile (class, level, HP, AC, abilities...)."""
    party = get_all(camp)
    p = next((x for x in party if x["id"] == pid), None)
    if not p:
        raise ValueError("That character isn't in the party anymore.")
    if not p.get("foundry_id"):
        raise ValueError("Link a Foundry character first.")
    sheet = foundry.request("character", {"id": p["foundry_id"]})
    sheet["read"] = time.time()
    p["sheet"] = sheet
    if sheet.get("level"):
        p["level"] = str(sheet["level"])
    _save_all(camp, party)
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
