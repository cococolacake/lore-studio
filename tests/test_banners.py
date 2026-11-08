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
