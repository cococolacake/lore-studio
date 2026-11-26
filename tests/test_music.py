"""Music downloader: link parsing, and downloading with a fake yt-dlp and ffmpeg (no internet needed)."""
import os
import stat
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

FAKE_YTDLP = r'''#!{python}
import sys, pathlib
args = sys.argv[1:]
link = args[args.index("--") + 1]
out = args[args.index("-o") + 1]
pathlib.Path(sys.argv[0]).with_name("calls.txt").open("a").write(" ".join(args) + "\n")
if "bad" in link:
    print("ERROR: [youtube] bad: Video unavailable")
    sys.exit(1)
title = link.rsplit("=", 1)[-1]
dest = pathlib.Path(out.replace("%(title)s", title).replace("%(ext)s", "mp3").replace("%(playlist_title|)s", ""))
dest.parent.mkdir(parents=True, exist_ok=True)
for p in (10, 55.5, 100):
    print(f"[download]  {{p}}% of 3.00MiB at 1.00MiB/s ETA 00:01")
dest.write_bytes(b"ID3")
print(f"[ExtractAudio] Destination: {{dest}}")
'''


@pytest.fixture
def tools(tmp_path, monkeypatch):
    if os.name == "nt":
        pytest.skip("the fake tools are shell scripts")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    y = bin_dir / "yt-dlp"
    y.write_text(FAKE_YTDLP.format(python=sys.executable))
    f = bin_dir / "ffmpeg"
    f.write_text("#!/bin/sh\nexit 0\n")
    for p in (y, f):
        p.chmod(p.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}")
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    return bin_dir


def _wait(task):
    for _ in range(200):
        if task.status != "running":
            return task
        time.sleep(0.05)
    raise AssertionError("the task didn't finish")


def test_clean_links():
    from studio import music
    text = 'https://youtu.be/a\n  "https://www.youtube.com/watch?v=b"  not-a-link --exec=rm\nhttps://youtu.be/a\nftp://x'
    assert music.clean_links(text) == ["https://youtu.be/a", "https://www.youtube.com/watch?v=b"]
    assert music.clean_links("") == []


def test_download(tools, tmp_path):
    from studio import api as api_mod, music, settings
    from studio.util import Task
    out = tmp_path / "Foundry" / "Data" / "assets" / "Music"
    a = api_mod.Api()
    info = a.music_set_folder(str(out))
    assert info["ytdlp"] and info["ffmpeg"] and info["folder"] == str(out)
    assert settings.get("music_dir") == str(out)

    tid = a.music_download("https://www.youtube.com/watch?v=Tavern\nhttps://www.youtube.com/watch?v=bad")
    t = _wait(Task.get(tid))
    assert t.status == "done", t.lines
    assert t.result["files"] == ["Tavern.mp3"]
    assert t.result["failed"] == ["https://www.youtube.com/watch?v=bad"]
    assert (out / "Tavern.mp3").is_file()
    assert not any("[download]" in line for line in t.lines)      # progress goes to the progress line, not the log
    calls = (tools / "calls.txt").read_text().splitlines()
    assert len(calls) == 2
    assert all(c.split()[-2] == "--" and "--no-playlist" in c and "mp3" in c for c in calls)

    with pytest.raises(ValueError):
        a.music_download("no links here")

    t = _wait(Task.spawn("x", music.download, ["https://youtu.be/bad"], str(out)))
    assert t.status == "failed"


def test_missing_tools(tmp_path, monkeypatch):
    from studio import music
    from studio.util import Task
    monkeypatch.setenv("LORE_STUDIO_HOME", str(tmp_path / "home"))
    monkeypatch.setattr(music, "ytdlp_cmd", lambda: None)
    t = _wait(Task.spawn("x", music.download, ["https://youtu.be/a"], str(tmp_path)))
    assert t.status == "failed" and "yt-dlp isn't installed" in t.lines[-1]
