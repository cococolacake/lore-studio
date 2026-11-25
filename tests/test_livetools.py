"""Live mode: NPC cards and Lore Studio's own random tables."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio import campaign  # noqa: E402


@pytest.fixture
def camp(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    return campaign.create(tmp_path / "Camp", "Test")


def test_npc_cards_and_random_tables(camp):
    camp.create_page(None, "Jane Roe")
    camp.write_page("Jane Roe", {"title": "Jane Roe", "tags": ["npc"]},
                    "A rogue from [[Millbrook]] with a quick smile.\n\n:::gm\nShe works for the guild.\n:::\n")
    card = camp.npc_card("Jane Roe")
    assert card["summary"] == "A rogue from Millbrook with a quick smile." and card["look"] == ""
    card = camp.save_npc_card("Jane Roe", {"look": "Red scarf,\n  muddy boots", "secret": "Works for the guild"})
    assert card["look"] == "Red scarf, muddy boots" and card["secret"] == "Works for the guild"
    assert "She works for the guild." in camp.read_page("Jane Roe")["body"]       # the page itself is untouched
    camp.create_page(None, "Loot")
    camp.write_page("Loot", {"title": "Loot", "tags": ["table"]}, "Roll for it.\n\n- 2d6 gold\n* A rusty key\n3. Nothing at all\n")
    assert camp.tables() == [{"id": "Loot", "title": "Loot", "entries": ["2d6 gold", "A rusty key", "Nothing at all"], "gm": False}]
