"""The app itself: settings, themes, CSS themes, updating, background tasks and file dialogs."""
import os
import sys
import threading
import time
from pathlib import Path

from .. import __version__, csstheme, watch, diagnostics, paths, settings, transcription
from ..util import Task, open_in_explorer


def _public_settings(s):
    """Settings for the UI: secrets are never sent back, only whether they're set."""
    out = dict(s)
    out["secrets_set"] = {k: bool(s.get(k)) for k in settings.SECRET_KEYS}
    for k in settings.SECRET_KEYS:
        out[k] = ""
    return out


class AppApi:
    # ---- app / settings --------------------------------------------------------------------------

    def bootstrap(self):
        return {
            "version": __version__,
            "platform": "windows" if os.name == "nt" else ("mac" if sys.platform == "darwin" else "linux"),
            "settings": _public_settings(settings.load()),
            "themes": settings.list_themes(),
            "css_themes": csstheme.list_themes(),
            "data_dir": str(paths.data_dir()),
            "native": self._window is not None,
            "campaign": self.campaign_info(),
        }

    def diagnostics(self):
        """Plain-text report for bug reports: setup only, never keys or campaign text."""
        return diagnostics.report(self._campaign, native=self._window is not None)

    def save_settings(self, patch):
        patch = {k: v for k, v in (patch or {}).items() if not (k in settings.SECRET_KEYS and v is None)}
        return _public_settings(settings.save(patch))

    def save_theme(self, theme):
        return settings.save_theme(theme)

    def delete_theme(self, name):
        return settings.delete_theme(name)

    # ---- CSS themes (.css files dropped into Settings > Appearance) ------------------------------

    def list_css_themes(self):
        return csstheme.list_themes()

    def add_css_theme(self, name, text):
        saved, items = csstheme.add(name, text)
        return {"name": saved, "themes": items}

    def import_css_theme(self):
        """Pick a .css theme with the system file picker (app window). None if cancelled."""
        path = self._dialog("open", ("CSS themes (*.css)",))
        if not path:
            return None
        saved, items = csstheme.add_from_path(path)
        return {"name": saved, "themes": items}

    def css_theme(self, name):
        return csstheme.read(name)

    def delete_css_theme(self, name):
        items = csstheme.delete(name)
        theme = settings.load()["theme"]
        if theme.get("css") and theme["css"] == csstheme.clean_name(name):
            settings.save({"theme": {**theme, "css": ""}})
        return items

    # ---- updating Lore Studio itself -------------------------------------------------------------

    def _busy(self):
        return [t.title for t in list(Task._all.values()) if t.status in ("running", "queued")]

    def app_update(self, force=False):
        """Is there a newer Lore Studio on GitHub? (Checked a few times a day at most.)"""
        from .. import appupdate
        if not force and not settings.get("check_app_updates"):
            return {"current": __version__, "latest": None, "newer": False, "off": True}
        return appupdate.check(force)

    def app_update_info(self):
        from .. import selfupdate
        return {**selfupdate.info(), "busy": self._busy()}

    def app_self_update(self, tag=None):
        """Update Lore Studio itself (git pull, or the release zip). Runs as a task."""
        from .. import selfupdate
        busy = self._busy()
        if busy:
            raise RuntimeError(f"{busy[0]} is still running. Update after it has finished.")
        return Task.spawn("Update Lore Studio", selfupdate.update, tag).id

    def app_restart(self):
        """Start a fresh Lore Studio and close this one."""
        from .. import selfupdate
        busy = [b for b in self._busy() if b != "Update Lore Studio"]
        if busy:
            raise RuntimeError(f"{busy[0]} is still running. Restart after it has finished.")
        selfupdate.restart()

        def bye():
            time.sleep(0.8)
            if getattr(self, "_window", None):
                try:
                    self._window.destroy()     # closes the app window; main.py then exits
                    return
                except Exception:
                    pass
            os._exit(0)
        threading.Thread(target=bye, daemon=True).start()
        return True

    def state(self):
        """Polled by the UI: background jobs (running and queued), plus recently finished ones for toasts."""
        jobs = []
        for t in list(Task._all.values()):
            if t.status in ("running", "queued") or (getattr(t, "finished_at", 0) and t.finished_at > time.time() - 30):
                jobs.append({"id": t.id, "title": t.title, "status": t.status, "progress": t.progress,
                             "kind": getattr(t, "kind", ""), "session": getattr(t, "session", ""),
                             "last": t.lines[-1] if t.lines else "", "result": t.result if t.status != "running" else None})
        out = {"tasks": [j for j in jobs if j["status"] in ("running", "queued")], "recent": [j for j in jobs if j["status"] not in ("running", "queued")]}
        out["files"] = self._file_changes()
        return out

    def _file_changes(self):
        """Markdown files in the campaign changed by something other than Lore Studio (the Claude app, an editor…)."""
        c = self._campaign
        if not c or not settings.load().get("watch_files", True):
            return None
        w = getattr(self, "_watcher", None)
        if not w or w.root != c.root:
            w = self._watcher = watch.Watcher(c)
        try:
            w.poll()
        except Exception as e:            # a watcher hiccup must never break the poll
            print("file watch failed:", e, file=sys.stderr)
        return {"seq": w.seq, "events": w.events[-20:]}

    def cancel_task(self, tid):
        if transcription.QUEUE.cancel(tid):
            return True
        t = Task.get(tid)
        if t and t.status == "running":
            t.cancel()
        return True

    def task(self, tid, since=0):
        t = Task.get(tid)
        return t.snapshot(since) if t else None

    # ---- native dialogs (return None in browser mode) --------------------------------------------

    def _dialog(self, kind, file_types=()):
        if not self._window:
            return None
        import webview
        fd = getattr(webview, "FileDialog", None)
        dtype = {"folder": getattr(fd, "FOLDER", None) if fd else None,
                 "open": getattr(fd, "OPEN", None) if fd else None}[kind]
        if dtype is None:
            dtype = webview.FOLDER_DIALOG if kind == "folder" else webview.OPEN_DIALOG
        res = self._window.create_file_dialog(dtype, file_types=tuple(file_types))
        if not res:
            return None
        return (res[0] if isinstance(res, (list, tuple)) else res).replace("\\", "/")

    def pick_folder(self):
        return self._dialog("folder")

    def pick_file(self, kind="any"):
        types = {"json": ("LegendKeeper export (*.json)", "All files (*.*)"),
                 "html": ("HTML session notes (*.html;*.htm)", "All files (*.*)"),
                 "video": ("Recordings (*.mp4;*.mkv;*.mov;*.flv;*.webm;*.mp3;*.wav;*.m4a;*.ogg;*.flac)", "All files (*.*)"),
                 "zip": ("Zip files (*.zip)", "All files (*.*)")}.get(kind, ("All files (*.*)",))
        return self._dialog("open", types)

    def open_folder(self, path=None):
        target = Path(path) if path else self._camp().root
        open_in_explorer(target if target.is_dir() else target.parent)
        return True

    def pick_image(self):
        return self._dialog("open", ("Images (*.png;*.jpg;*.jpeg;*.webp;*.gif)", "All files (*.*)"))
