"""Export everything, then restore it somewhere else."""
import json
import zipfile


def test_export_and_restore_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    from studio import api as api_mod, backup, campaign, monsters, settings
    a = api_mod.Api()
    a.create_demo(str(tmp_path / "camps"))
    camp = a._camp()
    settings.save({"anthropic_api_key": "sk-ant-secret-1234567", "recap_model": "claude-opus-5-5", "foundry_token": "tok123"})
    camp.save_info({"discord": {"webhooks": [{"name": "#recaps", "url": "https://discord.com/api/webhooks/1/abc"}]}})
    monsters.save(camp, monsters.srd_get("goblin"))
    # a recording outside the campaign folder, and the player site (which isn't packed)
    vid = tmp_path / "obs" / "session.mkv"
    vid.parent.mkdir()
    vid.write_bytes(b"\x1aE\xdf\xa3" + b"0" * 1000)
    sid = camp.sessions()[0]["id"]
    from studio.util import write_json, read_json
    write_json(camp.session_dir(sid) / "recording.json", {"path": str(vid), "streams": [], "tracks": []})
    (camp.root / "player-site").mkdir(exist_ok=True)
    (camp.root / "player-site" / "index.html").write_text("site")

    out = backup.export(camp, tmp_path / "backups", include_media=True, log=lambda *x: None)
    with zipfile.ZipFile(out) as z:
        names = z.namelist()
        assert "campaign/campaign.json" in names and "manifest.json" in names and "README.txt" in names
        assert any(n.startswith("campaign/lore/") for n in names) and any(n.startswith("campaign/monsters/") for n in names)
        assert not any(n.startswith("campaign/player-site/") for n in names)
        assert f"recordings/{sid}/session.mkv" in names
        st = json.loads(z.read("app/settings.json"))
        assert st["anthropic_api_key"] == "" and st["recap_model"] == "claude-opus-5-5" and "foundry_token" not in st
        info = json.loads(z.read("campaign/campaign.json"))
        assert info["discord"]["webhooks"][0]["url"] == ""
        assert "sk-ant-secret" not in z.read("app/settings.json").decode()
    m = backup.inspect(out)
    assert m["campaign"] == camp.name and m["counts"]["monsters"] == 1 and m["includes"]["recordings"]

    # can't save inside the campaign itself
    import pytest
    with pytest.raises(ValueError):
        backup.export(camp, camp.root / "x", log=lambda *x: None)

    # restore on a "new computer": keys already entered there stay
    settings.save({"anthropic_api_key": "sk-ant-here-already-99", "recap_model": "claude-haiku-5-5"})
    target = backup.restore(out, tmp_path / "restored", restore_settings=True, log=lambda *x: None)
    c2 = campaign.Campaign(target)
    assert c2.name == camp.name and len(c2.sessions()) == len(camp.sessions())
    assert monsters.list_monsters(c2)[0]["name"] == "Goblin"
    rec = read_json(c2.session_dir(sid) / "recording.json", {})
    assert rec["path"] != str(vid) and open(rec["path"], "rb").read(4) == b"\x1aE\xdf\xa3"
    s = settings.load()
    assert s["anthropic_api_key"] == "sk-ant-here-already-99" and s["recap_model"] == "claude-opus-5-5"
    # restoring again never overwrites
    again = backup.restore(out, tmp_path / "restored", log=lambda *x: None)
    assert again != target and "(restored 2)" in again


def test_not_a_backup(tmp_path):
    from studio import backup
    import pytest
    z = tmp_path / "other.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("hello.txt", "hi")
    with pytest.raises(ValueError):
        backup.inspect(z)
