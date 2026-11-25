"""Combat simulator: run an encounter against the party many times and report how it tends to go.

The monsters come from your Monsters (or the free 5e rules); the player characters come from their Foundry sheets,
which the bridge reads on the Party page: hit points, armour class, saving throws, and the attacks, spells and
healing on the sheet. It's a rough model, not a replay of your table:

- Everyone fights in one open space. No movement, cover, flanking or terrain.
- Monsters use their attacks, Multiattack, recharge abilities and legendary actions. Characters use their best
  attack, cantrip or damaging spell each turn (spending slots), plus a bonus-action attack or heal if they have one,
  and they pick up a fallen friend with healing when they can.
- Conditions, auras, lair actions, spells that don't deal damage, and anything else the text can't put a number on
  are left out, and listed as such so you know.

Every number here is an average over many runs, so treat it like the weather forecast: good for spotting a fight
that is much easier or much harder than it looks.
"""
import random
import re

from . import monsters as M

WORDNUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8}
ABILS = ["str", "dex", "con", "int", "wis", "cha"]
ABIL_WORD = {"strength": "str", "dexterity": "dex", "constitution": "con", "intelligence": "int", "wisdom": "wis", "charisma": "cha"}

_DICE = re.compile(r"(\d*)d(\d+)")
_DMG_CLAUSE = re.compile(r"\d+\s*\(\s*([0-9d+\-−\s]+)\)\s*([a-z]+)?\s*damage", re.I)
_HIT = re.compile(r"([+\-−])\s*(\d+)\s+to hit", re.I)
_DC_SAVE = re.compile(r"DC\s*(\d+)\s+(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving throw", re.I)
_RECHARGE = re.compile(r"recharge\s+(\d)(?:\s*[-–]\s*6)?", re.I)
_COST = re.compile(r"costs?\s+(\d)\s+actions?", re.I)
_PER_DAY = re.compile(r"(\d+)\s*/\s*day", re.I)
_AREA = re.compile(r"\beach creature\b|\bcreatures? (?:in|within) (?:a|an|the)?\s*\d+[- ]f(?:oo)?t", re.I)


# ---- dice ---------------------------------------------------------------------------------------

class Dice:
    """A damage or healing formula as dice plus a flat number, e.g. "2d6 + 4" or "1d8 + 1d6 + 3"."""

    def __init__(self, formula):
        self.dice, self.flat = [], 0
        text = str(formula or "").replace("−", "-").replace(" ", "")
        text = re.sub(r"\[[^\]]*\]", "", text)  # flavour like 2d6[fire]
        for sign, term in re.findall(r"([+\-]?)([^+\-]+)", text):
            neg = sign == "-"
            m = _DICE.fullmatch(term)
            if m:
                self.dice.append((int(m.group(1) or 1) * (-1 if neg else 1), int(m.group(2))))
            elif term.isdigit():
                self.flat += -int(term) if neg else int(term)

    def __bool__(self):
        return bool(self.dice) or self.flat != 0

    def average(self):
        return sum(n * (d + 1) / 2 for n, d in self.dice) + self.flat

    def roll(self, rng, crit=False, crit_rule="standard"):
        total = self.flat
        for n, d in self.dice:
            sign, n = (-1 if n < 0 else 1), abs(n)
            rolled = sum(rng.randint(1, d) for _ in range(n))
            if crit:
                rolled += n * d if crit_rule == "max" else sum(rng.randint(1, d) for _ in range(n))
            total += sign * rolled
        return max(0, total)


# ---- monsters -----------------------------------------------------------------------------------

def _damage_parts(text):
    """[(Dice, type)] for every 'N (XdY + Z) type damage' in an action's text."""
    out = []
    for m in _DMG_CLAUSE.finditer(text or ""):
        d = Dice(m.group(1))
        if d:
            out.append((d, (m.group(2) or "").lower()))
    return out


def _monster_action(a):
    """One action as something the simulator can use, or None if it has no numbers in it."""
    name, desc = a.get("name", ""), a.get("desc", "")
    text = f"{name}. {desc}"
    parts = _damage_parts(desc)
    hit = _HIT.search(desc)
    save = _DC_SAVE.search(desc)
    rech = _RECHARGE.search(name)
    uses = _PER_DAY.search(name)
    base = {"name": re.sub(r"\s*\(.*?\)\s*$", "", name).strip(), "label": name, "recharge": int(rech.group(1)) if rech else None,
            "uses": int(uses.group(1)) if uses else None}
    if hit and parts:
        return {**base, "kind": "attack", "to_hit": int(hit.group(2)) * (-1 if hit.group(1) in "-−" else 1), "damage": parts}
    if save and parts:
        half = bool(re.search(r"half as much damage|half damage", desc, re.I))
        return {**base, "kind": "save", "dc": int(save.group(1)), "ability": ABIL_WORD[save.group(2).lower()], "damage": parts,
                "half": half, "area": bool(_AREA.search(text))}
    return None


def _multiattack(desc, actions):
    """[(count, action)] from a Multiattack description, matched against the monster's attack names."""
    d = re.split(r"\b(?:it|she|he|they|the \w+) can replace\b|\breplac(?:e|ing)\b|\binstead of\b", (desc or "").lower())[0]
    plan = []
    for a in sorted(actions, key=lambda x: -len(x["name"])):
        n = a["name"].lower()
        if not n:
            continue
        stem = re.escape(n.rstrip("s"))
        m = re.search(rf"\b(\d+|a|an|one|two|three|four|five|six|seven|eight)\s+(?:\w+\s+){{0,3}}?{stem}s?\b", d)
        if m:
            plan.append((WORDNUM.get(m.group(1), int(m.group(1)) if m.group(1).isdigit() else 1), a))
            d = d[:m.start()] + d[m.end():]
    if not plan and actions:
        m = re.search(r"\b(two|three|four|five|six|seven|eight|\d+)\b[^.]*\battacks?\b", d)
        best = max((x for x in actions if x["kind"] == "attack"), key=_avg_damage, default=None)
        if m and best:
            plan.append((WORDNUM.get(m.group(1), int(m.group(1)) if m.group(1).isdigit() else 1), best))
    return plan


def _avg_damage(action):
    return sum(d.average() for d, _ in action.get("damage") or [])


def build_monster(m, label):
    """A monster stat block turned into what the simulator needs, plus a list of what it had to leave out."""
    mods = {a: M.mod(m["abilities"].get(a)) for a in ABILS}
    saves = {a: int(m.get("saves", {}).get(a, mods[a])) for a in ABILS}
    actions, skipped = [], []
    multi = None
    for a in m.get("actions") or []:
        if a.get("name", "").lower() == "multiattack":
            multi = a
            continue
        x = _monster_action(a)
        (actions.append(x) if x else skipped.append(a.get("name", "")))
    plan = _multiattack(multi["desc"], actions) if multi else []
    # The free 5e rules data leaves "(Recharge 5-6)" off names like Fire Breath. A big area effect that out-damages
    # the monster's whole Multiattack is almost always a recharge ability, so treat it as one.
    plan_avg = sum(n * _avg_damage(a) for n, a in plan) or max((_avg_damage(a) for a in actions if a["kind"] == "attack"), default=0)
    assumed = []
    for a in actions:
        if a["kind"] == "save" and a.get("area") and not a["recharge"] and not a["uses"] and _avg_damage(a) > plan_avg:
            a["recharge"] = 5
            assumed.append(a["name"])
    bonus = [x for x in (_monster_action(a) for a in m.get("bonus_actions") or []) if x]
    skipped += [a.get("name", "") for a in m.get("bonus_actions") or [] if not _monster_action(a)]
    legendary = []
    for a in m.get("legendary") or []:
        cost = _COST.search(a.get("name", "") + " " + a.get("desc", ""))
        own = _monster_action(a)
        if not own:  # "makes one Golden Dagger attack" / "uses Unseen Gaze"
            ref = next((x for x in sorted(actions + bonus, key=lambda y: -len(y["name"]))
                        if x["name"] and re.search(rf"\b{re.escape(x['name'].lower())}\b", a.get("desc", "").lower())), None)
            own = dict(ref, recharge=None, uses=None) if ref else None
        if own:
            legendary.append({**own, "cost": int(cost.group(1)) if cost else 1, "label": a.get("name", "")})
        else:
            skipped.append(a.get("name", ""))
    lr = 0
    for t in m.get("traits") or []:
        if "legendary resistance" in t.get("name", "").lower():
            u = _PER_DAY.search(t["name"] + " " + t.get("desc", ""))
            lr = int(u.group(1)) if u else 3
    resist = _types(m.get("resistances")); immune = _types(m.get("immunities"))
    if not actions:
        skipped.append("(no attacks it could use)")
    return {"name": label, "base": m["name"], "hp": int(m.get("hp") or 1), "ac": int(m.get("ac") or 10), "saves": saves,
            "init": mods["dex"], "actions": actions, "plan": plan, "bonus": bonus, "legendary": legendary,
            "legendary_count": int(m.get("legendary_count") or 3) if legendary else 0, "lr": lr,
            "resist": resist, "immune": immune, "skipped": [s for s in skipped if s], "assumed_recharge": assumed,
            "ignored_traits": [t.get("name", "") for t in m.get("traits") or [] if "legendary resistance" not in t.get("name", "").lower()]}


def _types(text):
    t = (text or "").lower()
    return {w for w in ("acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison",
                        "psychic", "radiant", "slashing", "thunder") if w in t}


# ---- player characters --------------------------------------------------------------------------

# rough damage per round by level (after misses), for a character whose sheet has no attacks the bridge could read
_EST_DPR = [0, 8, 9, 11, 13, 17, 18, 20, 22, 26, 28, 30, 32, 34, 36, 38, 40, 44, 46, 50, 54]


def build_character(p):
    """A party member from their Foundry sheet (or a typed-in level when there's no sheet)."""
    s = p.get("sheet") or {}
    level = int(s.get("level") or (str(p.get("level") or "").isdigit() and int(p["level"])) or 1)
    level = max(1, min(20, level))
    prof = 2 + (level - 1) // 4
    ab = s.get("abilities") or {}
    mods = {a: int((ab.get(a) or {}).get("mod") or 0) for a in ABILS}
    saves = {a: int((s.get("saves") or {}).get(a, mods[a])) for a in ABILS}
    hp_max = int(s.get("hp_max") or 0) or level * 8
    notes = []
    options, heals = [], []
    for x in s.get("attacks") or []:
        dmg = [(Dice(d.get("formula")), (d.get("type") or "").lower()) for d in x.get("damage") or []]
        dmg = [(d, t) for d, t in dmg if d]
        if not dmg:
            continue
        opt = {"name": x.get("name") or "Attack", "kind": x.get("kind"), "damage": dmg, "activation": x.get("activation") or "action",
               "level": int(x.get("level") or 0), "uses": x.get("uses"), "area": bool(x.get("area")), "weapon": bool(x.get("weapon"))}
        if x.get("kind") == "attack" and x.get("to_hit") is not None:
            options.append({**opt, "to_hit": int(x["to_hit"])})
        elif x.get("kind") == "save" and x.get("dc"):
            options.append({**opt, "dc": int(x["dc"]), "ability": (x.get("ability") or "dex")[:3], "half": x.get("half", True)})
    for x in s.get("heals") or []:
        d = Dice(x.get("formula"))
        if d:
            heals.append({"name": x.get("name") or "Healing", "dice": d, "activation": x.get("activation") or "action",
                          "level": int(x.get("level") or 0), "uses": x.get("uses")})
    if not options:
        dpr = _EST_DPR[level]
        options.append({"name": "Typical attack (estimated)", "kind": "attack", "to_hit": prof + 4, "activation": "action",
                        "damage": [(Dice(f"{max(1, round(dpr / 0.65 * 0.6 / 4.5))}d8+{max(0, round(dpr / 0.65 * 0.4))}"), "")], "level": 0,
                        "uses": None, "area": False, "weapon": True})
        notes.append("No attacks read from Foundry, so its damage is estimated from its level.")
    if not s:
        notes.append("No Foundry sheet linked: hit points and armour class are guesses.")
    return {"name": p.get("character") or s.get("name") or "Character", "hp_max": hp_max,
            "hp_now": int(s.get("hp") if s.get("hp") is not None else hp_max), "ac": int(s.get("ac") or 15),
            "saves": saves, "init": mods["dex"], "options": options, "heals": heals,
            "attacks_per_action": max(1, int(s.get("attacks_per_action") or 1)),
            "slots": {int(k): int(v) for k, v in (s.get("slots") or {}).items() if str(k).isdigit()}, "notes": notes}


# ---- one fight ----------------------------------------------------------------------------------

class Fight:
    def __init__(self, party, waves, opts, rng, log=None):
        self.rng, self.opts, self.log = rng, opts, log
        self.crit_rule = opts.get("crit_rule", "standard")
        self.nat1_misses = opts.get("nat1_misses", True)
        self.pcs = [dict(c, hp=(c["hp_now"] if opts.get("start") == "current" else c["hp_max"]), down=0, dead=False,
                         fails=0, wins=0, stable=False, slots=dict(c["slots"]), used={}, dealt=0, went_down=False) for c in party]
        self.waves = waves
        self.rounds = 0

    def say(self, text):
        if self.log is not None and len(self.log) < 400:
            self.log.append(text)

    # -- dice helpers
    def d20(self):
        return self.rng.randint(1, 20)

    def attack_hits(self, bonus, ac):
        r = self.d20()
        if r == 20:
            return True, True
        if r == 1 and self.nat1_misses:
            return False, False
        return r + bonus >= ac, False

    def damage(self, parts, target, crit=False, half=False):
        total = 0
        for d, t in parts:
            n = d.roll(self.rng, crit, self.crit_rule)
            if t and t in target.get("immune", ()):
                n = 0
            elif t and t in target.get("resist", ()):
                n //= 2
            total += n
        return total // 2 if half else total

    # -- the fight
    def run(self):
        for w, wave in enumerate(self.waves):
            foes = [dict(m, hp_left=m["hp"], lr_left=m["lr"], spent={}, charged={}) for m in wave]
            if len(self.waves) > 1:
                self.say(f"Wave {w + 1}: {' / '.join(f['name'] for f in foes)}")
            order = [("pc", c, c["init"] + self.d20()) for c in self.pcs] + [("m", f, f["init"] + self.d20()) for f in foes]
            order.sort(key=lambda x: -x[2])
            while True:
                self.rounds += 1
                self.say(f"Round {self.rounds}")
                for f in foes:
                    f["la_left"] = f["legendary_count"]
                for kind, who, _ in order:
                    if not self.alive_foes(foes) or not self.standing():
                        break
                    if kind == "pc":
                        self.pc_turn(who, foes)
                    elif who["hp_left"] > 0:
                        self.monster_turn(who)
                    self.legendary(foes, after=who)
                if not self.alive_foes(foes):
                    break
                if not self.standing():
                    return "loss"
                if self.rounds >= self.opts.get("max_rounds", 30):
                    return "stalemate"
        return "win"

    def alive_foes(self, foes):
        return [f for f in foes if f["hp_left"] > 0]

    def standing(self):
        return [c for c in self.pcs if c["hp"] > 0]

    # -- characters
    def pc_turn(self, c, foes):
        if c["dead"]:
            return
        if c["hp"] <= 0:
            return None if c["stable"] else self.death_save(c)
        downed = [x for x in self.pcs if x["hp"] <= 0 and not x["dead"]]
        used_bonus = False
        if downed:
            for act in ("bonus", "action"):
                h = self.pick_heal(c, act)
                if h:
                    self.heal(c, h, downed[0])
                    if act == "bonus":
                        used_bonus = True
                        break
                    return
        best = self.pick_option(c, foes, "action")
        if best:
            self.use(c, best, foes, repeat=c["attacks_per_action"] if best.get("weapon") and best["kind"] == "attack" else 1)
        if not used_bonus and self.alive_foes(foes):
            b = self.pick_option(c, foes, "bonus")
            if b:
                self.use(c, b, foes)

    def can_use(self, c, opt):
        if opt.get("uses") is not None and c["used"].get(opt["name"], 0) >= int(opt["uses"]):
            return False
        if opt["level"] > 0 and not any(n > 0 for lv, n in c["slots"].items() if lv >= opt["level"]):
            return False
        return True

    def spend(self, c, opt):
        if opt.get("uses") is not None:
            c["used"][opt["name"]] = c["used"].get(opt["name"], 0) + 1
        if opt["level"] > 0:
            lv = min(lv for lv, n in c["slots"].items() if lv >= opt["level"] and n > 0)
            c["slots"][lv] -= 1

    def expected(self, c, opt, foes, repeat=1):
        alive = self.alive_foes(foes)
        if not alive:
            return 0
        t = min(alive, key=lambda f: f["hp_left"])
        avg = sum(d.average() / (2 if ty in t["resist"] else 1) for d, ty in opt["damage"] if ty not in t["immune"])
        if opt["kind"] == "attack":
            p = max(0.05, min(0.95, (21 - (t["ac"] - opt["to_hit"])) / 20))
            ev = avg * p * repeat
        else:
            p_fail = max(0.05, min(0.95, (opt["dc"] - t["saves"].get(opt["ability"], 0) - 1) / 20))
            ev = avg * (p_fail + (0 if not opt["half"] else (1 - p_fail) / 2))
            if opt["area"]:
                ev *= min(len(alive), 2)
        return ev

    def pick_option(self, c, foes, activation):
        best, score = None, 0
        for o in c["options"]:
            if o["activation"] != activation or not self.can_use(c, o):
                continue
            rep = c["attacks_per_action"] if o.get("weapon") and o["kind"] == "attack" and activation == "action" else 1
            ev = self.expected(c, o, foes, rep)
            if ev > score:
                best, score = o, ev
        return best

    def use(self, c, opt, foes, repeat=1):
        self.spend(c, opt)
        for _ in range(repeat):
            alive = self.alive_foes(foes)
            if not alive:
                return
            targets = [min(alive, key=lambda f: f["hp_left"])]
            if opt["kind"] == "save" and opt["area"]:
                targets = sorted(alive, key=lambda f: f["hp_left"])[:2]
            for t in targets:
                if opt["kind"] == "attack":
                    hit, crit = self.attack_hits(opt["to_hit"], t["ac"])
                    dmg = self.damage(opt["damage"], t, crit) if hit else 0
                    self.say(f"  {c['name']} {opt['name']} → {t['name']}: " + (f"{dmg}{' (crit)' if crit else ''}" if hit else "miss"))
                else:
                    ok = self.d20() + t["saves"].get(opt["ability"], 0) >= opt["dc"]
                    if not ok and t["lr_left"] > 0 and opt["level"] >= 3:
                        t["lr_left"] -= 1
                        ok = True
                        self.say(f"  {t['name']} uses a Legendary Resistance")
                    dmg = self.damage(opt["damage"], t, half=ok and opt["half"]) if (not ok or opt["half"]) else 0
                    self.say(f"  {c['name']} {opt['name']} → {t['name']}: {dmg}{' (saved)' if ok else ''}")
                t["hp_left"] -= dmg
                c["dealt"] += dmg
                if t["hp_left"] <= 0:
                    self.say(f"  {t['name']} falls")

    def pick_heal(self, c, activation):
        for h in sorted(c["heals"], key=lambda x: -x["dice"].average()):
            if h["activation"] == activation and self.can_use(c, h):
                return h
        return None

    def heal(self, c, h, target):
        self.spend(c, h)
        n = h["dice"].roll(self.rng)
        target["hp"] = min(target["hp_max"], max(0, target["hp"]) + n)
        target["fails"] = target["wins"] = 0
        target["stable"] = False
        self.say(f"  {c['name']} {h['name']} → {target['name']}: +{n}")

    def death_save(self, c):
        r = self.d20()
        if r == 20:
            c["hp"], c["fails"], c["wins"], c["stable"] = 1, 0, 0, False
            self.say(f"  {c['name']} rolls a natural 20 and gets up")
            return
        if r == 1:
            c["fails"] += 2
        elif r >= 10:
            c["wins"] += 1
        else:
            c["fails"] += 1
        if c["fails"] >= 3:
            c["dead"] = True
            self.say(f"  {c['name']} dies")
        elif c["wins"] >= 3:
            c["stable"] = True  # still at 0, but no more death saves
            self.say(f"  {c['name']} is stable")

    def hurt(self, c, n, crit=False):
        if c["dead"]:
            return
        if c["hp"] <= 0:
            c["stable"] = False
            c["fails"] += 2 if crit else 1
            if n >= c["hp_max"] or c["fails"] >= 3:
                c["dead"] = True
                self.say(f"  {c['name']} dies")
            return
        c["hp"] -= n
        if c["hp"] <= 0:
            if -c["hp"] >= c["hp_max"]:
                c["dead"] = True
                self.say(f"  {c['name']} dies outright")
            c["hp"], c["down"], c["went_down"] = 0, c["down"] + 1, True
            c["fails"] = c["wins"] = 0
            if not c["dead"]:
                self.say(f"  {c['name']} drops to 0")

    # -- monsters
    def monster_turn(self, f):
        for a in f["actions"]:  # recharge rolls
            if a["recharge"] and f["charged"].get(a["name"]) is False and self.rng.randint(1, 6) >= a["recharge"]:
                f["charged"][a["name"]] = True
        special = [a for a in f["actions"] if self.ready(f, a) and (a["recharge"] or a["uses"])]
        plan_ev = sum(n * self.monster_ev(a) for n, a in f["plan"]) if f["plan"] else max((self.monster_ev(a) for a in f["actions"] if not a["recharge"] and not a["uses"]), default=0)
        best_special = max(special, key=self.monster_ev, default=None)
        if best_special and self.monster_ev(best_special) >= plan_ev * 0.9:
            self.monster_act(f, best_special)
        elif f["plan"]:
            for n, a in f["plan"]:
                for _ in range(n):
                    if self.standing():
                        self.monster_act(f, a)
        else:
            plain = [a for a in f["actions"] if not a["recharge"] and not a["uses"]] or [a for a in f["actions"] if self.ready(f, a)]
            if plain:
                self.monster_act(f, max(plain, key=self.monster_ev))
        for b in f["bonus"]:
            if self.ready(f, b) and self.standing():
                self.monster_act(f, b)
                break

    def ready(self, f, a):
        if a["recharge"] and f["charged"].get(a["name"]) is False:
            return False
        if a["uses"] and f["spent"].get(a["name"], 0) >= a["uses"]:
            return False
        return True

    def monster_ev(self, a):
        avg = _avg_damage(a)
        if a["kind"] == "save" and a.get("area"):
            avg *= min(len(self.standing()), 2)
        return avg

    def monster_act(self, f, a):
        targets = self.standing()
        if not targets:
            return
        if a["recharge"]:
            f["charged"][a["name"]] = False
        if a["uses"]:
            f["spent"][a["name"]] = f["spent"].get(a["name"], 0) + 1
        if a["kind"] == "save" and a.get("area"):
            hit = self.rng.sample(targets, min(len(targets), 2))
        else:
            hit = [self.rng.choice(targets)]
        for t in hit:
            if a["kind"] == "attack":
                ok, crit = self.attack_hits(a["to_hit"], t["ac"])
                dmg = self.damage(a["damage"], {}, crit) if ok else 0
                self.say(f"  {f['name']} {a['name']} → {t['name']}: " + (f"{dmg}{' (crit)' if crit else ''}" if ok else "miss"))
                if ok:
                    self.hurt(t, dmg, crit)
            else:
                saved = self.d20() + t["saves"].get(a["ability"], 0) >= a["dc"]
                dmg = self.damage(a["damage"], {}, half=saved) if (not saved or a["half"]) else 0
                self.say(f"  {f['name']} {a['name']} → {t['name']}: {dmg}{' (saved)' if saved else ''}")
                self.hurt(t, dmg)

    def legendary(self, foes, after):
        for f in foes:
            if f is after or f["hp_left"] <= 0 or f["la_left"] <= 0 or not f["legendary"] or not self.standing():
                continue
            opts = [a for a in f["legendary"] if a["cost"] <= f["la_left"]]
            if not opts:
                continue
            a = max(opts, key=lambda x: self.monster_ev(x) / x["cost"])
            f["la_left"] -= a["cost"]
            self.monster_act(f, dict(a, recharge=None, uses=None))


# ---- many fights --------------------------------------------------------------------------------

def simulate(party_entries, groups, runs=1000, opts=None, seed=None):
    """Run the fight `runs` times. `groups` is [(monster dict, count)] in encounter order."""
    opts = dict(opts or {})
    runs = max(1, min(5000, int(runs or 1000)))
    party = [build_character(p) for p in party_entries]
    if not party:
        raise ValueError("Add your characters on the Party page first (and link their Foundry sheets).")
    waves = []
    for m, count in groups:
        waves.append([build_monster(m, m["name"] + (f" {i + 1}" if count > 1 else "")) for i in range(count)])
    built = [b for w in waves for b in w]
    if not built:
        raise ValueError("Add some monsters to the encounter first.")
    if not opts.get("phases"):
        waves = [built]
    rng = random.Random(seed)
    results = {"win": 0, "loss": 0, "stalemate": 0}
    rounds_won, per_pc = [], {c["name"]: {"down": 0, "dead": 0, "hp_left": 0.0, "dealt": 0} for c in party}
    sample, any_death = [], 0
    for i in range(runs):
        log = sample if i == 0 else None
        fight = Fight(party, waves, opts, rng, log)
        out = fight.run()
        results[out] += 1
        if out == "win":
            rounds_won.append(fight.rounds)
        for c in fight.pcs:
            s = per_pc[c["name"]]
            s["down"] += c["went_down"]
            s["dead"] += c["dead"]
            s["hp_left"] += max(0, c["hp"]) / c["hp_max"]
            s["dealt"] += c["dealt"]
        any_death += any(c["dead"] for c in fight.pcs)
        if log is not None:
            sample.append({"win": "The party wins.", "loss": "The party falls.", "stalemate": "Nobody wins in time."}[out])
    pcs = [{"name": c["name"], "down": round(100 * per_pc[c["name"]]["down"] / runs), "dead": round(100 * per_pc[c["name"]]["dead"] / runs),
            "hp_left": round(100 * per_pc[c["name"]]["hp_left"] / runs), "dealt": round(per_pc[c["name"]]["dealt"] / runs),
            "ac": c["ac"], "hp_max": c["hp_max"], "options": [o["name"] for o in c["options"]][:8], "heals": [h["name"] for h in c["heals"]][:4],
            "notes": c["notes"]} for c in party]
    left_out = []
    for b in built:
        if (b["skipped"] or b["ignored_traits"] or b["assumed_recharge"]) and not any(x["name"] == b["base"] for x in left_out):
            left_out.append({"name": b["base"], "actions": sorted(set(b["skipped"])), "traits": b["ignored_traits"],
                             "assumed": b["assumed_recharge"]})
    return {"runs": runs, "win": round(100 * results["win"] / runs), "loss": round(100 * results["loss"] / runs),
            "stalemate": round(100 * results["stalemate"] / runs),
            "rounds": round(sum(rounds_won) / len(rounds_won), 1) if rounds_won else None,
            "any_death": round(100 * any_death / runs), "party": pcs, "left_out": left_out, "sample": sample[:400], "phases": len(waves),
            "options": {k: opts.get(k) for k in ("crit_rule", "nat1_misses", "start", "phases")}}
