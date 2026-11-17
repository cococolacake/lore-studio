"""Notice campaign files changed outside Lore Studio.

People edit the campaign's Markdown files with other tools too, for example the Claude desktop app with the folder
connected, or Obsidian or a text editor. Lore Studio always reads pages fresh from disk, but what's already on screen
doesn't redraw itself, so the UI asks here (on its normal poll) whether anything changed, and offers to refresh.

Lore Studio's own saves must not count. Python's audit hooks tell us about every file this process opens for
writing, renames or deletes, from any thread, so those paths are marked as ours and skipped once.
(Transcription runs in a separate process, but it writes JSON and audio, which aren't watched.)
"""
import os
import sys
import threading
import time

WATCHED = (".md", ".markdown")
SKIP_DIRS = {"player-site", "recordings", "node_modules", "__pycache__"}
_ours = {}                       # normalised path -> when this process last wrote it
_ours_dirs = {}                  # folders this process moved or deleted -> when (covers every file inside)
_lock = threading.Lock()


def _norm(p):
    try:
        return os.path.normcase(os.path.abspath(os.fsdecode(p)))
    except (TypeError, ValueError):
        return None


def _mark(*paths):
    now = time.time()
    with _lock:
        for p in paths:
            n = _norm(p) if isinstance(p, (str, bytes, os.PathLike)) else None
            if n and n.endswith(WATCHED):
                _ours[n] = now


def _mark_dir(*paths):
    now = time.time()
    with _lock:
        for p in paths:
            n = _norm(p) if isinstance(p, (str, bytes, os.PathLike)) else None
            if n:
                _ours_dirs[n.rstrip(os.sep) + os.sep] = now


def _hook(event, args):
    try:
        if event == "open":
            path, mode, flags = (list(args) + [None, None, None])[:3]
            writing = (isinstance(mode, str) and any(c in mode for c in "wax+")) or \
                      (mode is None and isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT))
            if writing:
                _mark(path)
        elif event == "os.rename":
            if os.path.isdir(args[0]):
                _mark_dir(args[0], args[1])
            else:
                _mark(args[0], args[1])
        elif event in ("os.remove", "os.unlink"):
            _mark(args[0])
        elif event == "shutil.rmtree":
            _mark_dir(args[0])
    except Exception:          # an audit hook must never break the call it watches
        pass


_installed = False


def install():
    global _installed
    if not _installed:
        sys.addaudithook(_hook)
        _installed = True


def _was_ours(path, since):
    n = _norm(path)
    with _lock:
        t = _ours.pop(n, None)
        if t is None:
            t = max((v for d, v in _ours_dirs.items() if n.startswith(d)), default=None)
        # forget old marks so the tables can't grow without end
        old = time.time() - 300
        for table in (_ours, _ours_dirs):
            for k in [k for k, v in table.items() if v < old]:
                table.pop(k, None)
    return t is not None and t >= since - 5


class Watcher:
    """Snapshots the campaign's Markdown files and reports what changed since the last look."""

    def __init__(self, camp):
        self.camp = camp
        self.root = camp.root
        self.events = []         # [{seq, time, path, change, kind, id, file, title}]
        self.seq = 0
        self.last = 0.0
        self.snap = self._snapshot()
        self.at = time.time()

    def _snapshot(self):
        out = {}
        for dirpath, dirs, files in os.walk(self.root):
            dirs[:] = [d for d in dirs if not d.startswith(".") and d not in SKIP_DIRS]
            for name in files:
                if name.endswith(WATCHED) and not name.startswith("."):
                    p = os.path.join(dirpath, name)
                    try:
                        st = os.stat(p)
                    except OSError:
                        continue
                    out[p] = (st.st_mtime_ns, st.st_size)
        return out

    def _describe(self, path, change):
        rel = os.path.relpath(path, self.root).replace(os.sep, "/")
        ev = {"path": rel, "change": change, "kind": "file", "id": "", "file": "", "title": rel}
        parts = rel.split("/")
        if parts[0] == "lore" and len(parts) > 1:
            pid = "/".join(parts[1:])
            pid = pid.rsplit(".", 1)[0]
            ev.update(kind="page", id=pid)
            title = None
            if change != "removed":
                title = next((p["title"] for p in self.camp.pages() if p["id"] == pid), None)
            ev["title"] = title or (parts[-2] if parts[-1].lower() == "index.md" and len(parts) > 2 else parts[-1].rsplit(".", 1)[0])
        elif parts[0] == "sessions" and len(parts) == 3:
            ev.update(kind="session", id=parts[1], file=parts[2].rsplit(".", 1)[0])
            s = next((x for x in self.camp.sessions() if x["id"] == parts[1]), None)
            name = f"Session {s['number']}: {s['title']}" if s else parts[1]
            ev["title"] = f"{name} ({ev['file']})"
        return ev

    def poll(self, min_gap=1.5):
        """New events since the last poll (looks at the disk at most every min_gap seconds)."""
        now = time.time()
        if now - self.last < min_gap:
            return []
        self.last = now
        new = self._snapshot()
        since, self.at = self.at, now
        found = []
        for p in sorted(set(new) | set(self.snap)):
            a, b = self.snap.get(p), new.get(p)
            if a == b:
                continue
            change = "added" if a is None else "removed" if b is None else "changed"
            if _was_ours(p, since):
                continue
            found.append({"time": now, **self._describe(p, change)})
        self.snap = new
        found.sort(key=lambda e: e["path"])
        for e in found:
            self.seq += 1
            e["seq"] = self.seq
        self.events = (self.events + found)[-50:]
        return found

    def since(self, seq):
        self.poll()
        return {"seq": self.seq, "events": [e for e in self.events if e["seq"] > (seq or 0)]}
