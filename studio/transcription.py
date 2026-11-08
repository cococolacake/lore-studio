"""The transcription environment (its own venv, so CUDA and friends never touch the app) and its job queue.

    <app data>/transcribe-env/       python venv with faster-whisper, PyAV, CUDA libraries from pip
                                     + torch and pyannote.audio when speaker detection is installed
"""
import json
import os
import re
import shutil
import sys
import threading
import time
from pathlib import Path

from . import notify, paths, settings
from .util import Task, child_env, read_json, run, write_json

WORKER = Path(__file__).resolve().parent / "workers" / "transcribe.py"


def env_dir():
    return paths.data_dir() / "transcribe-env"


def env_python():
    d = env_dir()
    p = d / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    return p if p.exists() else None


def status():
    d = env_dir()
    marks = read_json(d / "lore-studio.json", {}) or {}
    return {"installed": bool(env_python() and marks.get("whisper")), "diarization": bool(marks.get("diarization")),
            "gpu": bool(shutil.which("nvidia-smi")), "path": str(d), "installed_at": marks.get("when", "")}


def _nvidia_lib_dirs():
    d = env_dir()
    pats = ["Lib/site-packages/nvidia/*/bin"] if os.name == "nt" else ["lib/python*/site-packages/nvidia/*/lib"]
    out = []
    for p in pats:
        out += [str(x) for x in d.glob(p)]
    return out


def worker_env():
    env = child_env()
    libs = _nvidia_lib_dirs()
    if libs:
        key = "PATH" if os.name == "nt" else "LD_LIBRARY_PATH"
        env[key] = os.pathsep.join(libs + ([env[key]] if env.get(key) else []))
    env["HF_HUB_DISABLE_TELEMETRY"] = "1"
    return env


def install(task, diarization=False):
    """Create or update the environment. Runs in a Task (its log shows in the app)."""
    d = env_dir()
    marks = read_json(d / "lore-studio.json", {}) or {}
    if not env_python():
        task.log("Creating the transcription environment…")
        base = sys.executable
        if base.lower().endswith("pythonw.exe"):      # the app window runs without a console on Windows
            base = base[:-len("pythonw.exe")] + "python.exe"
        if task.stream([base, "-m", "venv", str(d)]) != 0:
            raise RuntimeError("Couldn't create the environment (on Debian/Ubuntu: sudo apt install python3-venv).")
    py = str(env_python())
    pip = [py, "-m", "pip", "install", "--upgrade"]
    task.stream([py, "-m", "pip", "install", "--upgrade", "pip"])
    task.log("Installing faster-whisper…")
    if task.stream(pip + ["faster-whisper>=1.1", "av", "numpy"]) != 0:
        raise RuntimeError("Installing faster-whisper failed. Check your internet connection and try again.")
    if shutil.which("nvidia-smi"):
        task.log("NVIDIA GPU found: installing CUDA libraries for it…")
        if task.stream(pip + ["nvidia-cublas-cu12", "nvidia-cudnn-cu12==9.*"]) != 0:
            task.log("The CUDA libraries didn't install, so transcription will run on the CPU (slower).")
    else:
        task.log("No NVIDIA GPU found, so transcription will run on the CPU (much slower).")
    marks.update({"whisper": True, "when": time.strftime("%Y-%m-%d %H:%M")})
    if diarization:
        task.log("Installing speaker detection (PyTorch + pyannote). This is the big download…")
        index = settings.get("torch_index_url") or "https://download.pytorch.org/whl/cu128"
        torch_cmd = pip + ["torch", "torchaudio"] + (["--index-url", index] if shutil.which("nvidia-smi") else [])
        if task.stream(torch_cmd) != 0 or task.stream(pip + ["pyannote.audio>=3.3"]) != 0:
            raise RuntimeError("Installing speaker detection failed. Transcription itself still works.")
        marks["diarization"] = True
    write_json(d / "lore-studio.json", marks)
    task.log("All set.")
    return status()


def probe(recording):
    py = env_python()
    if not py:
        raise RuntimeError("Install transcription first (Settings → Transcription).")
    code, out = run([str(py), str(WORKER), "probe", str(recording)], timeout=60, env=worker_env())
    line = next((ln for ln in reversed(out.strip().splitlines()) if ln.startswith("{")), "")
    if code != 0 or not line:
        err = re.findall(r'@@(\{.*\})', out)
        msg = json.loads(err[-1]).get("text") if err else out.strip()[-300:]
        raise RuntimeError(f"Couldn't read that recording: {msg}")
    return json.loads(line)


def glossary(camp, limit_words=110):
    """Names Whisper should expect, most important first: the party, characters, places, groups, the rest."""
    pages = camp.pages()
    rank = {"character": 1, "npc": 1, "pc": 0, "location": 2, "organization": 3, "faction": 3, "plane": 4}
    party = [p.get("character") for p in camp.info.get("party") or [] if p.get("character")]
    remembered = list(dict.fromkeys(camp.spellings().values()))
    ordered = party + remembered + [p["title"] for p in sorted(pages, key=lambda p: min([rank.get(t, 5) for t in p["tags"]] or [5]))]
    seen, words = set(), []
    for name in ordered:
        for w in re.findall(r"[A-Za-zÀ-ÿ’'\-]+", name or ""):
            lw = w.lower()
            if len(w) < 4 or lw in seen or lw in COMMON:
                continue
            seen.add(lw)
            words.append(w)
    return " ".join(words[:limit_words])


# Words from page titles that are too ordinary to be worth a Whisper hint.
COMMON = set("""the and of in on at to for with from into over under city town village rest gate hollow guild company
landing log map maps history society religion economy trade planes plane existence outer inner material hells feywild
shadowfell underdark rules homebrew sources characters character people places locations party end war era group groups
organizations factions court notes session sessions world calendar timeline index overview misc other""".split())


class Queue:
    """Transcriptions run one at a time (they use the whole GPU); this keeps the line."""

    def __init__(self):
        self._lock = threading.Lock()
        self._items = []          # [(task, camp, sid)]
        self._current = None
        self._proc = None

    def add(self, camp, sid):
        rec = camp.read_recording(sid)
        if not rec.get("path"):
            raise RuntimeError("Attach the session's recording first.")
        if not env_python():
            raise RuntimeError("Install transcription first (Settings → Transcription).")
        with self._lock:
            if any(s == sid for _, _, s in self._items) or (self._current and self._current[2] == sid):
                raise RuntimeError("This session is already waiting to be transcribed.")
            task = Task(f"Transcribing session {camp.session_number(sid)}")
            task.status = "queued"
            task.kind = "transcribe"
            task.session = sid
            self._items.append((task, camp, sid))
            if not self._current:
                threading.Thread(target=self._loop, daemon=True).start()
        return task.id

    def snapshot(self):
        with self._lock:
            items = ([self._current] if self._current else []) + self._items
            return [{"id": t.id, "session": s, "title": t.title, "status": t.status, "progress": t.progress} for t, _, s in items]

    def cancel(self, tid):
        with self._lock:
            for item in self._items:
                if item[0].id == tid:
                    self._items.remove(item)
                    item[0].log("Removed from the queue.")
                    item[0].finish(False)
                    return True
            if self._current and self._current[0].id == tid:
                self._current[0].cancel()
                return True
        return False

    def _loop(self):
        while True:
            with self._lock:
                if not self._items:
                    self._current = None
                    return
                self._current = self._items.pop(0)
            task, camp, sid = self._current
            task.status = "running"
            try:
                self._run(task, camp, sid)
            except Exception as e:  # shown in the job log and as a toast
                task.log(f"Error: {e}")
                if task.status == "running":
                    task.finish(False)
                notify.toast("Transcription failed", str(e)[:120])

    def _run(self, task, camp, sid):
        rec = camp.read_recording(sid)
        s = settings.load()
        d = camp.session_dir(sid)
        job = {
            "input": rec["path"], "out_dir": str(d), "tracks": rec.get("tracks") or [],
            "model": s.get("whisper_model") or "large-v3-turbo", "device": s.get("whisper_device") or "auto",
            "compute_type": "auto", "batch_size": int(s.get("whisper_batch") or 16),
            "language": s.get("whisper_language") or "en", "hotwords": glossary(camp),
            "hf_token": s.get("hf_token") or "", "diarize_mix": bool(rec.get("diarize_mix")),
        }
        job_file = d / ".transcribe-job.json"
        write_json(job_file, job)
        t0 = time.time()
        failed = []

        def on_line(line):
            if not line.startswith("@@"):
                return False
            try:
                ev = json.loads(line[2:])
            except ValueError:
                return False
            if ev["type"] == "progress":
                task.progress = {"stage": ev.get("stage"), "done": ev.get("done"), "total": ev.get("total"),
                                 "speed": ev.get("speed"), "track": ev.get("track"), "elapsed": time.time() - t0}
                return True
            if ev["type"] == "log":
                task.log(ev.get("text", ""))
            elif ev["type"] == "error":
                failed.append(ev.get("text", "failed"))
                task.log("Error: " + ev.get("text", ""))
            elif ev["type"] == "done":
                task.log(f"Done: {ev.get('segments')} lines in {round((time.time() - t0) / 60, 1)} min.")
            return True

        code = task.stream([str(env_python()), str(WORKER), "run", str(job_file)], env=worker_env(), on_line=on_line)
        job_file.unlink(missing_ok=True)
        if task.status != "running":
            return
        if code != 0 or failed:
            task.finish(False)
            notify.toast("Transcription failed", (failed[-1] if failed else f"exit code {code}")[:120])
            return
        fixed = camp.fix_transcript_names(sid, list(camp.spellings().items()))
        if fixed and sum(fixed.values()):
            task.log("Fixed remembered spellings: " + ", ".join(f"{k} ×{v}" for k, v in fixed.items() if v))
        task.finish(True, {"session": sid})
        notify.toast("Transcript ready", f"Session {camp.session_number(sid)} took {round((time.time() - t0) / 60)} min")
        if s.get("auto_recap"):
            from . import claude, recaps
            try:
                recaps.start_draft(camp, sid)
            except claude.ClaudeError as e:
                task.log(f"Not drafting the recap automatically: {e}")


QUEUE = Queue()
