"""App settings and themes, stored as JSON in the data folder."""
import copy
import threading

from . import paths
from .util import read_json, safe_name, write_json

DEFAULT_THEME = {
    "name": "Soft Light",
    "base": "light",            # light | dark
    "accent": "periwinkle",
    "header": {
        "type": "pattern",      # pattern | image | none
        "pattern": "checker",   # see web/js/patterns.js
        "colors": ["#ECEAFF", "#FFFFFF"],
        "useAccent": True,      # derive pattern colors from the accent
        "scale": 28,
        "image": "",            # data URL when type == image
        "imageFit": "cover",    # cover | tile | contain
        "height": 132,
    },
}

BUILTIN_THEMES = [
    DEFAULT_THEME,
    {**copy.deepcopy(DEFAULT_THEME), "name": "Soft Dark", "base": "dark",
     "header": {**DEFAULT_THEME["header"], "pattern": "grid"}},
    {**copy.deepcopy(DEFAULT_THEME), "name": "Meadow", "accent": "mint",
     "header": {**DEFAULT_THEME["header"], "pattern": "sparkles"}},
    {**copy.deepcopy(DEFAULT_THEME), "name": "Peach Fuzz", "accent": "peach",
     "header": {**DEFAULT_THEME["header"], "pattern": "gingham"}},
    {**copy.deepcopy(DEFAULT_THEME), "name": "Cobalt Night", "base": "dark", "accent": "cobalt",
     "header": {**DEFAULT_THEME["header"], "pattern": "dots"}},
]

DEFAULTS = {
    "campaign_dir": "",            # the campaign folder that opens on start
    "recent_campaigns": [],        # [{"path", "name"}], newest first
    "notify_on_finish": True,
    "auto_link": True,             # link mentions of page names while reading
    "theme": DEFAULT_THEME,
    "onboarded": False,
    # Claude
    "anthropic_api_key": "",
    "recap_model": "claude-sonnet-5-5",
    "ai_provider": "claude",            # "claude" (Anthropic API) or "local" (any OpenAI-compatible server)
    "local_url": "http://localhost:11434/v1",
    "local_model": "",
    "local_api_key": "",
    "local_context": 32768,             # the model's context window, in tokens
    "auto_recap": False,           # draft a recap as soon as a transcript is ready
    # transcription
    "whisper_model": "large-v3-turbo",
    "whisper_device": "auto",      # auto | cuda | cpu
    "whisper_batch": 16,
    "whisper_language": "en",
    "hf_token": "",                # Hugging Face token, only for speaker detection
    "torch_index_url": "https://download.pytorch.org/whl/cu128",
    "auto_transcribe": True,       # start transcribing when OBS stops recording
    # OBS
    "obs_enabled": False,
    "obs_host": "127.0.0.1",
    "obs_port": 4455,
    "obs_password": "",
    "obs_gm_track": 2,             # OBS audio track with the GM's mic (1-6, 0 = none)
    "obs_players_track": 3,        # OBS audio track with Discord (the players)
    "diarize_players": True,       # tell players apart on their track (needs speaker detection)
}

SECRET_KEYS = ("anthropic_api_key", "local_api_key", "hf_token", "obs_password")

_lock = threading.Lock()


def _path():
    return paths.data_dir() / "settings.json"


def load():
    data = read_json(_path(), {}) or {}
    merged = copy.deepcopy(DEFAULTS)
    merged.update(data)
    theme = copy.deepcopy(DEFAULT_THEME)
    theme.update(merged.get("theme") or {})
    theme["header"] = {**DEFAULT_THEME["header"], **(theme.get("header") or {})}
    merged["theme"] = theme
    return merged


def save(patch):
    with _lock:
        cur = load()
        cur.update(patch or {})
        write_json(_path(), cur)
        return cur


def get(key):
    return load().get(key, DEFAULTS.get(key))


# ---- themes -------------------------------------------------------------

def list_themes():
    user = []
    for f in sorted(paths.themes_dir().glob("*.json")):
        t = read_json(f)
        if isinstance(t, dict) and t.get("name"):
            t["user"] = True
            user.append(t)
    return [dict(t, user=False) for t in BUILTIN_THEMES] + user


def save_theme(theme):
    theme = dict(theme)
    theme.pop("user", None)
    name = theme.get("name") or "My Theme"
    write_json(paths.themes_dir() / f"{safe_name(name)}.json", theme)
    return list_themes()


def delete_theme(name):
    f = paths.themes_dir() / f"{safe_name(name)}.json"
    if f.exists():
        f.unlink()
    return list_themes()
