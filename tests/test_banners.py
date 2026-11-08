"""Page header images."""
import base64
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def test_banner_set_move_remove_download(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import banners, campaign
    camp = campaign.create(tmp_path / "Camp", "Demo")
    camp.write_page("John Doe", {"title": "John Doe"}, "A human fighter.")
    img = tmp_path / "pic.png"
    img.write_bytes(PNG)
    p = banners.set_banner(camp, "John Doe", {"path": str(img)})
    rel = p["meta"]["banner"]
    assert rel.startswith("assets/banners/john-doe-") and (camp.root / rel).read_bytes() == PNG
    assert camp.file_for_url(rel)          # served at /c/<rel>
    assert p["body"].strip() == "A human fighter."
    p = banners.set_banner(camp, "John Doe", y=73.6)
    assert p["meta"]["banner_y"] == 74 and p["meta"]["banner"] == rel
    p = banners.set_banner(camp, "John Doe", {"data_url": "data:image/png;base64," + base64.b64encode(PNG + b"x").decode()})
    assert p["meta"]["banner"] != rel and not (camp.root / rel).exists() and "banner_y" not in p["meta"]
    p = banners.set_banner(camp, "John Doe", remove=True)
    assert "banner" not in p["meta"]

    # links (e.g. from LegendKeeper) are downloaded into the campaign
    camp.write_page("Westmarch", {"title": "Westmarch", "banner": "https://example.com/img/west.png?x=1"}, "A region.")

    class R(io.BytesIO):
        headers = {"Content-Type": "image/png"}
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
    assert banners.remote_count(camp) == 1
    out = banners.download_all(camp, log=lambda m: None, opener=lambda req, timeout=None: R(PNG))
    assert out == {"saved": 1, "failed": 0} and banners.remote_count(camp) == 0
    assert camp.read_page("Westmarch")["meta"]["banner"].endswith(".png")
    # a link that can't be fetched stays a link
    v = banners.store(camp, "X", {"url": "https://example.invalid/a.jpg"}, opener=lambda *a, **k: (_ for _ in ()).throw(OSError("offline")))
    assert v == "https://example.invalid/a.jpg"


def test_handouts_and_discord_upload(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import campaign, handouts
    camp = campaign.create(tmp_path / "C", "C")
    x = handouts.save(camp, {"title": "Wanted: John Doe", "text": "Reward: **50 gold**"}, {"data_url": "data:image/png;base64," + base64.b64encode(PNG).decode()})
    assert x["image"].endswith(".png") and x["image_url"] == f"/c/handouts/{x['image']}" and camp.file_for_url(f"handouts/{x['image']}")
    assert handouts.data_url(camp, x).startswith("data:image/png;base64,")
    sent = {}

    class R(io.BytesIO):
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False

    def opener(req, timeout=None):
        sent["ctype"], sent["body"] = req.headers["Content-type"], req.data
        return R(b'{"id": "123"}')
    data, name = handouts.image_bytes(camp, x)
    msg = handouts.discord_message(camp, x, x["text"], {"username": "The Chronicler"})
    assert handouts.post_discord("https://discord.com/api/webhooks/1/abc", msg, data, name, opener=opener) == "123"
    assert sent["ctype"].startswith("multipart/form-data") and PNG in sent["body"] and b"attachment://" in sent["body"] and b"**50 gold**" in sent["body"]
    x = handouts.mark(camp, x["id"], "discord:#handouts", revealed=True)
    assert x["revealed"] and x["shown"][0]["to"] == "discord:#handouts"
    x2 = handouts.save(camp, {**x, "remove_image": True})
    assert x2["image"] == "" and x2["revealed"]
    handouts.delete(camp, x["id"])
    assert handouts.all_handouts(camp) == []


def test_player_site_has_no_gm_content(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    import json as _json
    from studio import api as api_mod, clocks, handouts, playersite
    a = api_mod.Api()
    a.create_demo(str(tmp_path))
    camp = a._campaign
    camp.write_page("Characters/The Collector", {"title": "The Collector", "visibility": "gm"}, "Works for the guild. Secret.")
    camp.write_page("Characters/Old Tobin", {"title": "Old Tobin", "tags": ["npc"]}, "Innkeeper. Knows [[The Collector]] by sight.")
    clocks.save(camp, {"name": "Secret plot", "gm": True})
    clocks.save(camp, {"name": "The bridge is rebuilt", "gm": False, "segments": 4})
    handouts.save(camp, {"title": "Wanted poster", "revealed": True, "text": "50 gold"})
    handouts.save(camp, {"title": "Unrevealed letter", "revealed": False})
    r = playersite.build(camp, log=lambda m: None)
    out = Path(r["path"])
    assert out == camp.root / "player-site" and (out / "index.html").exists() and (out / "site.js").exists()
    text = (out / "data.js").read_text()
    data = _json.loads(text[len("window.LORE = "):-2])
    for secret in ["The guild's collector is already", "threw it back into the sea", "want to come back", "Whoever wears it hears",
                   "Secret plot", "Unrevealed letter", "Works for the guild", "Smugglers' cove"]:
        assert secret not in text, secret
    assert "Characters/The Collector" not in data["pages"] and "The Collector" not in [n for n, _ in data["names"]]
    assert data["pages"]["Characters/John Doe"]["body"].startswith("A human fighter")
    names = [c["name"] for c in data["clocks"]]
    assert "The bridge is rebuilt" in names and "The Thieves' Guild takes the docks" not in names
    titles = [h["title"] for h in data["handouts"]]
    assert "Wanted poster" in titles and "A letter in grey ink" not in titles
    assert "Mira finds the crown" not in text and "The guild buys the docks" not in text and "The guild collector arrives" not in text
    assert data["maps"][0]["image"].startswith("files/maps/") and (out / data["maps"][0]["image"]).exists()
    assert len(data["maps"][0]["pins"]) == 4
    # only player recaps unless asked
    assert [x["number"] for x in data["recaps"]] == [2]
    assert any(b["title"] == "Millbrook founded" for b in data["timeline"])
    r = playersite.build(camp, opts={"gm_recaps": True}, log=lambda m: None)
    data = _json.loads((out / "data.js").read_text()[len("window.LORE = "):-2])
    assert [x["number"] for x in data["recaps"]] == [1, 2]
    # refuses to fill a folder that has other things in it
    other = tmp_path / "Documents"
    other.mkdir()
    (other / "taxes.pdf").write_text("x")
    import pytest
    with pytest.raises(ValueError):
        playersite.build(camp, out_dir=other, log=lambda m: None)
    assert "export function" not in (out / "site.js").read_text()


def test_boards(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import boards, campaign
    camp = campaign.create(tmp_path / "C", "C")
    b = boards.create(camp, "The guild's plan", page="Organizations/Guild")
    src = boards.add_image(camp, {"data_url": "data:image/png;base64," + base64.b64encode(PNG).decode()})
    assert src.startswith("boards/img/") and camp.file_for_url(src)
    b["items"] = [{"id": "a", "type": "image", "x": 0, "y": 0, "w": 300, "h": 220, "src": src},
                  {"id": "b", "type": "note", "x": 400, "y": 10, "w": 10, "h": 160, "text": "Who pays the collector?", "rot": 99},
                  {"id": "c", "type": "link", "x": 0, "y": 300, "url": "javascript:alert(1)"},
                  {"id": "d", "type": "script", "x": 0, "y": 0}]
    b["links"] = [{"from": "a", "to": "b"}, {"from": "a", "to": "zzz"}, {"from": "b", "to": "b"}]
    b = boards.save(camp, b)
    assert [i["type"] for i in b["items"]] == ["image", "note", "link"]
    assert b["items"][1]["w"] == 40 and b["items"][1]["rot"] == 20 and b["items"][2]["url"] == ""
    assert b["links"] == [{"from": "a", "to": "b", "color": "#E5626A", "label": ""}]
    lst = boards.list_boards(camp)
    assert lst[0]["cover"] == src and lst[0]["items"] == 3 and boards.for_page(camp, "Organizations/Guild")[0]["id"] == b["id"]
    boards.delete(camp, b["id"])
    assert boards.list_boards(camp) == []
