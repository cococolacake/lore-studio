"""Where Lore Studio keeps its own files (settings, themes, caches).

Your campaign itself lives in a campaign folder you choose; this is only app data.

Windows: %APPDATA%\\Lore Studio
Linux:   ~/.local/share/lore-studio  (or $XDG_DATA_HOME/lore-studio)
Override with the LORE_STUDIO_HOME environment variable (handy for testing).
"""
import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = APP_DIR / "web"


def data_dir() -> Path:
    override = os.environ.get("LORE_STUDIO_HOME")
    if override:
        base = Path(override)
    elif os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home())) / "Lore Studio"
    else:
        xdg = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
        base = Path(xdg) / "lore-studio"
    base.mkdir(parents=True, exist_ok=True)
    return base


def sub(name: str) -> Path:
    p = data_dir() / name
    p.mkdir(parents=True, exist_ok=True)
    return p


def themes_dir() -> Path:
    return sub("themes")


def cache_dir() -> Path:
    return sub("cache")
