"""Monster maker: SRD data, challenge rating estimates, scaling, party targets, 5etools and Foundry conversions."""
import json

from studio import monsters as M


def test_srd_is_bundled_with_credit():
    lst = M.srd_list()
    assert len(lst) > 300 and any(x["name"] == "Goblin" for x in lst)
    assert "CC BY 4.0" in M.SRD_CREDIT and "credit" in json.loads(M.SRD_FILE.read_text(encoding="utf-8"))
    g = M.srd_get("goblin")
    assert g["ac"] == 15 and g["skills"] == {"stealth": 6} and g["source"] == "SRD 5.1"


def test_estimate_lands_near_the_official_cr_for_most_srd_monsters():
    off = [abs(M.CRS.index(M.estimate(M.srd_get(x["index"]))["cr"]) - M.CRS.index(x["cr"])) for x in M.srd_list()]
    assert sum(1 for d in off if d <= 2) / len(off) > 0.85
    dragon = M.estimate(M.srd_get("adult-red-dragon"))
    assert dragon["legendary_damage"] > 0 and 15 <= dragon["cr"] <= 19


def test_scaling_moves_every_number_the_table_cares_about():
    g = M.srd_get("goblin")
    big, changes = M.scale(g, 5)
    assert big["cr"] == 5 and 50 <= big["hp"] <= 160 and big["ac"] in (16, 17) and big["skills"]["stealth"] == 7
    assert "to hit" in big["actions"][0]["desc"] and "+4 to hit" not in big["actions"][0]["desc"] and changes[0] == "Challenge 1/4 → 5"
    assert M.estimate(big)["cr"] == 5
    lich, _ = M.scale(M.srd_get("lich"), 10)            # a spellcaster keeps being fragile: its power is in its spells
    assert lich["hp"] < 135
    small, _ = M.scale(M.srd_get("adult-red-dragon"), 8)
    assert small["hp"] < 256 and M.estimate(small)["cr"] <= 10
    assert g["hp"] == 7                                   # the original is untouched


def test_party_targets():
    t = M.party_target([5, 5, 5, 5], "hard", 1)
    assert t["cr"] == 7 and t["budget"] == 3000
    assert M.party_target([5, 5, 5, 5], "hard", 4)["cr"] == 1
    assert M.party_target([3, 3], "medium", 1)["multiplier"] == 1.5      # small parties count monsters as tougher


def test_5etools_homebrew():
    brew = {"monster": [{"name": "Bog Wraith", "size": ["M"], "type": {"type": "undead", "tags": ["swamp"]}, "alignment": ["C", "E"],
                         "ac": [{"ac": 13, "from": ["{@item leather armor|phb}"]}], "hp": {"average": 45, "formula": "10d8"},
                         "speed": {"walk": 30, "fly": {"number": 40}, "canHover": True}, "str": 12, "dex": 16, "con": 10, "int": 8, "wis": 12, "cha": 14,
                         "save": {"dex": "+5"}, "skill": {"stealth": "+5"}, "resist": ["cold", {"resist": ["piercing"], "note": "from nonmagical attacks"}],
                         "senses": ["darkvision 60 ft."], "languages": ["Common"], "cr": "3",
                         "trait": [{"name": "Swamp Step", "entries": ["It ignores {@condition difficult terrain|phb}."]}],
                         "action": [{"name": "Chill Touch", "entries": ["{@atk ms} {@hit 5} to hit, reach 5 ft. {@h}10 ({@damage 3d6}) cold damage, and a {@dc 13} Constitution save."]}]}]}
    m = M.from_5etools(brew)[0]
    assert m["type"] == "undead" and m["subtype"] == "swamp" and m["alignment"] == "chaotic evil" and m["ac_note"] == "leather armor"
    assert m["speed"] == {"walk": 30, "fly": 40} and m["hover"] and m["saves"] == {"dex": 5} and m["cr"] == 3
    assert m["resistances"] == "cold, piercing, from nonmagical attacks"
    assert m["actions"][0]["desc"].startswith("Melee Spell Attack: +5 to hit") and "Hit: 10 (3d6) cold damage, and a DC 13 Constitution save." in m["actions"][0]["desc"]
    assert m["traits"][0]["desc"] == "It ignores difficult terrain."


def test_foundry_actor_round_trip():
    g = M.srd_get("goblin")
    actor = M.to_foundry(g)
    assert actor["type"] == "npc" and actor["system"]["attributes"]["ac"]["flat"] == 15 and actor["system"]["traits"]["size"] == "sm"
    assert actor["system"]["skills"]["ste"]["value"] == 2                  # stealth +6 at CR 1/4 is expertise
    html = actor["items"][1]["system"]["description"]["value"]
    assert "[[/r 1d20+4]]{+4} to hit" in html and "5 ([[/r 1d6+2]]{1d6 + 2})" in html
    assert actor["items"][1]["system"]["activation"]["type"] == "action" and actor["items"][1]["flags"]["lore-studio-bridge"]["fromStudio"]
    back = M.from_foundry({**actor, "_id": "x1", "items": [{**it, "type": "feat"} for it in actor["items"]]})
    assert back["actions"][0]["desc"] == g["actions"][0]["desc"] and back["traits"][0]["name"] == "Nimble Escape"
    assert back["skills"] == {"stealth": 6} and back["ac"] == 15


def test_storage_and_stat_text(tmp_path):
    from studio import campaign
    camp = campaign.create(tmp_path / "Camp", "Test")
    m = M.save(camp, {**M.blank("John Doe's Hound"), "cr": "1/2"})
    assert M.get(camp, m["id"])["cr"] == 0.5 and M.list_monsters(camp)[0]["cr_label"] == "1/2"
    twin = M.save(camp, M.blank("John Doe's Hound"))
    assert twin["id"] != m["id"]
    text = M.stat_text(M.get(camp, m["id"]))
    assert text.startswith(":::stat John Doe's Hound | Medium humanoid") and text.endswith(":::")
    from studio import plans
    assert '<div class="stat"><span class="nm">John Doe&#x27;s Hound</span>' in plans.render("## A\n\n" + text, "T", 1) or \
        'class="stat"' in plans.render("## A\n\n" + text, "T", 1)


def test_scaling_keeps_a_monsters_character():
    """A hard-hitting, fragile monster stays hard-hitting and fragile, and damage really does go up."""
    o = M.srd_get("owlbear")
    up, changes = M.scale(o, 5)
    assert M.offense(up)["dpr"] > M.offense(o)["dpr"] and any(c.startswith("Attack bonuses +") for c in changes)
    assert up["hp"] < M.STATS[5][2]                     # still below the table's hit points for CR 5


def test_an_old_foundry_module_gets_a_clear_message(monkeypatch):
    import time
    import pytest
    from studio import foundry
    monkeypatch.setitem(foundry._status, "last_seen", time.time())
    monkeypatch.setitem(foundry._status, "module", "0.7.5")
    with pytest.raises(foundry.FoundryError, match="needs version 0.8.0 or newer.*yours is 0.7.5"):
        foundry.request("actor_save", {})
