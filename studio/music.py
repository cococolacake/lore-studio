"""Music downloader: turn YouTube links (or anything else yt-dlp can read) into mp3s in a folder Foundry can play from.

Uses two free command-line tools, not Python packages Lore Studio needs:
  yt-dlp   downloads the audio. Found on PATH, as the yt_dlp Python module, or installed with pip from Settings.
  ffmpeg   turns it into an mp3. Found on PATH or in winget's folders (so it works right after a winget install,
           before Windows has given Lore Studio the new PATH).
"""
import glob
import importlib.util
import os
import re
import shutil
import sys
from pathlib import Path

from . import foundry, settings

_PROGRESS = re.compile(r"^\[download\]\s+(\d+(?:\.\d+)?)%")
_DEST = re.compile(r"^\[ExtractAudio\] Destination: (.+)$")
_ALREADY = re.compile(r"^\[ExtractAudio\] Not converting audio (.+?);")


def _winget_dirs():
    local = os.environ.get("LOCALAPPDATA")
    if os.name != "nt" or not local:
        return []
    root = Path(local) / "Microsoft" / "WinGet"
    dirs = [root / "Links"]
    dirs += [Path(p) for p in glob.glob(str(root / "Packages" / "Gyan.FFmpeg*" / "*" / "bin"))]
    dirs += [Path(p) for p in glob.glob(str(root / "Packages" / "yt-dlp.yt-dlp*"))]
    return [d for d in dirs if d.is_dir()]


def _which(name):
    found = shutil.which(name)
    if found:
        return found
    exe = name + (".exe" if os.name == "nt" else "")
    for d in _winget_dirs():
        if (d / exe).is_file():
            return str(d / exe)
    return None


def ytdlp_cmd():
    """The command that runs yt-dlp, or None if it isn't installed."""
    exe = _which("yt-dlp")
    if exe:
        return [exe]
    if importlib.util.find_spec("yt_dlp"):
        return [sys.executable, "-m", "yt_dlp"]
    return None


def ffmpeg_path():
    return _which("ffmpeg")


def default_folder():
    data = foundry.default_data_dirs()
    if data:
        return str(Path(data[0]) / "assets" / "Music")
    return str(Path.home() / "Music" / "Lore Studio")


def folder():
    return settings.get("music_dir") or default_folder()


def info():
    cmd = ytdlp_cmd()
    return {"ytdlp": bool(cmd), "ffmpeg": bool(ffmpeg_path()), "folder": folder(), "default_folder": default_folder(),
            "platform": "windows" if os.name == "nt" else "linux"}


def clean_links(text):
    """Pull web links out of whatever was pasted: one per line, or separated by spaces."""
    links = []
    for word in re.split(r"\s+", str(text or "")):
        word = word.strip().strip('"\'<>')
        if re.match(r"^https?://\S+$", word, re.I) and word not in links:
            links.append(word)
    return links


def _args(out_dir, ffmpeg, playlist):
    a = ["-x", "--audio-format", "mp3", "--audio-quality", "0", "--embed-metadata", "--newline",
         "--no-playlist" if not playlist else "--yes-playlist",
         # a playlist goes in a folder named after it (a single video's empty name just adds a harmless extra slash)
         "-o", str(Path(out_dir) / "%(playlist_title|)s" / "%(title)s.%(ext)s") if playlist
         else str(Path(out_dir) / "%(title)s.%(ext)s")]
    if ffmpeg and not shutil.which("ffmpeg"):
        a += ["--ffmpeg-location", ffmpeg]
    return a


def download(task, links, out_dir=None, playlist=False):
    """Download each link as an mp3 into out_dir. Runs in a Task; returns {"files", "failed", "folder"}."""
    links = clean_links("\n".join(links) if isinstance(links, (list, tuple)) else links)
    if not links:
        raise ValueError("Paste at least one link (starting with https://).")
    cmd = ytdlp_cmd()
    if not cmd:
        raise RuntimeError("yt-dlp isn't installed. Install it from Settings → Foundry → Music.")
    ff = ffmpeg_path()
    if not ff:
        raise RuntimeError("ffmpeg isn't installed, and yt-dlp needs it to make mp3s. See Settings → Foundry → Music.")
    out = Path(out_dir or folder()).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    files, failed = [], []
    for i, link in enumerate(links, 1):
        task.progress = {"n": i - 1, "total": len(links), "msg": f"Link {i} of {len(links)}"}
        got = []

        def on_line(line, i=i):
            m = _PROGRESS.match(line)
            if m:
                task.progress = {"n": i - 1, "total": len(links), "msg": f"Link {i} of {len(links)}: {float(m.group(1)):.0f}%"}
                return True              # keep progress spam out of the log
            m = _DEST.match(line) or _ALREADY.match(line)
            if m:
                got.append(m.group(1).strip())
            return False

        # "--" so a link can never be read as an option
        code = task.stream(cmd + _args(out, ff, playlist) + ["--", link], on_line=on_line)
        if task.status != "running":     # cancelled
            return {"files": files, "failed": failed, "folder": str(out)}
        if code == 0:
            files += [Path(f).name for f in got]
        else:
            failed.append(link)
            task.log(f"That one didn't work: {link}")
    task.progress = {"n": len(links), "total": len(links), "msg": "Done"}
    if failed and not files:
        raise RuntimeError("None of the links worked. Check them and try again.")
    task.log(f"Saved {len(files)} file{'s' if len(files) != 1 else ''} to {out}")
    return {"files": files, "failed": failed, "folder": str(out)}


def install_ytdlp(task):
    """pip install yt-dlp into the Python that runs Lore Studio (its .venv when set up with Install.bat)."""
    code = task.stream([sys.executable, "-m", "pip", "install", "--upgrade", "yt-dlp"])
    if code != 0:
        raise RuntimeError("Installing yt-dlp failed. See the log above.")
    importlib.invalidate_caches()
    return {"ytdlp": bool(ytdlp_cmd())}

