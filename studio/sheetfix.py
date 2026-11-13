"""Fix features that don't scale on a dnd5e character sheet.

In dnd5e a class (or subclass) holds *scale values*: a table of what something is at each level, like an
Exploit Die that is d6 at level 2 and d8 at level 7. Features use them in formulas as @scale.<class>.<name>.
Imports from 5etools/Plutonium and homebrew often break this: a feature points at @scale.fighter.exploit-die
when the class is "alternate-fighter", or its die and number of uses are typed in as fixed numbers. This reads
the sheet through the bridge module, finds those, and offers fixes. Every fix keeps a backup so it can be undone.
"""
import re
import time

from . import foundry
from .party import _save_all, get_all

REF = re.compile(r"@scale\.([\w-]+)\.([\w-]+)((?:\.[\w]+)?)")
DICE = re.compile(r"(?<![\w@.])(\d*)d(\d+)(?![\w])")
GENERIC = {"the", "and", "of", "your", "feature", "level", "die", "dice", "uses", "use", "point", "points",
           "bonus", "damage", "extra", "additional", "improved", "greater"}
PERIODS = {"sr": "short rest", "lr": "long rest", "day": "day", "dawn": "dawn", "dusk": "dusk"}


def _words(s):
    out = set()
    for w in re.findall(r"[a-z]+", str(s or "").lower()):
        if len(w) < 3:
            continue
        w = w[:-1] if w.endswith("s") and len(w) > 3 else w
        if w not in GENERIC:
            out.add(w)
    return out


def _mentions(text, title):
    """Whether text names the scale value, allowing plurals: "Exploit Die" matches "expend an exploit die" and "Exploit Dice"."""
    words = re.findall(r"[a-z]+", str(title or "").lower())
    if not words:
        return False
    parts = [r"di(?:e|ce)" if w in ("die", "dice") else re.escape(w[:-1] if w.endswith("s") and len(w) > 3 else w) + r"s?" for w in words]
    return re.search(r"\b" + r"\W+".join(parts) + r"\b", str(text or "").lower()) is not None


def _related(feature, scale):
    """Whether a feature goes with a scale value: their names share a real word (Exploit Dice ~ Exploit Die),
    or the feature's description names it ("expend an Exploit Die")."""
    if _words(feature["name"]) & (_words(scale["title"]) | _words(scale["identifier"].replace("-", " "))):
        return True
    return _mentions(feature.get("desc", ""), scale["title"])


def _shown(scale):
    return f"{scale['ref']} (now {scale['current']})" if scale.get("current") else scale["ref"]


def check(data):
    """Look over a sheet read by character_features and attach problems and suggested fixes.

    Each issue: {"level": "problem"|"suggestion", "text", "fix": [change, ...] or None, "fix_label", "scale_hint"}.
    """
    scales = data.get("scales") or []
    by_ref = {s["ref"]: s for s in scales}
    features = []
    total = {"problem": 0, "suggestion": 0}
    for f in data.get("features") or []:
        issues = []
        places = [("uses", "Uses", f.get("uses_max") or "")] + [(x["key"], x["label"], x["formula"]) for x in f.get("formulas") or []]

        def change(key, text):
            return {"op": "uses", "item": f["id"], "max": text} if key == "uses" else {"op": "formula", "item": f["id"], "key": key, "formula": text}

        for key, label, text in places:
            for m in REF.finditer(text):
                ref = f"@scale.{m.group(1)}.{m.group(2)}"
                s = by_ref.get(ref)
                if s:
                    if not s.get("current"):
                        issues.append({"level": "problem", "text": f"{label} uses {s['title']}, which has no value at their level yet.",
                                       "fix": None, "scale_hint": {"adv_id": s["adv_id"], "item": s["item"]}})
                    continue
                same = [x for x in scales if x["identifier"] == m.group(2)] or [x for x in scales if _related({"name": m.group(2).replace("-", " ")}, x)]
                if len(same) == 1:
                    new = text.replace(m.group(0), same[0]["ref"] + m.group(3))
                    issues.append({"level": "problem", "text": f"{label} points at {ref}, which isn't on this sheet, so it counts as 0.",
                                   "fix": [change(key, new)], "fix_label": f"Use {_shown(same[0])}"})
                else:
                    issues.append({"level": "problem", "text": f"{label} points at {ref}, which isn't on this sheet, so it counts as 0. "
                                   "Add that scale value to their class.", "fix": None,
                                   "scale_hint": {"identifier": m.group(2), "class_identifier": m.group(1),
                                                  "title": m.group(2).replace("-", " ").title()}})
            if "@scale" in text:
                continue
            if key == "uses" and re.fullmatch(r"\s*\d+\s*", text):
                for s in scales:
                    if s["type"] == "number" and _related(f, s):
                        issues.append({"level": "suggestion", "text": f"Uses are fixed at {text.strip()}, so they won't grow with level.",
                                       "fix": [change(key, s["ref"])], "fix_label": f"Use {_shown(s)}"})
                        break
            elif key != "uses":
                dm = DICE.search(text)
                if dm:
                    for s in scales:
                        if s["type"] == "dice" and _related(f, s):
                            count = dm.group(1)
                            term = s["ref"] if count in ("", "1") else f"{count}{s['ref']}.die"
                            new = text[:dm.start()] + term + text[dm.end():]
                            issues.append({"level": "suggestion", "text": f"{label} is a fixed {dm.group(0)}, so it won't grow with level.",
                                           "fix": [change(key, new)], "fix_label": f"Use {_shown(s)}"})
                            break
        for i in issues:
            total[i["level"]] += 1
        features.append({**{k: v for k, v in f.items() if k != "desc"}, "issues": issues})
    out_scales = []
    for s in scales:
        issues = []
        if not s.get("scale"):
            issues.append({"level": "problem", "text": "Has no values at any level."})
        elif not s.get("current") and s.get("levels"):
            first = min(int(x) for x in s["scale"])
            issues.append({"level": "problem" if first <= (s["levels"] or 0) else "suggestion",
                           "text": f"Has no value at level {s['levels']}." if first <= (s["levels"] or 0)
                           else f"Starts at level {first}; they're level {s['levels']}."})
        for i in issues:
            total[i["level"]] += 1
        used = sum(1 for f in data.get("features") or [] for t in [f.get("uses_max", "")] + [x["formula"] for x in f.get("formulas") or []] if s["ref"] in t)
        out_scales.append({**s, "issues": issues, "used_by": used})
    features.sort(key=lambda f: (0 if any(i["level"] == "problem" for i in f["issues"]) else 1 if f["issues"] else 2, f["name"].lower()))
    return {**data, "features": features, "scales": out_scales, "counts": total, "periods": PERIODS}


def _profile(camp, pid):
    party = get_all(camp)
    p = next((x for x in party if x["id"] == pid), None)
    if not p or not p.get("foundry_id"):
        raise ValueError("Link a Foundry character first.")
    return party, p


def read(camp, pid):
    _party, p = _profile(camp, pid)
    return check(foundry.request("character_features", {"id": p["foundry_id"]}, timeout=20))


OPS = ("uses", "formula", "scale", "scale_delete")


def fix(camp, pid, changes):
    """Apply changes on the Foundry sheet, keeping what was there so the fix can be undone."""
    party, p = _profile(camp, pid)
    changes = [c for c in changes or [] if isinstance(c, dict) and c.get("op") in OPS and c.get("item")]
    if not changes:
        raise ValueError("Nothing to change.")
    data = foundry.request("character_features_fix", {"id": p["foundry_id"], "changes": changes}, timeout=25)
    backup = data.pop("backup", None) or []
    if backup:
        hist = p.get("features_backup") or []
        hist.append({"saved": time.time(), "changes": backup, "what": len(changes)})
        p["features_backup"] = hist[-20:]
        _save_all(camp, party)
    return {**check(data), "undo": len(p.get("features_backup") or [])}


def undo(camp, pid):
    """Put back exactly what the last fix changed."""
    party, p = _profile(camp, pid)
    hist = p.get("features_backup") or []
    if not hist:
        raise ValueError("There's no feature fix to undo.")
    last = hist[-1]
    data = foundry.request("character_features_fix", {"id": p["foundry_id"], "changes": last["changes"]}, timeout=25)
    data.pop("backup", None)
    hist.pop()
    p["features_backup"] = hist
    _save_all(camp, party)
    return {**check(data), "undo": len(hist)}
