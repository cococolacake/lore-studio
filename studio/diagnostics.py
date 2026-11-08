"""Settings → About → Copy diagnostics: a plain-text report for bug reports.

It says what the app is running on and how it's set up, never what's in a campaign:
no API keys, tokens, webhooks or passwords, no page text, and the home folder is shortened to ~.
"""
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

from . import __version__, foundry, paths, settings, transcription
from .util import Task

_SECRET_PATTERNS = [
    re.compile(r"sk-ant-[A-Za-z0-9_\-]+"),
    re.compile(r"hf_[A-Za-z0-9]{10,}"),
    re.compile(r"https?://(?:\w+\.)?discord(?:app)?\.com/api/webhooks/\S+", re.I),
    re.compile(r"(?i)(api[_-]?key|token|password|authorization|bearer)\s*[:=]\s*\S+"),
]


def redact(text, secrets=()):
    """Remove secret values, known secret shapes and the user's home folder from text."""
    for s in secrets:
        if s and len(s) >= 6:
            text = text.replace(s, "[hidden]")
    for p in _SECRET_PATTERNS:
        text = p.sub("[hidden]", text)
    home = str(Path.home())
    if len(home) > 3:
        text = text.replace(home, "~")
    return text


def _gpu():
    if not shutil.which("nvidia-smi"):
        return "no NVIDIA GPU found"
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
                             capture_output=True, text=True, timeout=5).stdout.strip()
        return out.replace("\n", "; ") or "nvidia-smi gave no answer"
    except Exception as e:  # noqa: BLE001
        return f"nvidia-smi failed ({type(e).__name__})"


def _host(url):
    m = re.match(r"\w+://([^/:]+)", url or "")
    if not m:
        return "not set"
    h = m.group(1)
    return "this computer" if h in ("localhost", "127.0.0.1", "::1", "0.0.0.0") else "another computer"


def report(campaign=None, native=None):
    s = settings.load()
    secrets = [s.get(k) or "" for k in settings.SECRET_KEYS]
    lines = ["Lore Studio diagnostics", ""]

    def add(label, fn):
        try:
            val = fn()
        except Exception as e:  # noqa: BLE001 - a broken section shouldn't stop the report
            val = f"(couldn't check: {type(e).__name__})"
        lines.append(f"{label}: {val}")

    add("Version", lambda: __version__)
    add("Python", lambda: f"{platform.python_version()} ({sys.executable.split(os.sep)[-1]})")
    add("System", lambda: platform.platform())
    add("Window", lambda: "app window" if native else ("web browser" if native is False else "unknown"))
    add("pywebview", lambda: "installed" if _has("webview") else "not installed")
    add("ffmpeg", lambda: "found" if shutil.which("ffmpeg") else "not found")
    add("GPU", _gpu)
    lines.append("")

    def ai():
        if s.get("ai_off"):
            return "switched off"
        if s.get("ai_provider") == "local":
            return (f"local model {s.get('local_model') or '(none chosen)'} on {_host(s.get('local_url'))}, "
                    f"context {s.get('local_context')}, address {'set' if s.get('local_url') else 'not set'}")
        return f"Claude {s.get('recap_model')}, API key {'set' if s.get('anthropic_api_key') else 'not set'}"
    add("AI", ai)
    add("Auto recap", lambda: "on" if s.get("auto_recap") and not s.get("ai_off") else "off")

    def tr():
        st = transcription.status()
        if not st["installed"]:
            return "not installed"
        return (f"installed, model {s.get('whisper_model')}, device {s.get('whisper_device')}, "
                f"speaker detection {'on' if st['diarization'] else 'off'}")
    add("Transcription", tr)
    add("OBS", lambda: "on" if s.get("obs_enabled") else "off")

    def fd():
        st = foundry.status()
        return f"module {foundry.module_version()}, {'connected' if st.get('connected') else 'not connected'}"
    add("Foundry", fd)
    add("Theme", lambda: f"{(s.get('theme') or {}).get('base', '?')} / {(s.get('theme') or {}).get('accent', '?')}")
    add("App data", lambda: redact(str(paths.data_dir())))

    def camp():
        if not campaign:
            return "none open"
        st = campaign.stats()
        return ", ".join(f"{v} {k.replace('_', ' ')}" for k, v in st.items())
    add("Campaign", camp)

    failed = sorted((t for t in list(Task._all.values()) if t.status == "failed"), key=lambda t: t.finished_at, reverse=True)[:3]
    if failed:
        lines += ["", "Recent failed jobs (check these before posting: they can mention session or page names)"]
        for t in failed:
            lines.append(f"--- {t.title}")
            lines += [f"    {ln}" for ln in t.lines[-20:]]
    return redact("\n".join(lines), secrets)


def _has(mod):
    import importlib.util
    return importlib.util.find_spec(mod) is not None
