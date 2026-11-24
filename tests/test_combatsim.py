"""The combat simulator: reading stat blocks and sheets, and running fights."""
import random

from studio import combatsim as S, monsters as M


def srd(name):
    return M.srd_get(next(m["index"] for m in M.srd() if m["name"] == name))


def pc(name, level=5, **sheet):
    base = {"name": name, "level": level, "hp": 40, "hp_max": 40, "ac": 16, "abilities": {"dex": {"mod": 2}}}
    return {"character": name, "level": str(level), "sheet": {**base, **sheet}}


def test_dice_average_and_crit_rules():
    d = S.Dice("2d6 + 4")
    assert d.average() == 11
    rng = random.Random(1)
    assert all(6 <= d.roll(rng) <= 16 for _ in range(200))
    # max + roll: the crit adds the dice at their highest (12) on top of a normal roll
    assert all(d.roll(rng, crit=True, crit_rule="max") >= 18 for _ in range(200))
    assert S.Dice("1d8 + 1d6 - 1").average() == 7
    assert not S.Dice("")


def test_multiattack_reads_counts_and_ignores_replacements():
    dragon = S.build_monster(srd("Young Red Dragon"), "Dragon")
    assert sorted((n, a["name"]) for n, a in dragon["plan"]) == [(1, "Bite"), (2, "Claw")]
    breath = next(a for a in dragon["actions"] if a["name"] == "Fire Breath")
    assert breath["kind"] == "save" and breath["recharge"] == 5 and breath["area"] and breath["half"]
    m = M.clean({"name": "Many Hands", "hp": 100, "ac": 15, "actions": [
        {"name": "Multiattack", "desc": "She makes three Golden Dagger attacks. She can replace one of them with Unseen Gaze."},
        {"name": "Golden Dagger", "desc": "Melee Weapon Attack: +9 to hit, reach 10 ft., one target. Hit: 10 (2d4 + 5) slashing damage."},
        {"name": "Unseen Gaze", "desc": "One creature must succeed on a DC 18 Wisdom saving throw or take 16 (3d10) psychic damage."},
        {"name": "The Offer (1/Day)", "desc": "She offers one creature the thing it wants most."}],
        "legendary": [{"name": "Golden Dagger", "desc": "She makes one Golden Dagger attack."},
                      {"name": "Gaze (Costs 2 Actions)", "desc": "She uses Unseen Gaze."}]})
    b = S.build_monster(m, "Nirvaan")
    assert [(n, a["name"]) for n, a in b["plan"]] == [(3, "Golden Dagger")]
    assert [(x["name"], x["cost"]) for x in b["legendary"]] == [("Golden Dagger", 1), ("Unseen Gaze", 2)]
    assert "The Offer (1/Day)" in b["skipped"]


def test_character_from_sheet_and_estimate_without_one():
    c = S.build_character(pc("Namid", 9, attacks_per_action=2, saves={"dex": 6},
                             attacks=[{"name": "Longsword", "kind": "attack", "to_hit": 8, "weapon": True,
                                       "damage": [{"formula": "1d8 + 4", "type": "slashing"}]}],
                             heals=[{"name": "Healing Word", "formula": "2d4 + 4", "activation": "bonus", "level": 1}],
                             slots={"1": 3}))
    assert c["attacks_per_action"] == 2 and c["saves"]["dex"] == 6 and c["slots"] == {1: 3}
    assert c["options"][0]["name"] == "Longsword" and c["heals"][0]["name"] == "Healing Word" and not c["notes"]
    guess = S.build_character({"character": "Argath", "level": "9"})
    assert guess["hp_max"] == 72 and "estimated" in guess["options"][0]["name"] and guess["notes"]


def test_easy_and_impossible_fights_come_out_that_way():
    party = [pc(f"PC{i}", 5) for i in range(4)]
    easy = S.simulate(party, [(srd("Goblin"), 4)], runs=300, seed=7)
    hard = S.simulate(party, [(srd("Adult Red Dragon"), 1)], runs=300, seed=7)
    assert easy["win"] >= 95 and easy["rounds"]
    assert hard["win"] <= 5 and hard["loss"] >= 90
    assert len(easy["party"]) == 4 and easy["sample"][-1].startswith("The party")


def test_immunity_and_phases():
    party = [pc("Cleric", 9, attacks=[{"name": "Sacred Flame", "kind": "save", "dc": 16, "ability": "dex", "half": False,
                                        "damage": [{"formula": "2d8", "type": "radiant"}]}])]
    angel = M.clean({"name": "Angel", "hp": 30, "ac": 12, "immunities": "radiant",
                     "actions": [{"name": "Slam", "desc": "Melee Weapon Attack: +5 to hit, reach 5 ft. Hit: 1 (1d1) bludgeoning damage."}]})
    r = S.simulate(party, [(angel, 1)], runs=50, seed=1, opts={"max_rounds": 5})
    assert r["party"][0]["dealt"] == 0 and r["stalemate"] == 100
    two = S.simulate([pc(f"PC{i}", 5) for i in range(4)], [(srd("Goblin"), 2), (srd("Goblin"), 2)], runs=50, seed=2, opts={"phases": True})
    assert two["phases"] == 2 and two["win"] >= 90


def test_needs_party_and_monsters():
    import pytest
    with pytest.raises(ValueError):
        S.simulate([], [(srd("Goblin"), 1)])
    with pytest.raises(ValueError):
        S.simulate([pc("A")], [])
