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


def fake_foundry(monkeypatch, img, data=PNG):
    monkeypatch.setattr(foundry, "request", lambda kind, args=None, timeout=15: {"img": img})
    monkeypatch.setattr(foundry, "status", lambda: {"origin": "http://foundry.test:30000"})
    seen = []

    class Reply:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self, n): return data[:n]

    monkeypatch.setattr(party.urllib.request, "urlopen", lambda url, timeout: seen.append(url) or Reply())
    return seen



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
    seen = fake_foundry(monkeypatch, "worlds/demo/john.png")
    copy = party.sync(camp, p["id"])["foundry_portrait"]
    assert seen == ["http://foundry.test:30000/worlds/demo/john.png"]
    assert (camp.root / copy).read_bytes() == PNG


def test_foundry_paths_with_spaces_are_not_encoded_twice(camp, monkeypatch):
    p = party.save(camp, {"character": "John Doe", "foundry_id": "abc"})
    seen = fake_foundry(monkeypatch, "worlds/demo/Portraits/John%20Doe.webp?1700000000")
    assert party.sync(camp, p["id"])["foundry_portrait"].endswith(".webp")
    assert seen == ["http://foundry.test:30000/worlds/demo/Portraits/John%20Doe.webp?1700000000"]


def test_read_sheet_works_when_foundry_web_server_is_unreachable(camp, monkeypatch):
    p = party.save(camp, {"character": "John Doe", "foundry_id": "abc"})
    fake_foundry(monkeypatch, "worlds/demo/john.png")

    def refuse(url, timeout):
        raise party.urllib.error.URLError("refused")

    monkeypatch.setattr(party.urllib.request, "urlopen", refuse)
    assert "foundry_portrait" not in party.sync(camp, p["id"])


def test_removing_a_character_removes_its_portrait(camp):
    p = party.save(camp, {"character": "Jane Roe"})
    rel = party.set_portrait(camp, p["id"], {"data_url": data_url()})["portrait"]
    party.delete(camp, p["id"])
    assert not (camp.root / rel).exists()


def test_reading_the_sheet_again_replaces_the_old_copy(camp, monkeypatch):
    p = party.save(camp, {"character": "John Doe", "foundry_id": "abc"})
    fake_foundry(monkeypatch, "worlds/demo/john.png")
    first = party.sync(camp, p["id"])["foundry_portrait"]
    fake_foundry(monkeypatch, "worlds/demo/john.png", PNG + b"new")
    second = party.sync(camp, p["id"])["foundry_portrait"]
    assert second != first and not (camp.root / first).exists() and (camp.root / second).exists()


def test_linking_another_foundry_character_drops_the_copy(camp, monkeypatch):
    p = party.save(camp, {"character": "John Doe", "foundry_id": "abc"})
    fake_foundry(monkeypatch, "worlds/demo/john.png")
    copy = party.sync(camp, p["id"])["foundry_portrait"]
    assert "foundry_portrait" not in party.save(camp, {"id": p["id"], "character": "John Doe", "foundry_id": "xyz"})
    assert not (camp.root / copy).exists()


def test_only_downloads_from_the_foundry_server(camp, monkeypatch):
    p = party.save(camp, {"character": "John Doe", "foundry_id": "abc"})
    seen = fake_foundry(monkeypatch, "http://192.168.1.5/admin.png")
    assert "foundry_portrait" not in party.sync(camp, p["id"]) and seen == []


def test_an_image_over_30_mb_is_not_kept(camp, monkeypatch):
    p = party.save(camp, {"character": "John Doe", "foundry_id": "abc"})
    fake_foundry(monkeypatch, "worlds/demo/huge.png", b"x" * (30 * 1024 * 1024 + 1))
    assert "foundry_portrait" not in party.sync(camp, p["id"])


def test_two_characters_with_the_same_picture_keep_it(camp):
    a = party.save(camp, {"character": "Jane Roe"})
    b = party.save(camp, {"character": "John Doe"})
    rel = party.set_portrait(camp, a["id"], {"data_url": data_url()})["portrait"]
    assert party.set_portrait(camp, b["id"], {"data_url": data_url()})["portrait"] == rel
    party.delete(camp, a["id"])
    assert (camp.root / rel).exists()


def test_never_deletes_outside_the_party_folder(camp, tmp_path):
    outside = tmp_path / "keep.txt"
    outside.write_text("mine")
    (camp.root / "notes.png").write_bytes(PNG)
    camp.save_info({"party": [{"id": "x1", "character": "Jane Roe", "portrait": str(outside)},
                              {"id": "x2", "character": "John Doe", "portrait": "../keep.txt", "foundry_portrait": "notes.png"}]})
    party.delete(camp, "x1")
    party.delete(camp, "x2")
    assert outside.read_text() == "mine" and (camp.root / "notes.png").exists()
