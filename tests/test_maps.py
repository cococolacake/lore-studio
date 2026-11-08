"""Maps: LegendKeeper coordinate conversion, pins, sub-maps, page links."""
import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio import campaign, maps  # noqa: E402
from studio.util import write_json  # noqa: E402

PNG = "data:image/png;base64," + base64.b64encode(
    bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                  "1f15c4890000000d49444154789c6360f8ffff3f0005fe02fea7d8f1"
                  "2b0000000049454e44ae426082")).decode()


@pytest.fixture
def camp(tmp_path):
    c = campaign.create(tmp_path / "Camp", "Test")
    c.create_page(None, "Westmarch")
    return c


def test_legendkeeper_coordinates(camp):
    v1 = {"name": "Eldoria", "bounds": [[-3092, 0], [0, 5000]], "max_zoom": 5,
          "pins": [{"name": "Ravenford", "pos": [-23.27932, 106.40741], "page": "Westmarch", "color": "#3B82F6"}]}
    write_json(camp.root / "maps" / "World Map.json", v1)
    m = maps.read(camp, "World Map")
    p = m["pins"][0]
    assert m["version"] == 2 and abs(p["x"] - 0.681) < 0.001 and abs(p["y"] - 0.2409) < 0.001
    assert maps.pins_for_page(camp, "Westmarch")[0]["pin"] == p["id"]


def test_create_pins_submaps_and_delete(camp):
    world = maps.create(camp, "World", {"data_url": PNG, "filename": "w.png"})
    assert world["image"] == "maps/world.png" and (camp.root / "maps" / "world.png").exists()
    assert world["image_url"] == "/c/maps/world.png"
    region = maps.create(camp, "Westmarch Region", {"data_url": PNG}, page="Westmarch")
    w = maps.save_pin(camp, "world", {"name": "Westmarch", "x": 0.2, "y": 1.7, "page": "Westmarch", "map": region["id"], "gm": True})
    pin = w["pins"][0]
    assert pin["y"] == 1.0 and pin["map"] == "westmarch-region" and pin["gm"]
    w = maps.save_pin(camp, "world", {**pin, "x": 0.5})
    assert w["pins"][0]["x"] == 0.5 and len(w["pins"]) == 1
    on = maps.pins_for_page(camp, "Westmarch")
    assert {o["map"] for o in on} == {"world", "westmarch-region"}
    maps.delete(camp, region["id"])
    assert maps.read(camp, "world")["pins"][0]["map"] is None
    assert [m["id"] for m in maps.list_maps(camp)] == ["world"]
    w = maps.delete_pin(camp, "world", pin["id"])
    assert w["pins"] == []


def test_bad_map_ids(camp):
    for bad in ("../x", "a/b", ".hidden", ""):
        with pytest.raises(campaign.CampaignError):
            maps.read(camp, bad)


def test_pin_settings_and_lk_icons(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import campaign, maps
    camp = campaign.create(tmp_path / "C", "C")
    m = maps.create(camp, "World")
    m = maps.save_pin(camp, m["id"], {"name": "Ravenford", "x": .5, "y": .5, "icon": "castle", "size": "xl", "label": "always",
                                      "layer": "Towns", "zmin": "2.5", "zmax": 0, "note": "Walled town."})
    p = m["pins"][0]
    assert (p["icon"], p["size"], p["label"], p["layer"], p["zmin"], p["zmax"], p["note"]) == ("castle", "xl", "always", "Towns", 2.5, None, "Walled town.")
    m = maps.save_pin(camp, m["id"], {**p, "size": "giant", "label": "sometimes", "icon": "<script>"})
    assert m["pins"][0]["size"] == "m" and m["pins"][0]["label"] == "hover" and m["pins"][0]["icon"] == "script"
    assert maps.icon_from_lk("fas fa-dungeon") == "dungeon" and maps.icon_from_lk("fa-beer-mug") == "tavern" and maps.icon_from_lk("zzz") == ""
