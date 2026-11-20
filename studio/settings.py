"""App settings and themes, stored as JSON in the data folder."""
import copy
import threading

from . import paths
from .util import read_json, safe_name, write_json

_HEADER = {"type": "none"}   # page headers are plain title bars (patterned headers were removed)

DEFAULT_THEME = {
    "name": "Default",
    "style": "glass",
    "family": "default",        # glass colours: default | cool | warm | lilac
    "base": "light",            # light | dark
    "glass": "efficient",       # efficient (see-through, no live blur) | full (live blur) | off
    "font": "geist",            # geist | system
    "header": dict(_HEADER),
}

BUILTIN_THEMES = [
    DEFAULT_THEME,
    {**copy.deepcopy(DEFAULT_THEME), "name": "Cool Glass", "family": "cool"},
    {**copy.deepcopy(DEFAULT_THEME), "name": "Warm Glass", "family": "warm"},
    {**copy.deepcopy(DEFAULT_THEME), "name": "Lilac", "family": "lilac"},
]


def _to_glass(theme):
    """Themes from before the glass look (the classic pastel ones) become the glass Default,
    keeping light or dark mode, so an older setup never lands on a theme that no longer exists."""
    if (theme or {}).get("style") == "glass":
        return theme
    return {**copy.deepcopy(DEFAULT_THEME), "base": (theme or {}).get("base", "light"),
            **({"name": theme["name"]} if theme and theme.get("name") and theme.get("user") else {})}


DEFAULTS = {
    "campaign_dir": "",            # the campaign folder that opens on start
    "recent_campaigns": [],        # [{"path", "name"}], newest first
    "notify_on_finish": True,
    "auto_link": True,             # link mentions of page names while reading
    "theme": DEFAULT_THEME,
    "onboarded": False,
    # Claude
    "watch_files": True,                # notice campaign .md files changed by other apps and offer to refresh
    "ai_off": False,                    # hide every AI feature (chat, drafting, tag suggestions, thread checks)
    "anthropic_api_key": "",
    "recap_model": "claude-sonnet-5-5",
    "ai_provider": "claude",            # "claude" (Anthropic API) or "local" (any OpenAI-compatible server)
    "local_url": "http://localhost:11434/v1",
    "local_model": "",
    "local_api_key": "",
    "local_context": 32768,             # the model's context window, in tokens
    "checklist_on": False,         # a before-session checklist on the Plan tab, Home and when going live
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
    saved = data.get("theme") or {}
    theme = copy.deepcopy(DEFAULT_THEME)
    if saved:
        theme.update(_to_glass(saved))
    theme["header"] = dict(_HEADER)   # patterned headers were removed
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
    user = [dict(_to_glass(t), name=t.get("name", "My theme"), user=True) for t in user]
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
