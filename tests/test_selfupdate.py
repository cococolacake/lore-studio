"""Updating Lore Studio from inside the app: the version check, zip updates and git updates."""
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from studio import appupdate, selfupdate  # noqa: E402
from studio.util import Task  # noqa: E402


def _fake_install(app):
    (app / "studio").mkdir(parents=True)
    (app / "web" / "css").mkdir(parents=True)
    (app / ".venv").mkdir()
    (app / ".venv" / "keep.txt").write_text("my python")
    (app / "main.py").write_text("print('old')")
    (app / "web" / "css" / "custom.css").write_text("/* my own styles */")


def test_versions_compare_as_numbers():
    assert appupdate._ver("v0.10.0") > appupdate._ver("0.9.9") > appupdate._ver("v0.6.6")
    assert appupdate._ver("junk") == ()
    assert appupdate.REPO == "cococolacake/lore-studio"


def test_zip_update_keeps_venv_and_custom_css(tmp_path, monkeypatch):
    app = tmp_path / "app"; _fake_install(app)
    rel = tmp_path / "lore-studio-9.9.9"
    (rel / "studio").mkdir(parents=True); (rel / "web" / "css").mkdir(parents=True)
    (rel / "main.py").write_text("print('new')")
    (rel / "studio" / "__init__.py").write_text('__version__ = "9.9.9"')
    (rel / "web" / "css" / "custom.css").write_text("/* template */")
    z = tmp_path / "rel.zip"
    with zipfile.ZipFile(z, "w") as zf:
        for f in rel.rglob("*"):
            zf.write(f, f.relative_to(tmp_path).as_posix())
    monkeypatch.setattr(selfupdate, "ROOT", app)
    monkeypatch.setattr(selfupdate, "method", lambda: "zip")
    monkeypatch.setattr(selfupdate, "_download", lambda url, dest: Path(dest).write_bytes(z.read_bytes()))
    monkeypatch.setattr(selfupdate, "_requirements", lambda task: None)
    r = selfupdate.update(Task("u"), "v9.9.9")
    assert r["restart"] is True
    assert "9.9.9" in (app / "studio" / "__init__.py").read_text() and "new" in (app / "main.py").read_text()
    assert (app / "web" / "css" / "custom.css").read_text() == "/* my own styles */"
    assert (app / ".venv" / "keep.txt").exists()


def test_zip_update_refuses_a_wrong_or_unsafe_download(tmp_path, monkeypatch):
    app = tmp_path / "app"; _fake_install(app)
    monkeypatch.setattr(selfupdate, "ROOT", app)
    monkeypatch.setattr(selfupdate, "method", lambda: "zip")
    for name, files, msg in [("bad.zip", {"something/readme.txt": "not lore studio"}, "isn't a Lore Studio release"),
                             ("evil.zip", {"lore/../../escape.txt": "x"}, "looks wrong")]:
        z = tmp_path / name
        with zipfile.ZipFile(z, "w") as zf:
            for k, v in files.items():
                zf.writestr(k, v)
        monkeypatch.setattr(selfupdate, "_download", lambda url, dest, z=z: Path(dest).write_bytes(z.read_bytes()))
        with pytest.raises(RuntimeError, match=msg):
            selfupdate.update(Task("u"), "v9.9.9")
    assert "old" in (app / "main.py").read_text()
    assert not (tmp_path / "escape.txt").exists()


def test_git_update_pulls_and_respects_local_changes(tmp_path, monkeypatch):
    import shutil
    if not shutil.which("git"):
        pytest.skip("git not installed")
    run = lambda *a, cwd: subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True)
    origin = tmp_path / "origin"; origin.mkdir()
    run("init", "-q", "-b", "main", cwd=origin)
    run("config", "user.email", "t@t", cwd=origin); run("config", "user.name", "t", cwd=origin)
    (origin / "main.py").write_text("v1"); run("add", ".", cwd=origin); run("commit", "-qm", "v1", cwd=origin)
    app = tmp_path / "app"
    run("clone", "-q", str(origin), str(app), cwd=tmp_path)
    (origin / "main.py").write_text("v2"); run("commit", "-qam", "v2", cwd=origin)
    monkeypatch.setattr(selfupdate, "ROOT", app)
    monkeypatch.setattr(selfupdate, "_requirements", lambda task: None)
    assert selfupdate.method() == "git"
    assert selfupdate.update(Task("u"))["restart"] is True
    assert (app / "main.py").read_text() == "v2"
    (app / "main.py").write_text("my local edit")
    with pytest.raises(RuntimeError, match="changes of its own"):
        selfupdate.update(Task("u"))


def test_no_update_or_restart_while_something_runs(monkeypatch):
    from studio.api import Api
    a = Api.__new__(Api)
    monkeypatch.setattr(Task, "_all", {})          # only this test's job counts as running
    t = Task("Transcribing session 3")
    try:
        with pytest.raises(RuntimeError, match="Transcribing session 3 is still running"):
            a.app_self_update()
        with pytest.raises(RuntimeError, match="still running"):
            a.app_restart()
    finally:
        t.finish(True)


def test_update_checks_can_be_switched_off(monkeypatch):
    from studio import settings
    from studio.api import Api
    monkeypatch.setattr(settings, "get", lambda k: False if k == "check_app_updates" else None)
    assert Api.__new__(Api).app_update()["off"] is True


# ---- Update from: main ---------------------------------------------------------------------

def _main_commit(sha, date="2026-11-25T12:00:00Z", msg="Fix the thing\n\nMore words"):
    return {"sha": sha, "html_url": f"https://github.com/x/y/commit/{sha}",
            "commit": {"message": msg, "committer": {"date": date}}}


def test_main_check_finds_new_commits(tmp_path, monkeypatch):
    from studio import paths
    monkeypatch.setattr(paths, "cache_dir", lambda: tmp_path)
    monkeypatch.setattr(appupdate, "channel", lambda: "main")
    monkeypatch.setattr(appupdate, "installed_commit_file", lambda: tmp_path / "installed_commit.json")
    monkeypatch.setattr(appupdate, "_get", lambda url: _main_commit("b" * 40))
    # a git folder: the same commit is up to date; an older checkout isn't
    heads = {"rev-parse": "b" * 40, "log": "2026-11-24T12:00:00+00:00"}
    monkeypatch.setattr(appupdate, "_git", lambda *a: heads[a[0]])
    r = appupdate.check(force=True)
    assert r["channel"] == "main" and r["latest"]["tag"] == "main (bbbbbbb)" and r["latest"]["name"] == "Fix the thing"
    assert r["newer"] is False
    heads["rev-parse"] = "a" * 40
    assert appupdate.check(force=True)["newer"] is True
    heads["log"] = "2026-11-26T12:00:00+00:00"       # local commits newer than main: nothing to pull
    assert appupdate.check(force=True)["newer"] is False
    # a zip install: newer until it has been updated to that commit
    monkeypatch.setattr(appupdate, "_git", lambda *a: None)
    assert appupdate.check(force=True)["newer"] is True
    (tmp_path / "installed_commit.json").write_text('{"sha": "' + "b" * 40 + '"}')
    assert appupdate.check(force=True)["newer"] is False


def test_switching_channel_checks_again(tmp_path, monkeypatch):
    from studio import paths
    monkeypatch.setattr(paths, "cache_dir", lambda: tmp_path)
    monkeypatch.setattr(appupdate, "_get", lambda url: _main_commit("c" * 40) if "commits" in url else
                        [{"tag_name": "v9.9.9", "html_url": "u", "name": "9.9.9"}])
    monkeypatch.setattr(appupdate, "channel", lambda: "release")
    assert appupdate.check()["latest"]["tag"] == "v9.9.9"
    monkeypatch.setattr(appupdate, "channel", lambda: "main")
    assert appupdate.check()["latest"]["tag"] == "main (ccccccc)"   # not the cached release


def test_main_zip_update_downloads_that_commit_and_remembers_it(tmp_path, monkeypatch):
    app = tmp_path / "app"; _fake_install(app)
    src = tmp_path / ("REPO-" + "d" * 40)
    (src / "studio").mkdir(parents=True)
    (src / "main.py").write_text("print('main')")
    z = tmp_path / "main.zip"
    with zipfile.ZipFile(z, "w") as zf:
        for f in src.rglob("*"):
            zf.write(f, f.relative_to(tmp_path).as_posix())
    urls = []
    monkeypatch.setattr(selfupdate, "ROOT", app)
    monkeypatch.setattr(selfupdate, "method", lambda: "zip")
    monkeypatch.setattr(selfupdate, "_requirements", lambda task: None)
    monkeypatch.setattr(selfupdate, "_download", lambda url, dest: (urls.append(url), Path(dest).write_bytes(z.read_bytes())))
    monkeypatch.setattr(appupdate, "channel", lambda: "main")
    monkeypatch.setattr(appupdate, "installed_commit_file", lambda: tmp_path / "installed_commit.json")
    monkeypatch.setattr(appupdate, "_get", lambda url: _main_commit("d" * 40))
    assert selfupdate.update(Task("u"), "main (ddddddd)")["restart"] is True
    assert urls == [f"https://github.com/{appupdate.REPO}/archive/{'d' * 40}.zip"]
    assert "main" in (app / "main.py").read_text()
    assert ('"' + "d" * 40 + '"') in (tmp_path / "installed_commit.json").read_text()


def test_main_git_update_pulls_main_only_on_main(tmp_path, monkeypatch):
    import shutil
    if not shutil.which("git"):
        pytest.skip("git not installed")
    run = lambda *a, cwd: subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True)
    origin = tmp_path / "origin"; origin.mkdir()
    run("init", "-q", "-b", "main", cwd=origin)
    run("config", "user.email", "t@t", cwd=origin); run("config", "user.name", "t", cwd=origin)
    (origin / "main.py").write_text("v1"); run("add", ".", cwd=origin); run("commit", "-qm", "v1", cwd=origin)
    app = tmp_path / "app"
    run("clone", "-q", str(origin), str(app), cwd=tmp_path)
    (origin / "main.py").write_text("v2"); run("commit", "-qam", "v2", cwd=origin)
    monkeypatch.setattr(selfupdate, "ROOT", app)
    monkeypatch.setattr(selfupdate, "_requirements", lambda task: None)
    monkeypatch.setattr(appupdate, "channel", lambda: "main")
    assert selfupdate.update(Task("u"))["restart"] is True
    assert (app / "main.py").read_text() == "v2"
    run("switch", "-q", "-c", "my-branch", cwd=app)
    with pytest.raises(RuntimeError, match="not main"):
        selfupdate.update(Task("u"))
