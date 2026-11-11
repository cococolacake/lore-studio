"""Monster maker: your own creatures, challenge rating estimates, and scaling to a CR or to your party.

Monsters are JSON files in <campaign>/monsters/. They can start from the free 5e rules (SRD 5.1), a creature in your
Foundry world, a 5etools homebrew file, or a blank sheet. The maths follows the 5e (2014) Dungeon Master's Guide:
"Monster Statistics by Challenge Rating", encounter XP thresholds and multipliers.

SRD 5.1 attribution (it ships in studio/data/srd-monsters.json): This work includes material taken from the System
Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC, available at
https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons
Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.
"""
import copy
import json
import math
import re
import time
from pathlib import Path

from .util import read_json, write_json


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")[:60]

SRD_FILE = Path(__file__).parent / "data" / "srd-monsters.json"
SRD_CREDIT = ("Includes material from the System Reference Document 5.1 (SRD 5.1) by Wizards of the Coast LLC, "
              "licensed under CC BY 4.0.")

ABILITIES = ["str", "dex", "con", "int", "wis", "cha"]
ABILITY_NAMES = {"str": "Strength", "dex": "Dexterity", "con": "Constitution", "int": "Intelligence", "wis": "Wisdom", "cha": "Charisma"}
SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"]
SECTIONS = ["traits", "actions", "bonus_actions", "reactions", "legendary"]
SECTION_NAMES = {"traits": "Traits", "actions": "Actions", "bonus_actions": "Bonus Actions", "reactions": "Reactions",
                 "legendary": "Legendary Actions"}
SPEEDS = ["walk", "burrow", "climb", "fly", "swim"]
SKILLS = {"acrobatics": "dex", "animal handling": "wis", "arcana": "int", "athletics": "str", "deception": "cha",
          "history": "int", "insight": "wis", "intimidation": "cha", "investigation": "int", "medicine": "wis",
          "nature": "int", "perception": "wis", "performance": "cha", "persuasion": "cha", "religion": "int",
          "sleight of hand": "dex", "stealth": "dex", "survival": "wis"}

# ---- the DMG tables -------------------------------------------------------------------------

CRS = [0, 0.125, 0.25, 0.5] + list(range(1, 31))
# cr: (proficiency, AC, hp min, hp max, attack bonus, damage/round min, max, save DC)
STATS = {
    0: (2, 13, 1, 6, 3, 0, 1, 13), 0.125: (2, 13, 7, 35, 3, 2, 3, 13), 0.25: (2, 13, 36, 49, 3, 4, 5, 13),
    0.5: (2, 13, 50, 70, 3, 6, 8, 13), 1: (2, 13, 71, 85, 3, 9, 14, 13), 2: (2, 13, 86, 100, 3, 15, 20, 13),
    3: (2, 13, 101, 115, 4, 21, 26, 13), 4: (2, 14, 116, 130, 5, 27, 32, 14), 5: (3, 15, 131, 145, 6, 33, 38, 15),
    6: (3, 15, 146, 160, 6, 39, 44, 15), 7: (3, 15, 161, 175, 6, 45, 50, 15), 8: (3, 16, 176, 190, 7, 51, 56, 16),
    9: (4, 16, 191, 205, 7, 57, 62, 16), 10: (4, 17, 206, 220, 7, 63, 68, 16), 11: (4, 17, 221, 235, 8, 69, 74, 17),
    12: (4, 17, 236, 250, 8, 75, 80, 17), 13: (5, 18, 251, 265, 8, 81, 86, 18), 14: (5, 18, 266, 280, 8, 87, 92, 18),
    15: (5, 18, 281, 295, 8, 93, 98, 18), 16: (5, 18, 296, 310, 9, 99, 104, 18), 17: (6, 19, 311, 325, 10, 105, 110, 19),
    18: (6, 19, 326, 340, 10, 111, 116, 19), 19: (6, 19, 341, 355, 10, 117, 122, 19), 20: (6, 19, 356, 400, 10, 123, 140, 19),
    21: (7, 19, 401, 445, 11, 141, 158, 20), 22: (7, 19, 446, 490, 11, 159, 176, 20), 23: (7, 19, 491, 535, 11, 177, 194, 20),
    24: (7, 19, 536, 580, 12, 195, 212, 21), 25: (8, 19, 581, 625, 12, 213, 230, 21), 26: (8, 19, 626, 670, 12, 231, 248, 21),
    27: (8, 19, 671, 715, 13, 249, 266, 22), 28: (8, 19, 716, 760, 13, 267, 284, 22), 29: (9, 19, 761, 805, 13, 285, 302, 22),
    30: (9, 19, 806, 850, 14, 303, 320, 23),
}
XP = {0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900,
      9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000,
      19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000,
      28: 120000, 29: 135000, 30: 155000}
# character level: easy, medium, hard, deadly
THRESHOLDS = {1: (25, 50, 75, 100), 2: (50, 100, 150, 200), 3: (75, 150, 225, 400), 4: (125, 250, 375, 500),
              5: (250, 500, 750, 1100), 6: (300, 600, 900, 1400), 7: (350, 750, 1100, 1700), 8: (450, 900, 1400, 2100),
              9: (550, 1100, 1600, 2400), 10: (600, 1200, 1900, 2800), 11: (800, 1600, 2400, 3600),
              12: (1000, 2000, 3000, 4500), 13: (1100, 2200, 3400, 5100), 14: (1250, 2500, 3800, 5700),
              15: (1400, 2800, 4300, 6400), 16: (1600, 3200, 4800, 7200), 17: (2000, 3900, 5900, 8800),
              18: (2100, 4200, 6300, 9500), 19: (2400, 4900, 7300, 10900), 20: (2800, 5700, 8500, 12700)}
DIFFICULTIES = ["easy", "medium", "hard", "deadly"]
MULTIPLIERS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5]


def cr_label(cr):
    return {0.125: "1/8", 0.25: "1/4", 0.5: "1/2"}.get(cr, str(int(cr)) if cr == int(cr) else str(cr))


def parse_cr(v):
    if isinstance(v, dict):
        v = v.get("cr")
    s = str(v if v is not None else "").strip()
    if not s:
        return None
    if "/" in s:
        a, _, b = s.partition("/")
        try:
            return nearest_cr(int(a) / int(b))
        except (ValueError, ZeroDivisionError):
            return None
    try:
        return nearest_cr(float(s))
    except ValueError:
        return None


def nearest_cr(x):
    return min(CRS, key=lambda c: (abs(c - x), c))


def prof_bonus(cr):
    return STATS[nearest_cr(cr or 0)][0]


def mod(score):
    return (int(score or 10) - 10) // 2


def signed(n):
    return f"+{n}" if n >= 0 else f"−{abs(n)}"


def avg_dice(n, die, bonus=0):
    return math.floor(n * (die + 1) / 2 + bonus)


# ---- a monster ---------------------------------------------------------------------------------

def blank(name="New monster"):
    return {"name": name, "size": "Medium", "type": "humanoid", "subtype": "", "alignment": "unaligned",
            "ac": 12, "ac_note": "", "hp": 11, "hit_dice": "2d8+2",
            "speed": {"walk": 30}, "hover": False,
            "abilities": {a: 10 for a in ABILITIES}, "saves": {}, "skills": {},
            "vulnerabilities": "", "resistances": "", "immunities": "", "condition_immunities": "",
            "senses": "", "languages": "", "cr": 0.5,
            "traits": [], "actions": [{"name": "Club", "desc": "Melee Weapon Attack: +2 to hit, reach 5 ft., one target. Hit: 2 (1d4) bludgeoning damage."}],
            "bonus_actions": [], "reactions": [], "legendary": [], "legendary_count": 3,
            "notes": "", "source": "custom"}


def clean(m):
    """Tidy a monster from the UI or an import: known fields only, sensible types."""
    out = blank(str(m.get("name") or "Unnamed").strip()[:120] or "Unnamed")
    for k in ("size", "type", "subtype", "alignment", "ac_note", "hit_dice", "vulnerabilities", "resistances",
              "immunities", "condition_immunities", "senses", "languages", "notes", "source", "image", "foundry_id"):
        if m.get(k) is not None:
            out[k] = str(m[k])[:4000 if k == "notes" else 400]
    for k in ("ac", "hp", "legendary_count"):
        try:
            out[k] = max(0, int(m.get(k, out[k])))
        except (TypeError, ValueError):
            pass
    out["cr"] = parse_cr(m.get("cr")) if parse_cr(m.get("cr")) is not None else out["cr"]
    sp = m.get("speed") or {}
    out["speed"] = {k: int(v) for k, v in sp.items() if k in SPEEDS and str(v).strip().lstrip("-").isdigit() and int(v) > 0}
    out["hover"] = bool(m.get("hover"))
    ab = m.get("abilities") or {}
    out["abilities"] = {a: max(1, min(30, int(ab.get(a, 10) or 10))) for a in ABILITIES}
    out["saves"] = {a: int(v) for a, v in (m.get("saves") or {}).items() if a in ABILITIES and _isint(v)}
    out["skills"] = {str(k).lower(): int(v) for k, v in (m.get("skills") or {}).items() if _isint(v)}
    for sec in SECTIONS:
        out[sec] = [{"name": str(x.get("name") or "").strip()[:120], "desc": str(x.get("desc") or "").strip()[:4000]}
                    for x in m.get(sec) or [] if isinstance(x, dict) and (x.get("name") or x.get("desc"))]
    for k in ("id", "created", "updated"):
        if m.get(k):
            out[k] = m[k]
    return out


def _isint(v):
    try:
        int(v)
        return True
    except (TypeError, ValueError):
        return False


def derived(m):
    """Numbers the stat block shows but you don't type: modifiers, proficiency, XP, passive Perception."""
    cr = parse_cr(m.get("cr")) or 0
    pb = prof_bonus(cr)
    mods = {a: mod(m["abilities"].get(a)) for a in ABILITIES}
    perc = m.get("skills", {}).get("perception")
    return {"mods": mods, "prof": pb, "xp": XP.get(cr, 0), "cr_label": cr_label(cr),
            "passive": 10 + (int(perc) if perc is not None else mods["wis"])}


# ---- reading the numbers out of action text -----------------------------------------------------

_DMG = re.compile(r"(\d+)\s*\(\s*(\d+)d(\d+)\s*(?:([+\-−])\s*(\d+))?\s*\)")
_HIT = re.compile(r"([+\-−])(\d+)\s+to hit")
_DC = re.compile(r"\bDC\s*(\d+)")
_WORDNUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "once": 1, "twice": 2}


def _damage_of(text):
    return sum(int(x.group(1)) for x in _DMG.finditer(text or ""))


def offense(m):
    """Damage per round, best attack bonus and best save DC, worked out from the action text (the DMG's way:
    a recharge attack like a breath weapon is averaged over three rounds, and a legendary action adds its damage)."""
    acts = m.get("actions") or []
    per = {a["name"].lower(): _damage_of(a["desc"]) for a in acts if a.get("name", "").lower() != "multiattack"}
    recharge = [v for a in acts for k, v in per.items() if a.get("name", "").lower() == k and "recharge" in (a["name"] + a["desc"]).lower()]
    plain = {k: v for k, v in per.items() if v not in recharge or not recharge}
    best = max(plain.values(), default=0)
    dpr = best
    multi = next((a for a in acts if a.get("name", "").lower() == "multiattack"), None)
    if multi:
        d = multi["desc"].lower()
        parts = re.findall(r"\b(one|two|three|four|five|six)\s+(?:with\s+its\s+|of\s+its\s+)?([a-z]+)", d)
        total, used = 0, False
        for word, what in parts:
            hit = next((v for k, v in per.items() if what.rstrip("s") and what.rstrip("s") in k), None)
            if hit is not None:
                total += _WORDNUM[word] * hit
                used = True
        if used:
            dpr = max(dpr, total)
        else:
            n = re.search(r"\b(two|three|four|five|six)\b[^.]*\battacks?\b", d)
            if n:
                dpr = max(dpr, _WORDNUM[n.group(1)] * best)
    if recharge:
        dpr = max(dpr, (max(recharge) + 2 * dpr) / 3)
    leg = 0
    for a in m.get("legendary") or []:
        own = _damage_of(a["desc"])
        ref = max((v for k, v in per.items() if k and re.search(rf"\b{re.escape(k.split(' (')[0])}\b", (a["name"] + " " + a["desc"]).lower())), default=0)
        leg = max(leg, own, ref)
    dpr = round(dpr + leg)
    text = " ".join(a.get("desc", "") for sec in SECTIONS for a in m.get(sec) or [])
    hits = [int(x.group(2)) * (-1 if x.group(1) in "-−" else 1) for x in _HIT.finditer(text)]
    dcs = [int(x) for x in _DC.findall(text)]
    return {"dpr": dpr, "attack": max(hits) if hits else None, "dc": max(dcs) if dcs else None, "legendary_damage": leg}


def _row_for(value, lo_i, hi_i):
    for cr in CRS:
        s = STATS[cr]
        if value <= s[hi_i]:
            return cr
    return 30


def _shift(cr, steps):
    i = CRS.index(cr)
    return CRS[max(0, min(len(CRS) - 1, i + int(steps)))]


def estimate(m):
    """The DMG's way of checking a challenge rating: a defensive CR (hit points, armour class) and an offensive CR
    (damage per round, attack bonus or save DC), averaged."""
    hp = int(m.get("hp") or 0)
    res = (m.get("resistances") or "").lower() + " " + (m.get("immunities") or "").lower()
    physical = any(w in res for w in ("bludgeoning", "piercing", "slashing"))
    eff_hp = hp
    if physical:
        immune = any(w in (m.get("immunities") or "").lower() for w in ("bludgeoning", "piercing", "slashing"))
        guess = _row_for(hp, 2, 3)
        if guess <= 4:
            eff_hp = hp * 2
        elif guess <= 10:
            eff_hp = hp * (2 if immune else 1.5)
        elif guess <= 16:
            eff_hp = hp * (1.5 if immune else 1.25)
        else:
            eff_hp = hp * (1.25 if immune else 1)
    traits = " ".join(t.get("name", "") for t in m.get("traits") or []).lower()
    lr = next((t for t in m.get("traits") or [] if "legendary resistance" in t.get("name", "").lower()), None)
    if lr:
        uses = re.search(r"(\d+)\s*/\s*day", (lr["name"] + " " + lr.get("desc", "")).lower())
        guess = _row_for(eff_hp, 2, 3)
        eff_hp += (int(uses.group(1)) if uses else 3) * (10 if guess <= 4 else 20 if guess <= 10 else 30)
    eff_ac = int(m.get("ac") or 10) + (2 if "magic resistance" in traits else 0)
    d_cr = _row_for(eff_hp, 2, 3)
    d_cr = _shift(d_cr, int((eff_ac - STATS[d_cr][1]) / 2))
    off = offense(m)
    o_cr = _row_for(off["dpr"], 5, 6)
    if off["attack"] is not None:
        o_cr = _shift(o_cr, int((off["attack"] - STATS[o_cr][4]) / 2))
    elif off["dc"] is not None:
        o_cr = _shift(o_cr, int((off["dc"] - STATS[o_cr][7]) / 2))
    i = round((CRS.index(d_cr) + CRS.index(o_cr)) / 2)
    return {"cr": CRS[i], "defensive": d_cr, "offensive": o_cr, "effective_hp": round(eff_hp), **off}


# ---- scaling ---------------------------------------------------------------------------------

def _rewrite_hits(text, delta):
    def f(x):
        n = int(x.group(2)) * (-1 if x.group(1) in "-−" else 1) + delta
        return f"{'+' if n >= 0 else '−'}{abs(n)} to hit"
    return _HIT.sub(f, text)


def _rewrite_dcs(text, delta):
    return _DC.sub(lambda x: f"DC {int(x.group(1)) + delta}", text)


def _rewrite_damage(text, factor):
    def f(x):
        avg, n, die = int(x.group(1)), int(x.group(2)), int(x.group(3))
        bonus = int(x.group(5) or 0) * (-1 if x.group(4) in ("-", "−") else 1)
        want = avg * factor
        n2 = max(1, round((want - bonus) / ((die + 1) / 2)))
        sign = f" {'+' if bonus >= 0 else '−'} {abs(bonus)}" if x.group(5) else ""
        return f"{avg_dice(n2, die, bonus)} ({n2}d{die}{sign})"
    return _DMG.sub(f, text)


def scale(m, target_cr):
    """A copy of the monster rebuilt for another challenge rating: hit points, armour class, attack bonuses, save DCs,
    damage, proficiency (saves and skills) move by the DMG table. Extras the table doesn't cover (legendary actions,
    legendary resistance...) are allowed for by checking the result against the estimate and adjusting.
    Returns (monster, [what changed])."""
    target = nearest_cr(float(target_cr))
    src = clean(copy.deepcopy(m))
    cur = parse_cr(src.get("cr"))
    cur = cur if cur is not None else estimate(src)["cr"]
    # Everything moves in proportion to how the DMG table changes between the two CRs, so the monster keeps its
    # character (a hard-hitting, fragile owlbear stays hard-hitting and fragile). Then a light check against the
    # estimate nudges it if the result landed a step away from where it should be.
    want = CRS.index(estimate(src)["cr"]) + CRS.index(target) - CRS.index(cur)
    aim = target
    best = None
    for _ in range(3):
        out, changes = _scale_to(src, cur, aim, target, relative=True)
        miss = CRS.index(estimate(out)["cr"]) - max(0, min(len(CRS) - 1, want))
        if best is None or abs(miss) < best[0]:
            best = (abs(miss), out, changes)
        if miss == 0 or abs(CRS.index(aim) - CRS.index(target)) >= 2:
            break
        aim = _shift(aim, -1 if miss > 0 else 1)
    out, changes = best[1], best[2]
    out["cr"] = target
    changes[0] = f"Challenge {cr_label(cur)} → {cr_label(target)}"
    return out, changes


def _scale_to(m, cur, target, final, relative=False):
    """Hit points, armour class, damage, attack bonuses and DCs follow `target`; proficiency follows `final`.
    relative: grow or shrink hit points in proportion instead of using the table's (for spellcasters and other
    monsters whose toughness isn't in their hit points)."""
    m = clean(copy.deepcopy(m))
    T, C = STATS[target], STATS[cur]
    changes = []
    # hit points: middle of the target range, same hit die
    hd = re.match(r"\s*(\d+)\s*d\s*(\d+)", m.get("hit_dice") or "")
    die = int(hd.group(2)) if hd else {"Tiny": 4, "Small": 6, "Medium": 8, "Large": 10, "Huge": 12, "Gargantuan": 20}.get(m["size"], 8)
    con = mod(m["abilities"]["con"])
    table_hp = (T[2] + T[3]) / 2
    # halfway (geometrically) between "in proportion" and "what the table expects": keeps some character
    want = math.sqrt(max(1, m["hp"] * table_hp / ((C[2] + C[3]) / 2)) * table_hp) if relative else table_hp
    n = max(1, round(want / ((die + 1) / 2 + con)))
    hp = max(1, avg_dice(n, die, n * con))
    changes.append(f"Hit points {m['hp']} → {hp}")
    m["hp"], m["hit_dice"] = hp, f"{n}d{die}" + (f" {'+' if con >= 0 else '−'} {abs(n * con)}" if con else "")
    ac = max(5, int(m["ac"]) + (T[1] - C[1]))
    if ac != m["ac"]:
        changes.append(f"Armour class {m['ac']} → {ac}")
        m["ac"] = ac
    dp = STATS[final][0] - C[0]
    if dp:
        m["saves"] = {a: v + dp for a, v in m["saves"].items()}
        m["skills"] = {k: v + dp for k, v in m["skills"].items()}
        if m["saves"] or m["skills"]:
            changes.append(f"Saving throws and skills {signed(dp)} (proficiency {C[0]} → {STATS[final][0]})")
    da, dd = T[4] - C[4], T[7] - C[7]
    old_dpr = offense(m)["dpr"]
    rel = ((T[5] + T[6]) / 2) / max(1, (C[5] + C[6]) / 2)
    factor = math.sqrt(rel * ((T[5] + T[6]) / 2) / old_dpr) if relative and old_dpr else rel
    for sec in SECTIONS:
        for a in m[sec]:
            a["desc"] = _rewrite_damage(_rewrite_dcs(_rewrite_hits(a["desc"], da), dd), factor)
    text = " ".join(a["desc"] for sec in SECTIONS for a in m[sec])
    if da and _HIT.search(text):
        changes.append(f"Attack bonuses {signed(da)}")
    if dd and _DC.search(text):
        changes.append(f"Save DCs {signed(dd)}")
    new_dpr = offense(m)["dpr"]
    if new_dpr != old_dpr:
        changes.append(f"Damage per round about {round(old_dpr)} → {new_dpr}")
    changes.insert(0, f"Challenge {cr_label(cur)} → {cr_label(target)}")
    m["cr"] = target
    return m, changes


def party_target(levels, difficulty="hard", count=1):
    """The CR to give each of `count` identical monsters so the fight is `difficulty` for a party of these levels."""
    levels = [max(1, min(20, int(x))) for x in levels if _isint(x)] or [1]
    d = DIFFICULTIES.index(difficulty) if difficulty in DIFFICULTIES else 2
    budget = sum(THRESHOLDS[lv][d] for lv in levels)
    count = max(1, int(count))
    i = 1 if count == 1 else 2 if count == 2 else 3 if count <= 6 else 4 if count <= 10 else 5 if count <= 14 else 6
    if len(levels) < 3:
        i += 1
    elif len(levels) >= 6:
        i -= 1
    mult = MULTIPLIERS[max(0, min(len(MULTIPLIERS) - 1, i))]
    each = budget / (count * mult)
    fits = [c for c in CRS if XP[c] <= each]
    cr = fits[-1] if fits else 0
    return {"cr": cr, "budget": budget, "multiplier": mult, "xp_each": XP[cr], "adjusted_xp": round(XP[cr] * count * mult),
            "party": levels, "difficulty": DIFFICULTIES[d], "count": count,
            "thresholds": {DIFFICULTIES[k]: sum(THRESHOLDS[lv][k] for lv in levels) for k in range(4)}}


# ---- text ---------------------------------------------------------------------------------------

def speed_text(m):
    sp = m.get("speed") or {}
    parts = [f"{sp['walk']} ft."] if sp.get("walk") else []
    parts += [f"{k} {sp[k]} ft." + (" (hover)" if k == "fly" and m.get("hover") else "") for k in SPEEDS[1:] if sp.get(k)]
    return ", ".join(parts) or "0 ft."


def summary(m):
    d = derived(m)
    kind = f"{m['size']} {m['type']}" + (f" ({m['subtype']})" if m.get("subtype") else "") + (f", {m['alignment']}" if m.get("alignment") else "")
    return f"{kind} · AC {m['ac']} · HP {m['hp']} · CR {d['cr_label']}"


def stat_text(m):
    """The monster as a session-plan stat block (:::stat), the way Lore Studio's plans write them."""
    d = derived(m)
    L = [f":::stat {m['name']} | {summary(m)}"]
    ac = f"**Armor Class** {m['ac']}" + (f" ({m['ac_note']})" if m.get("ac_note") else "")
    hp = f"**Hit Points** {m['hp']}" + (f" ({m['hit_dice']})" if m.get("hit_dice") else "")
    L.append(f"{ac} · {hp} · **Speed** {speed_text(m)}")
    L.append(" · ".join(f"**{a.upper()}** {m['abilities'][a]} ({signed(d['mods'][a])})" for a in ABILITIES))
    extra = []
    if m["saves"]:
        extra.append("**Saving Throws** " + ", ".join(f"{a.capitalize()} {signed(v)}" for a, v in m["saves"].items()))
    if m["skills"]:
        extra.append("**Skills** " + ", ".join(f"{k.title()} {signed(v)}" for k, v in m["skills"].items()))
    for k, label in (("vulnerabilities", "Damage Vulnerabilities"), ("resistances", "Damage Resistances"),
                     ("immunities", "Damage Immunities"), ("condition_immunities", "Condition Immunities")):
        if m.get(k):
            extra.append(f"**{label}** {m[k]}")
    extra.append(f"**Senses** " + ", ".join(x for x in [m.get("senses"), f"passive Perception {d['passive']}"] if x))
    extra.append(f"**Languages** {m.get('languages') or '—'} · **Challenge** {d['cr_label']} ({d['xp']:,} XP)")
    L.append(" · ".join(extra))
    for sec in SECTIONS:
        if not m[sec]:
            continue
        if sec != "traits":
            L.append(f"**{SECTION_NAMES[sec].upper()}**")
        if sec == "legendary":
            L.append(f"The {m['name'].lower()} can take {m.get('legendary_count') or 3} legendary actions, choosing from the options below. "
                     "Only one legendary action can be used at a time and only at the end of another creature's turn.")
        for a in m[sec]:
            L.append(f"***{a['name']}.*** {a['desc']}" if a["name"] else a["desc"])
    return "\n\n".join(L) + "\n:::"


# ---- storage ----------------------------------------------------------------------------------

def _dir(camp):
    d = camp.root / "monsters"
    d.mkdir(exist_ok=True)
    return d


def list_monsters(camp):
    out = []
    for f in sorted(_dir(camp).glob("*.json")):
        m = read_json(f, None)
        if isinstance(m, dict) and m.get("name"):
            m["id"] = f.stem
            out.append({"id": f.stem, "name": m["name"], "cr": parse_cr(m.get("cr")), "cr_label": cr_label(parse_cr(m.get("cr")) or 0),
                        "type": m.get("type", ""), "size": m.get("size", ""), "source": m.get("source", ""),
                        "updated": m.get("updated", 0), "foundry_id": m.get("foundry_id", "")})
    return sorted(out, key=lambda x: x["name"].lower())


def get(camp, mid):
    m = read_json(_dir(camp) / f"{mid}.json", None)
    if not m:
        raise ValueError("That monster doesn't exist (anymore).")
    m = clean(m)
    m["id"] = mid
    return m


def save(camp, m):
    m = clean(m)
    mid = m.get("id") or _free_id(camp, m["name"])
    m["id"] = mid
    m.setdefault("created", time.time())
    m["updated"] = time.time()
    write_json(_dir(camp) / f"{mid}.json", m)
    return m


def _free_id(camp, name):
    base = slugify(name) or "monster"
    mid, n = base, 2
    while (_dir(camp) / f"{mid}.json").exists():
        mid, n = f"{base}-{n}", n + 1
    return mid


def delete(camp, mid):
    f = _dir(camp) / f"{mid}.json"
    if f.exists():
        f.unlink()


# ---- the SRD ------------------------------------------------------------------------------------

_srd = None


def srd():
    global _srd
    if _srd is None:
        _srd = json.loads(SRD_FILE.read_text(encoding="utf-8")) if SRD_FILE.exists() else {"monsters": []}
    return _srd["monsters"]


def srd_list():
    return [{"index": m["index"], "name": m["name"], "cr": m["cr"], "cr_label": cr_label(m["cr"]), "type": m["type"],
             "size": m["size"]} for m in srd()]


def srd_get(index):
    m = next((x for x in srd() if x["index"] == index), None)
    if not m:
        raise ValueError("That isn't an SRD monster.")
    out = clean({k: v for k, v in m.items() if k != "index"})
    out["source"] = "SRD 5.1"
    return out


# ---- 5etools homebrew -------------------------------------------------------------------------------

_SIZE5 = {"T": "Tiny", "S": "Small", "M": "Medium", "L": "Large", "H": "Huge", "G": "Gargantuan"}
_ALIGN5 = {"L": "lawful", "N": "neutral", "C": "chaotic", "G": "good", "E": "evil", "U": "unaligned", "A": "any alignment"}


def _tags(text):
    """5etools {@tags} to plain words."""
    def f(x):
        tag, body = x.group(1), x.group(2) or ""
        first = body.split("|")[0]
        if tag in ("atk",):
            kinds = {"mw": "Melee Weapon Attack:", "rw": "Ranged Weapon Attack:", "mw,rw": "Melee or Ranged Weapon Attack:",
                     "ms": "Melee Spell Attack:", "rs": "Ranged Spell Attack:", "ms,rs": "Melee or Ranged Spell Attack:"}
            return kinds.get(first, "Attack:")
        if tag == "h":
            return "Hit: "
        if tag == "hit":                     # 5etools writes "{@hit 5} to hit" and "a {@dc 13} Constitution saving throw"
            return first if first.startswith("-") else f"+{first}"
        if tag == "dc":
            return f"DC {first}"
        if tag == "recharge":
            return f"(Recharge {first}–6)" if first else "(Recharge 6)"
        return first
    for _ in range(3):
        text = re.sub(r"\{@(\w+)\s*([^{}]*)\}", f, text)
    return text


def _entries(v):
    if isinstance(v, str):
        return _tags(v)
    if isinstance(v, list):
        return " ".join(_entries(x) for x in v)
    if isinstance(v, dict):
        if v.get("type") == "list":
            return " ".join(_entries(x) for x in v.get("items") or [])
        return " ".join(x for x in [_tags(v.get("name", "")) + ("." if v.get("name") else ""), _entries(v.get("entries") or v.get("entry") or "")] if x)
    return ""


def _named(lst):
    return [{"name": _tags(x.get("name", "")), "desc": _entries(x.get("entries") or [])} for x in lst or [] if isinstance(x, dict)]


def _spellcasting(blocks):
    """5etools' spellcasting blocks as traits: the header, then spells by level and by uses."""
    out = []
    for sc in blocks or []:
        if not isinstance(sc, dict):
            continue
        parts = [_entries(sc.get("headerEntries") or [])]
        if sc.get("will"):
            parts.append("At will: " + ", ".join(_tags(x) for x in sc["will"]))
        for k, v in (sc.get("daily") or {}).items():
            parts.append(f"{k.rstrip('e')}/day{' each' if k.endswith('e') else ''}: " + ", ".join(_tags(x) for x in v))
        for lv, info in sorted((sc.get("spells") or {}).items(), key=lambda kv: int(kv[0]) if str(kv[0]).isdigit() else 0):
            label = "Cantrips (at will)" if str(lv) == "0" else f"Level {lv}" + (f" ({info['slots']} slots)" if info.get("slots") else "")
            parts.append(f"{label}: " + ", ".join(_tags(x) for x in info.get("spells") or []))
        parts.append(_entries(sc.get("footerEntries") or []))
        out.append({"name": _tags(sc.get("name") or "Spellcasting"), "desc": " ".join(parts[:1]) + (" " if parts[0] else "") + "; ".join(p for p in parts[1:] if p)})
    return out


def from_5etools(data):
    """Monsters from a 5etools homebrew JSON ({"monster": [...]}, or one monster). Your own creatures only."""
    items = data.get("monster") if isinstance(data, dict) and "monster" in data else data if isinstance(data, list) else [data]
    out = []
    for x in items or []:
        if not isinstance(x, dict) or not x.get("name"):
            continue
        typ = x.get("type")
        subtype = ""
        if isinstance(typ, dict):
            subtype = ", ".join(t if isinstance(t, str) else t.get("tag", "") for t in typ.get("tags") or [])
            typ = typ.get("type")
            typ = typ.get("choose", ["creature"])[0] if isinstance(typ, dict) else typ
        ac = x.get("ac") or [10]
        ac0 = ac[0]
        ac_val, ac_note = (ac0, "") if isinstance(ac0, int) else (ac0.get("ac", 10), ", ".join(_tags(f) for f in ac0.get("from") or []))
        hp = x.get("hp") or {}
        speed = {}
        hover = False
        for k, v in (x.get("speed") or {}).items():
            if k in SPEEDS:
                speed[k] = v if isinstance(v, int) else (v.get("number") or 0)
            if k == "canHover":
                hover = bool(v)
        al = x.get("alignment") or []
        alignment = " ".join(_ALIGN5.get(a, "") for a in al if isinstance(a, str)).strip() or "unaligned"
        size = x.get("size")
        size = size[0] if isinstance(size, list) and size else size
        def dmg(v):
            return ", ".join(d if isinstance(d, str) else ", ".join(
                [*(d.get(next((k for k in ("resist", "immune", "vulnerable", "conditionImmune") if k in d), ""), []) or []),
                 d.get("note", "")]).strip(", ") for d in v or [])
        m = {"name": x["name"], "size": _SIZE5.get(size, "Medium"), "type": typ or "creature", "subtype": subtype,
             "alignment": alignment, "ac": ac_val, "ac_note": ac_note,
             "hp": hp.get("average") or 1, "hit_dice": hp.get("formula", ""), "speed": speed, "hover": hover,
             "abilities": {a: x.get(a, 10) for a in ABILITIES},
             "saves": {k: int(str(v).replace("+", "")) for k, v in (x.get("save") or {}).items() if _isint(str(v).replace("+", ""))},
             "skills": {k: int(str(v).replace("+", "")) for k, v in (x.get("skill") or {}).items() if _isint(str(v).replace("+", ""))},
             "vulnerabilities": dmg(x.get("vulnerable")), "resistances": dmg(x.get("resist")),
             "immunities": dmg(x.get("immune")), "condition_immunities": dmg(x.get("conditionImmune")),
             "senses": ", ".join(_tags(s) for s in x.get("senses") or []), "languages": ", ".join(x.get("languages") or []),
             "cr": parse_cr(x.get("cr")) or 0,
             "traits": _named(x.get("trait")) + _spellcasting(x.get("spellcasting")), "actions": _named(x.get("action")), "bonus_actions": _named(x.get("bonus")),
             "reactions": _named(x.get("reaction")), "legendary": _named(x.get("legendary")),
             "legendary_count": x.get("legendaryActions") or 3, "source": "5etools homebrew"}
        out.append(clean(m))
    return out


# ---- Foundry (dnd5e) ------------------------------------------------------------------------------

_FSIZE = {"tiny": "Tiny", "sm": "Small", "med": "Medium", "lg": "Large", "huge": "Huge", "grg": "Gargantuan"}
_FSIZE_BACK = {v: k for k, v in _FSIZE.items()}
_ACT = {"action": "actions", "bonus": "bonus_actions", "reaction": "reactions", "legendary": "legendary"}
_SKILL_KEYS = {"acr": "acrobatics", "ani": "animal handling", "arc": "arcana", "ath": "athletics", "dec": "deception",
               "his": "history", "ins": "insight", "itm": "intimidation", "inv": "investigation", "med": "medicine",
               "nat": "nature", "prc": "perception", "prf": "performance", "per": "persuasion", "rel": "religion",
               "slt": "sleight of hand", "ste": "stealth", "sur": "survival"}
_SKILL_BACK = {v: k for k, v in _SKILL_KEYS.items()}


def _plain(html):
    t = re.sub(r"<br\s*/?>|</p>\s*<p[^>]*>", " ", html or "")
    t = re.sub(r"\[\[/r(?:oll)?\s+([^\]]+)\]\](?:\{([^}]*)\})?", lambda x: x.group(2) or x.group(1), t)
    t = re.sub(r"@\w+\[[^\]]*\]\{([^}]*)\}", r"\1", t)
    t = re.sub(r"<[^>]+>", "", t)
    import html as H
    return re.sub(r"\s+", " ", H.unescape(t)).strip()


def from_foundry(actor):
    """A dnd5e NPC (the actor's data, as Foundry gives it) as a Lore Studio monster."""
    s = actor.get("system") or {}
    at, de, tr = s.get("attributes") or {}, s.get("details") or {}, s.get("traits") or {}
    ab = s.get("abilities") or {}
    pb = prof_bonus(parse_cr(de.get("cr")) or 0)
    mods = {a: mod((ab.get(a) or {}).get("value", 10)) for a in ABILITIES}
    saves = {a: mods[a] + pb for a in ABILITIES if (ab.get(a) or {}).get("proficient")}
    skills = {}
    for k, v in (s.get("skills") or {}).items():
        lvl = (v or {}).get("value") or 0
        if lvl and k in _SKILL_KEYS:
            skills[_SKILL_KEYS[k]] = mods[SKILLS[_SKILL_KEYS[k]]] + math.floor(pb * lvl)
    mv = at.get("movement") or {}
    speed = {k: int(mv[k]) for k in SPEEDS if _isint(mv.get(k)) and int(mv[k]) > 0}
    se = at.get("senses") or {}
    senses = ", ".join([f"{k} {int(se[k])} ft." for k in ("blindsight", "darkvision", "tremorsense", "truesight")
                        if _isint(se.get(k)) and int(se[k]) > 0] + ([se["special"]] if se.get("special") else []))
    def trait_list(t):
        t = t or {}
        vals = [v for v in (t.get("value") or []) if v]
        return ", ".join([*vals, t.get("custom") or ""]).strip(", ")
    langs = tr.get("languages") or {}
    typ = de.get("type") or {}
    ac = at.get("ac") or {}
    hp = at.get("hp") or {}
    m = {"name": actor.get("name") or "Unnamed", "size": _FSIZE.get(tr.get("size"), "Medium"),
         "type": typ.get("value") or typ.get("custom") or "creature" if isinstance(typ, dict) else str(typ),
         "subtype": typ.get("subtype", "") if isinstance(typ, dict) else "", "alignment": de.get("alignment") or "",
         "ac": ac.get("flat") or ac.get("value") or 10, "hp": hp.get("max") or hp.get("value") or 1, "hit_dice": hp.get("formula") or "",
         "speed": speed, "hover": bool(mv.get("hover")), "abilities": {a: (ab.get(a) or {}).get("value", 10) for a in ABILITIES},
         "saves": saves, "skills": skills, "vulnerabilities": trait_list(tr.get("dv")), "resistances": trait_list(tr.get("dr")),
         "immunities": trait_list(tr.get("di")), "condition_immunities": trait_list(tr.get("ci")), "senses": senses,
         "languages": trait_list(langs), "cr": parse_cr(de.get("cr")) or 0,
         "legendary_count": ((s.get("resources") or {}).get("legact") or {}).get("max") or 3,
         "notes": _plain((de.get("biography") or {}).get("value", ""))[:4000], "source": "Foundry",
         "foundry_id": actor.get("_id") or actor.get("id") or ""}
    for sec in SECTIONS:
        m[sec] = []
    for it in actor.get("items") or []:
        if it.get("type") not in ("feat", "weapon", "spell", "equipment", "consumable"):
            continue
        if it.get("type") in ("equipment",) and not ((it.get("system") or {}).get("description") or {}).get("value"):
            continue
        sy = it.get("system") or {}
        acts = sy.get("activities") or {}
        act = next((a.get("activation", {}).get("type") for a in acts.values() if isinstance(a, dict)), None) if isinstance(acts, dict) else None
        act = act or (sy.get("activation") or {}).get("type") or ""
        desc = _plain((sy.get("description") or {}).get("value", ""))
        if not desc and it.get("type") == "weapon":
            base = (sy.get("damage") or {}).get("base") or {}
            if base.get("number") and base.get("denomination"):
                desc = f"Weapon attack. Hit: {base['number']}d{base['denomination']}{(' + ' + str(base['bonus'])) if base.get('bonus') else ''} {', '.join(base.get('types') or [])} damage."
        if it.get("type") == "spell":
            continue
        m[_ACT.get(act, "traits")].append({"name": it.get("name", ""), "desc": desc})
    return clean(m)


def _rolls_html(text):
    """Plain stat block text as Foundry HTML, with clickable rolls for attacks and damage (Foundry's own [[/r]] rolls)."""
    import html as H
    t = H.escape(text)
    t = _HIT.sub(lambda x: f"[[/r 1d20{'+' if x.group(1) == '+' else '-'}{x.group(2)}]]{{{x.group(1)}{x.group(2)}}} to hit", t)
    def dmg(x):
        sign = ("+" if x.group(4) in ("+", None) else "-") + x.group(5) if x.group(5) else ""
        shown = x.group(0)[x.group(0).index("(") + 1:x.group(0).rindex(")")]
        return f"{x.group(1)} ([[/r {x.group(2)}d{x.group(3)}{sign}]]{{{shown}}})"
    t = _DMG.sub(dmg, t)
    return f"<p>{t}</p>"


def _activity_id(n):
    return f"ls{n:014d}"


def to_foundry(m):
    """A dnd5e NPC actor (create data) from a Lore Studio monster. Works with dnd5e 3.x to 5.x: actions are feature
    items with their activation set both the old way and as a "utility" activity."""
    m = clean(m)
    d = derived(m)
    pb = d["prof"]
    abilities = {a: {"value": m["abilities"][a], "proficient": 1 if a in m["saves"] else 0} for a in ABILITIES}
    skills = {}
    for name, bonus in m["skills"].items():
        key = _SKILL_BACK.get(name)
        if not key:
            continue
        base = d["mods"][SKILLS[name]]
        skills[key] = {"value": 2 if bonus - base >= 2 * pb else 1, "ability": SKILLS[name]}
    sen = {"units": "ft", "special": ""}
    for k in ("blindsight", "darkvision", "tremorsense", "truesight"):
        x = re.search(rf"{k}\s+(\d+)", (m.get("senses") or "").lower())
        if x:
            sen[k] = int(x.group(1))
    leftover = re.sub(r"(blindsight|darkvision|tremorsense|truesight)\s+\d+\s*ft\.?,?", "", m.get("senses") or "", flags=re.I).strip(" ,")
    if leftover:
        sen["special"] = leftover
    items, n = [], 0
    for sec in SECTIONS:
        kind = {"traits": "", "actions": "action", "bonus_actions": "bonus", "reactions": "reaction", "legendary": "legendary"}[sec]
        for a in m[sec]:
            n += 1
            sys_ = {"description": {"value": _rolls_html(a["desc"])}, "type": {"value": "monster"}}
            if kind:
                sys_["activation"] = {"type": kind, "value": 1}
                aid = _activity_id(n)
                sys_["activities"] = {aid: {"_id": aid, "type": "utility", "activation": {"type": kind, "value": 1}, "name": ""}}
            items.append({"name": a["name"] or SECTION_NAMES[sec], "type": "feat", "system": sys_,
                          "flags": {"lore-studio-bridge": {"fromStudio": True}}})
    import html as H
    return {
        "name": m["name"], "type": "npc",
        "system": {
            "abilities": abilities,
            "attributes": {"ac": {"calc": "flat", "flat": m["ac"]}, "hp": {"value": m["hp"], "max": m["hp"], "formula": m.get("hit_dice", "")},
                           "movement": {**{k: m["speed"].get(k, 0) for k in SPEEDS}, "units": "ft", "hover": m.get("hover", False)},
                           "senses": sen},
            "details": {"cr": m["cr"], "xp": {"value": d["xp"]}, "alignment": m.get("alignment", ""),
                        "type": {"value": (m.get("type") or "").lower(), "subtype": m.get("subtype", "")},
                        "biography": {"value": "".join(f"<p>{H.escape(p)}</p>" for p in (m.get("notes") or "").split("\n") if p.strip())}},
            "traits": {"size": _FSIZE_BACK.get(m["size"], "med"),
                       "languages": {"value": [], "custom": m.get("languages", "")},
                       "di": {"value": [], "custom": m.get("immunities", "")}, "dr": {"value": [], "custom": m.get("resistances", "")},
                       "dv": {"value": [], "custom": m.get("vulnerabilities", "")}, "ci": {"value": [], "custom": m.get("condition_immunities", "")}},
            "skills": skills,
            "resources": {"legact": {"value": m["legendary_count"] if m["legendary"] else 0, "max": m["legendary_count"] if m["legendary"] else 0}},
        },
        "items": items,
        "flags": {"lore-studio-bridge": {"monster": m.get("id", "")}},
    }
