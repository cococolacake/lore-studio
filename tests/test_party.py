"""Party portraits: one you choose, a saved copy of the Foundry portrait, and removing them."""
import base64

import pytest

from studio import campaign, foundry, party

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


@pytest.fixture
def camp(tmp_path):
    return campaign.create(tmp_path / "Camp", "Test Campaign")


def data_url(data=PNG):
    return "data:image/png;base64," + base64.b64encode(data).decode()


def test_chosen_portrait_is_saved_replaced_and_removed(camp):
    p = party.save(camp, {"character": "Jane Roe", "player": "Alex"})
    first = party.set_portrait(camp, p["id"], {"data_url": data_url()})["portrait"]
    assert (camp.root / first).read_bytes() == PNG
    second = party.set_portrait(camp, p["id"], {"data_url": data_url(PNG + b"x")})["portrait"]
    assert second != first and not (camp.root / first).exists()
    assert "portrait" not in party.remove_portrait(camp, p["id"])
    assert not (camp.root / second).exists()


def test_editing_the_profile_keeps_the_portrait(camp):
    p = party.save(camp, {"character": "Jane Roe"})
    rel = party.set_portrait(camp, p["id"], {"data_url": data_url()})["portrait"]
    party.save(camp, {"id": p["id"], "character": "Jane Roe", "backstory": "From the coast."})
    assert party.get_all(camp)[0]["portrait"] == rel


def test_read_sheet_keeps_a_copy_of_the_foundry_portrait(camp, monkeypatch):
    p = party.save(camp, {"character": "John Doe", "foundry_id": "abc"})
    monkeypatch.setattr(foundry, "request", lambda kind, args=None, timeout=15: {"img": "worlds/demo/john.png", "level": 3})
    monkeypatch.setattr(foundry, "status", lambda: {"origin": "http://foundry.test:30000"})
    seen = []

    class Reply:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self, n): return PNG

    monkeypatch.setattr(party.urllib.request, "urlopen", lambda url, timeout: seen.append(url) or Reply())
    copy = party.sync(camp, p["id"])["foundry_portrait"]
    assert seen == ["http://foundry.test:30000/worlds/demo/john.png"]
    assert (camp.root / copy).read_bytes() == PNG


def test_read_sheet_works_when_foundry_web_server_is_unreachable(camp, monkeypatch):
    p = party.save(camp, {"character": "John Doe", "foundry_id": "abc"})
    monkeypatch.setattr(foundry, "request", lambda kind, args=None, timeout=15: {"img": "worlds/demo/john.png"})
    monkeypatch.setattr(foundry, "status", lambda: {"origin": "http://foundry.test:30000"})

    def refuse(url, timeout):
        raise party.urllib.error.URLError("refused")

    monkeypatch.setattr(party.urllib.request, "urlopen", refuse)
    assert "foundry_portrait" not in party.sync(camp, p["id"])


def test_removing_a_character_removes_its_portrait(camp):
    p = party.save(camp, {"character": "Jane Roe"})
    rel = party.set_portrait(camp, p["id"], {"data_url": data_url()})["portrait"]
    party.delete(camp, p["id"])
    assert not (camp.root / rel).exists()
