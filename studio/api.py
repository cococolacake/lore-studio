"""Everything the web UI can call. Exposed to JavaScript as window.pywebview.api.<method>
(and over HTTP by devserver.py when running in a normal browser)."""
import os
import re
import sys
import time
from pathlib import Path

from . import __version__, banners, campaign, chat, clocks, worldcal, frontmatter, claude, discord, foundry, legendkeeper, maps, notify, obs, paths, plans, recaps, settings, transcription
from .util import Task, open_in_explorer, read_json, write_json


def _public_settings(s):
    """Settings for the UI: secrets are never sent back, only whether they're set."""
    out = dict(s)
    out["secrets_set"] = {k: bool(s.get(k)) for k in settings.SECRET_KEYS}
    for k in settings.SECRET_KEYS:
        out[k] = ""
    return out


class Api:
    def __init__(self):
        self._window = None
        self._campaign = None
        self._base_url = ""
        self._open_saved()

    def _attach_window(self, window):
        self._window = window

    def _open_saved(self):
        path = settings.get("campaign_dir")
        if path and campaign.is_campaign(path):
            try:
                self._campaign = campaign.Campaign(path)
            except campaign.CampaignError:
                self._campaign = None

    def _camp(self):
        if not self._campaign:
            raise campaign.CampaignError("No campaign is open. Open or create one first.")
        return self._campaign

    # ---- app / settings --------------------------------------------------

    def bootstrap(self):
        return {
            "version": __version__,
            "platform": "windows" if os.name == "nt" else ("mac" if sys.platform == "darwin" else "linux"),
            "settings": _public_settings(settings.load()),
            "themes": settings.list_themes(),
            "data_dir": str(paths.data_dir()),
            "native": self._window is not None,
            "campaign": self.campaign_info(),
        }

    def save_settings(self, patch):
        patch = {k: v for k, v in (patch or {}).items() if not (k in settings.SECRET_KEYS and v is None)}
        return _public_settings(settings.save(patch))

    def save_theme(self, theme):
        return settings.save_theme(theme)

    def delete_theme(self, name):
        return settings.delete_theme(name)

    def state(self):
        """Polled by the UI: background jobs (running and queued), plus recently finished ones for toasts."""
        jobs = []
        for t in list(Task._all.values()):
            if t.status in ("running", "queued") or (getattr(t, "finished_at", 0) and t.finished_at > time.time() - 30):
                jobs.append({"id": t.id, "title": t.title, "status": t.status, "progress": t.progress,
                             "kind": getattr(t, "kind", ""), "session": getattr(t, "session", ""),
                             "last": t.lines[-1] if t.lines else "", "result": t.result if t.status != "running" else None})
        return {"tasks": [j for j in jobs if j["status"] in ("running", "queued")], "recent": [j for j in jobs if j["status"] not in ("running", "queued")]}

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

    # ---- native dialogs (return None in browser mode) ----------------------

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
                 "video": ("Recordings (*.mp4;*.mkv;*.mov;*.flv;*.webm;*.mp3;*.wav;*.m4a;*.ogg;*.flac)", "All files (*.*)")}.get(kind, ("All files (*.*)",))
        return self._dialog("open", types)

    def open_folder(self, path=None):
        target = Path(path) if path else self._camp().root
        open_in_explorer(target if target.is_dir() else target.parent)
        return True

    # ---- campaigns -----------------------------------------------------------

    def campaign_info(self):
        c = self._campaign
        if not c:
            return None
        return {"name": c.name, "path": str(c.root), "stats": c.stats(), "info": c.info}

    def _remember(self, c):
        recent = [r for r in settings.get("recent_campaigns") or [] if r.get("path") != str(c.root)]
        recent.insert(0, {"path": str(c.root), "name": c.name})
        settings.save({"campaign_dir": str(c.root), "recent_campaigns": recent[:8]})

    def open_campaign(self, path):
        c = campaign.Campaign(path)
        self._campaign = c
        self._remember(c)
        return self.campaign_info()

    def create_campaign(self, path, name):
        c = campaign.create(path, name)
        self._campaign = c
        self._remember(c)
        return self.campaign_info()

    def create_demo(self, parent):
        """The made-up demo campaign, in a new folder inside parent."""
        from . import demo
        path = Path(parent).expanduser() / "The Sunken Crown (demo)"
        n = 2
        while path.exists():
            path = Path(parent).expanduser() / f"The Sunken Crown (demo {n})"
            n += 1
        c = demo.create(path)
        self._campaign = c
        self._remember(c)
        return self.campaign_info()

    def save_campaign_info(self, patch):
        allowed = {k: v for k, v in (patch or {}).items() if k in ("party", "recap_style")}
        self._camp().save_info(allowed)
        return self.campaign_info()

    def rename_campaign(self, name):
        self._camp().save_info({"name": name})
        self._remember(self._camp())
        return self.campaign_info()

    def check_folder(self, path):
        p = Path(path).expanduser()
        empty = (not p.exists()) or (p.is_dir() and not any(x for x in p.iterdir() if not x.name.startswith(".")))
        return {"exists": p.exists(), "is_campaign": campaign.is_campaign(p), "empty": empty}

    def lk_summary(self, json_path):
        return legendkeeper.summarize(json_path)

    def lk_import(self, json_path, dest, name):
        """Start the LegendKeeper import in the background; returns a task id to follow."""
        def job(task):
            res = legendkeeper.import_project(json_path, dest, name, log=task.log)
            c = campaign.Campaign(res["path"])
            self._campaign = c
            self._remember(c)
            notify.toast("LegendKeeper import finished", f"{res['pages']} pages and {res['sessions']} sessions")
            return res
        return Task.spawn("Importing from LegendKeeper", job).id

    # ---- lore ----------------------------------------------------------------

    def lore_tree(self):
        return self._camp().tree()

    def lore_page(self, pid):
        return self._camp().read_page(pid)

    def save_page(self, pid, meta, body, expected_mtime=None):
        return self._camp().write_page(pid, meta, body, expected_mtime)

    def new_page(self, parent_id, title):
        return self._camp().create_page(parent_id, title)

    def delete_page(self, pid):
        return self._camp().delete_page(pid)

    def search(self, query):
        return self._camp().search(query)

    def link_names(self):
        return self._camp().link_names()

    def tags(self):
        return self._camp().tags()

    def graph(self):
        return self._camp().graph()

    def page_titles(self):
        return [{"id": p["id"], "title": p["title"], "aliases": p["aliases"]} for p in self._camp().pages()]

    # ---- sessions --------------------------------------------------------------

    def sessions(self):
        return self._camp().session_list()

    def session(self, sid):
        return self._camp().read_session(sid)

    def new_session(self, title, number=None):
        return self._camp().create_session(title, number)

    def update_session(self, sid, patch):
        return self._camp().update_session(sid, patch)

    def save_session_text(self, sid, which, body):
        return self._camp().write_session_text(sid, which, body)

    def attach_session_html(self, sid, path):
        return self._camp().attach_session_html(sid, path)

    def delete_session(self, sid):
        return self._camp().delete_session(sid)

    # ---- maps ----------------------------------------------------------------------

    def maps(self):
        return maps.list_maps(self._camp())

    def map(self, mid):
        return maps.read(self._camp(), mid)

    def new_map(self, name, image=None, page=None):
        return maps.create(self._camp(), name, image, page)

    def update_map(self, mid, patch):
        return maps.update(self._camp(), mid, patch)

    def delete_map(self, mid):
        return maps.delete(self._camp(), mid)

    def save_pin(self, mid, pin):
        return maps.save_pin(self._camp(), mid, pin)

    def delete_pin(self, mid, pin_id):
        return maps.delete_pin(self._camp(), mid, pin_id)

    def pins_for_page(self, pid):
        return maps.pins_for_page(self._camp(), pid)

    def download_map_image(self, mid):
        return maps.download_image(self._camp(), mid)

    def set_banner(self, pid, image=None, y=None, remove=False):
        return banners.set_banner(self._camp(), pid, image, y, remove)

    def banner_status(self):
        return {"remote": banners.remote_count(self._camp())}

    def download_banners(self):
        camp = self._camp()
        task = Task.spawn("Saving banner images", lambda t: banners.download_all(camp, t.log))
        return task.id

    # ---- clocks ---------------------------------------------------------------------

    def clocks(self):
        return clocks.all_clocks(self._camp())

    def clock_save(self, clock):
        return clocks.save(self._camp(), clock)

    def clock_delete(self, cid):
        return clocks.delete(self._camp(), cid)

    def clock_tick(self, cid, delta=1, note=""):
        c = self._camp()
        cal = worldcal.read(c)
        sid = self.live_session()
        if sid and not c.read_recording(sid).get("live"):
            sid = None                       # only stamp the session while it's being played
        return clocks.tick(c, cid, delta, note, session=sid,
                           world_date=cal["current"] if cal else None,
                           world_label=worldcal.format_date(cal, cal["current"]) if cal else "")

    def clocks_for_page(self, pid):
        return clocks.for_page(self._camp(), pid)

    # ---- in-world calendar ---------------------------------------------------------

    def calendar(self):
        cal = worldcal.read(self._camp())
        if not cal:
            return {"cal": None, "presets": [[k, v["name"]] for k, v in worldcal.PRESETS.items()]}
        return {"cal": cal, "today": worldcal.format_date(cal, cal["current"], True), "today_text": worldcal.today_text(cal),
                "upcoming": worldcal.upcoming(cal, 30)}

    def calendar_create(self, preset="simple"):
        worldcal.save(self._camp(), worldcal.blank(preset))
        return self.calendar()

    def calendar_save(self, cal):
        old = worldcal.read(self._camp()) or {}
        cal = {**cal, "events": cal.get("events", old.get("events", [])), "legendkeeper": old.get("legendkeeper")}
        if cal["legendkeeper"] is None:
            cal.pop("legendkeeper")
        worldcal.save(self._camp(), cal)
        return self.calendar()

    def calendar_month(self, y, m):
        c = self._camp()
        cal = worldcal.read(c)
        return worldcal.month_view(cal, y, m, worldcal.session_dates(c))

    def calendar_set_today(self, date):
        c = self._camp()
        cal = worldcal.read(c)
        cal["current"] = worldcal.clamp(cal, date)
        worldcal.save(c, cal)
        return self.calendar()

    def calendar_advance(self, days):
        c = self._camp()
        cal = worldcal.read(c)
        cal["current"] = worldcal.add_days(cal, cal["current"], int(days))
        worldcal.save(c, cal)
        return self.calendar()

    def calendar_save_event(self, event):
        c = self._camp()
        cal = worldcal.read(c)
        ev = worldcal._event(event)
        cal["events"] = [e for e in cal["events"] if e["id"] != ev["id"]] + [ev]
        worldcal.save(c, cal)
        return ev

    def calendar_delete_event(self, eid):
        c = self._camp()
        cal = worldcal.read(c)
        cal["events"] = [e for e in cal["events"] if e["id"] != eid]
        worldcal.save(c, cal)
        return True

    def calendar_format(self, date):
        cal = worldcal.read(self._camp())
        return worldcal.format_date(cal, date, True) if cal else ""

    def set_session_world_date(self, sid, date):
        c = self._camp()
        cal = worldcal.read(c)
        if date:
            date = worldcal.clamp(cal, date)
            c.update_session(sid, {"world_date": date, "in_world_date": worldcal.format_date(cal, date)})
        else:
            c.update_session(sid, {"world_date": None})
        return self.session_full(sid)

    def pick_image(self):
        return self._dialog("open", ("Images (*.png;*.jpg;*.jpeg;*.webp;*.gif)", "All files (*.*)"))

    # ---- session plans -----------------------------------------------------------

    def _plan_html(self, sid, text, base=None):
        c = self._camp()
        s = c.read_session(sid)
        theme = plans.theme_from_settings(settings.get("theme"))
        if base:
            theme["base"] = base
        return plans.render(text, c.name, s.get("number"), theme)

    def plan(self, sid):
        c = self._camp()
        d = c.session_dir(sid)
        f = d / "plan.md"
        return {"text": f.read_text(encoding="utf-8") if f.exists() else "", "exists": f.exists(),
                "has_html": (d / "plan.html").exists(), "scenes": plans.scene_titles(f.read_text(encoding="utf-8")) if f.exists() else []}

    def preview_plan(self, sid, text, base=None):
        return self._plan_html(sid, text, base)

    def save_plan(self, sid, text):
        c = self._camp()
        d = c.session_dir(sid)
        (d / "plan.md").write_text(text or "", encoding="utf-8")
        (d / "plan.html").write_text(self._plan_html(sid, text), encoding="utf-8")
        meta, _ = frontmatter.parse(text or "")
        if meta.get("title") and meta["title"] != c.read_session(sid)["title"]:
            c.update_session(sid, {"title": meta["title"]})
        return self.plan(sid)

    def start_plan(self, sid):
        """A starter plan for a session: from its HTML notes if it has some, else a template."""
        c = self._camp()
        d = c.session_dir(sid)
        s = c.read_session(sid)
        if (d / "plan.md").exists():
            return self.plan(sid)
        if (d / "plan.html").exists():
            html = (d / "plan.html").read_text(encoding="utf-8", errors="replace")
            try:
                _, text = plans.html_to_plan(html)
                (d / "plan.original.html").write_text(html, encoding="utf-8")
                (d / "plan.md").write_text(text, encoding="utf-8")
                return self.plan(sid)
            except ValueError:
                pass
        prev = self._previous_recap(sid)
        text = plans.TEMPLATE.format(title=s["title"], campaign=c.name, previously=prev)
        (d / "plan.md").write_text(text, encoding="utf-8")
        return self.plan(sid)

    def _previous_recap(self, sid):
        c = self._camp()
        prev = [x for x in c.sessions() if isinstance(x["number"], int) and x["status"] == "recapped"]
        me = next((x for x in c.sessions() if x["id"] == sid), None)
        if me and isinstance(me["number"], int):
            prev = [x for x in prev if x["number"] < me["number"]]
        if not prev:
            return ""
        last = prev[-1]
        text = c.player_recap(last["id"]) or c.read_session(last["id"])["recap"]
        text = recaps.strip_gm(text)
        text = re.sub(r"\{t:[0-9:]+\}", "", text)
        paras = [p.strip() for p in text.split("\n\n") if p.strip() and not p.strip().startswith((":::", "#"))]
        return " ".join(paras[:2])[:900]

    def previously(self, sid):
        return self._previous_recap(sid)

    def carry_over(self, sid, scene_ids, title=""):
        """Make the next session from the scenes of this one that the party didn't reach."""
        c = self._camp()
        src = c.session_dir(sid) / "plan.md"
        if not src.exists():
            raise campaign.CampaignError("This session has no plan to carry over from.")
        s = c.read_session(sid)
        new_title = title or s["title"]
        new_sid = c.create_session(new_title, (s["number"] + 1) if isinstance(s["number"], int) else None)
        text = plans.carry_over(src.read_text(encoding="utf-8"), set(scene_ids), new_title)
        self.save_plan(new_sid, text)
        return new_sid

    # ---- Foundry -------------------------------------------------------------------

    def foundry_info(self):
        return {"token": foundry.token(), "url": self._base_url or "http://127.0.0.1:42012", "status": foundry.status(),
                "module_version": foundry.module_version(), "data_dirs": foundry.default_data_dirs()}

    def foundry_status(self):
        return foundry.status()

    def foundry_new_token(self):
        settings.save({"foundry_token": ""})
        return self.foundry_info()

    def foundry_install(self, data_dir):
        return foundry.install_module(data_dir)

    def foundry_send_page(self, pid, share=True):
        c = self._camp()
        p = c.read_page(pid)
        if share and p["meta"].get("visibility") == "gm":
            share = False
        html = foundry.md_to_html(p["body"], player_safe=bool(share))
        return foundry.push_journal(f"page:{pid}", p["meta"].get("title") or pid, html, share)

    def foundry_send_recap(self, sid):
        c = self._camp()
        s = c.read_session(sid)
        text = c.player_recap(sid) or s["recap"]
        if not text.strip():
            raise campaign.CampaignError("This session has no recap yet.")
        html = foundry.md_to_html(text, player_safe=True)
        return foundry.push_journal(f"recap:{sid}", f"Session {s['number']}: {s['title']}", html, True, folder="Lore Studio · Recaps")

    def foundry_log(self, sid):
        return foundry.read_log(self._camp(), sid, limit=500)

    # ---- live mode ---------------------------------------------------------------

    def live_session(self):
        """Which session Live mode opens: one being recorded, else the next planned one with a plan, else the latest."""
        c = self._camp()
        ss = c.sessions()
        for x in ss:
            if c.read_recording(x["id"]).get("live"):
                return x["id"]
        planned = [x for x in ss if x["status"] == "planned" and (x["has_plan"])]
        if planned:
            return planned[-1]["id"]
        return ss[-1]["id"] if ss else None

    def live_state(self, sid):
        c = self._camp()
        d = c.session_dir(sid)
        text = (d / "plan.md").read_text(encoding="utf-8") if (d / "plan.md").exists() else ""
        live = c.read_live(sid)
        scenes = plans.scene_titles(text) if text else []
        if scenes and live.get("current") not in {x["id"] for x in scenes}:
            live["current"] = next((x["id"] for x in scenes if not x["glance"]), scenes[0]["id"])
            c.write_live(sid, live)
        rec = c.read_recording(sid)
        return {"session": c.read_session(sid), "scenes": scenes, "live": live, "recording": bool(rec.get("live")),
                "has_plan": bool(text), "has_html": (d / "plan.html").exists()}

    def live_scene(self, sid, scene_id):
        c = self._camp()
        f = c.session_dir(sid) / "plan.md"
        theme = plans.theme_from_settings(settings.get("theme"))
        theme["base"] = (settings.get("theme") or {}).get("base", "light")
        return plans.render_scene(f.read_text(encoding="utf-8") if f.exists() else "", scene_id, theme)

    def live_update(self, sid, patch):
        """patch: {"current": id, "ticks": {scene: [i...]}, "ticked_text": {...}} merged into live.json."""
        c = self._camp()
        live = c.read_live(sid)
        if "current" in patch and patch["current"] != live.get("current"):
            visited = live.setdefault("visited", [])
            if patch["current"] not in visited:
                visited.append(patch["current"])
                text = (c.session_dir(sid) / "plan.md").read_text(encoding="utf-8") if (c.session_dir(sid) / "plan.md").exists() else ""
                title = next((x["title"] for x in plans.scene_titles(text) if x["id"] == patch["current"]), patch["current"])
                live.setdefault("visited_titles", []).append(title)
            live["current"] = patch["current"]
        for k in ("ticks", "ticked_text"):
            if k in patch:
                live.setdefault(k, {}).update(patch[k])
        return c.write_live(sid, live)

    def live_note(self, sid, text, scene_title=""):
        c = self._camp()
        live = c.read_live(sid)
        note = {"time": time.strftime("%H:%M"), "text": (text or "").strip(), "scene_title": scene_title}
        if c.read_recording(sid).get("live"):
            try:
                secs = obs.status()["seconds"]
                note["rec"] = f"{secs // 3600:02d}:{secs % 3600 // 60:02d}:{secs % 60:02d}"
            except Exception:
                pass
        if note["text"]:
            live.setdefault("notes", []).append(note)
            c.write_live(sid, live)
        return live

    def delete_live_note(self, sid, index):
        c = self._camp()
        live = c.read_live(sid)
        notes = live.get("notes") or []
        if 0 <= int(index) < len(notes):
            notes.pop(int(index))
        return c.write_live(sid, live)

    def suggest_scene(self, sid, idea=""):
        return recaps.suggest_scene(self._camp(), sid, idea)

    # ---- sessions: recording, transcript ---------------------------------------

    def session_full(self, sid):
        c = self._camp()
        s = c.read_session(sid)
        tr = c.read_transcript(sid)
        s["recording"] = c.read_recording(sid)
        s["transcript"] = None if not tr else {
            "segments": tr.get("segments") or [], "speakers": tr.get("speakers") or {}, "duration": tr.get("duration"),
            "model": tr.get("model"), "created": tr.get("created"),
            "labels": sorted({seg["speaker"] for seg in tr.get("segments") or []})}
        s["draft"] = c.read_draft(sid)
        s["player_recap"] = c.player_recap(sid)
        s["jobs"] = [j for j in self.state()["tasks"] if j.get("session") == sid]
        s["discord_posts"] = (read_json(c.session_dir(sid) / "session.json", {}) or {}).get("discord_posts", [])
        return s

    def set_recording(self, sid, path):
        c = self._camp()
        p = Path(path).expanduser()
        if not p.is_file():
            raise campaign.CampaignError("That file doesn't exist.")
        rec = {"path": str(p)}
        st = transcription.status()
        if st["installed"]:
            info = transcription.probe(p)
            rec["streams"] = info["audio"]
            rec["duration"] = info.get("duration")
            rec["tracks"] = default_tracks(len(info["audio"]), c)
        return c.write_recording(sid, rec)

    def set_tracks(self, sid, tracks, diarize_mix=False):
        return self._camp().write_recording(sid, {"tracks": tracks, "diarize_mix": bool(diarize_mix)})

    def transcribe(self, sid):
        return transcription.QUEUE.add(self._camp(), sid)

    def save_speakers(self, sid, mapping):
        self._camp().save_speakers(sid, mapping)
        return self.session_full(sid)

    def suggest_name_fixes(self, sid):
        return self._camp().suggest_name_fixes(sid)

    def fix_names(self, sid, pairs, transcript=True, remember=True):
        counts = self._camp().fix_names(sid, pairs, bool(transcript), bool(remember))
        return {"counts": counts, "session": self.session_full(sid)}

    def spellings(self):
        return self._camp().spellings()

    def save_spellings(self, mapping):
        c = self._camp()
        c.save_info({"spellings": {k: v for k, v in (mapping or {}).items() if k and v and k != v}})
        return c.spellings()

    # ---- transcription environment ---------------------------------------------------

    def transcription_status(self):
        return transcription.status()

    def install_transcription(self, diarization=False):
        return Task.spawn("Installing transcription", transcription.install, bool(diarization)).id

    # ---- Claude --------------------------------------------------------------------

    def claude_models(self):
        return claude.MODELS

    # ---- chat ------------------------------------------------------------------------

    def chats(self):
        return chat.list_chats(self._camp())

    def chat_read(self, cid):
        c = chat.read(self._camp(), cid)
        c["active"] = cid in chat._jobs and not chat._jobs[cid]["done"]
        return c

    def chat_new(self, player_safe=False):
        return chat.create(self._camp(), player_safe)

    def chat_update(self, cid, patch):
        return chat.update(self._camp(), cid, patch)

    def chat_delete(self, cid):
        return chat.delete(self._camp(), cid)

    def chat_send(self, cid, text):
        return chat.send(self._camp(), cid, text)

    def chat_regenerate(self, cid):
        return chat.regenerate(self._camp(), cid)

    def chat_truncate(self, cid, index):
        return chat.truncate(self._camp(), cid, index)

    def chat_poll(self, cid):
        return chat.poll(cid)

    def chat_stop(self, cid):
        return chat.stop(cid)

    def chat_to_page(self, title, text):
        """Save a reply as a new lore page under "Notes"."""
        c = self._camp()
        if not any(p["id"] in ("Notes", "Notes/index") for p in c.pages()):
            c.write_page("Notes/index", {"title": "Notes", "tags": ["notes"]}, "Ideas and answers saved from chats.\n\n{{children}}\n")
        page = c.create_page("Notes/index", (title or "Chat note").strip()[:80])
        c.write_page(page["id"], {"title": (title or "Chat note").strip()[:80], "tags": ["notes"]}, text or "")
        return page["id"]

    def local_presets(self):
        return claude.LOCAL_PRESETS

    def local_models(self, url=None):
        return claude.local_models(url or None)

    def claude_test(self):
        return claude.test()

    def recap_estimate(self, sid):
        return recaps.estimate(self._camp(), sid)

    def scan_candidates(self, only_new=True):
        return recaps.scan_candidates(self._camp(), only_new)

    def scan_threads(self, sids):
        return recaps.start_scan(self._camp(), sids)

    def draft_recap(self, sid, parts=None):
        return recaps.start_draft(self._camp(), sid, parts or ("gm", "player", "threads"))

    def accept_draft(self, sid, gm=None, player=None):
        recaps.accept_draft(self._camp(), sid, gm, player)
        return self.session_full(sid)

    def discard_draft(self, sid):
        self._camp().discard_draft(sid)
        return self.session_full(sid)

    def save_player_recap(self, sid, body):
        self._camp().write_player_recap(sid, body)
        return self.session_full(sid)

    # ---- threads ---------------------------------------------------------------------

    def threads(self):
        c = self._camp()
        titles = {s["id"]: f"{s['number']}. {s['title']}" for s in c.sessions()}
        out = c.threads()
        for t in out:
            t["session_titles"] = [titles.get(x, x) for x in t.get("sessions") or []]
        return out

    def add_thread(self, title, detail="", kind="hook", session=None):
        return self._camp().add_thread(title, detail, kind, session=session)

    def update_thread(self, tid, patch):
        return self._camp().update_thread(tid, patch)

    def accept_suggestion(self, tid):
        c = self._camp()
        th = next((t for t in c.threads() if t["id"] == tid), None)
        if not th or not th.get("suggestion"):
            raise campaign.CampaignError("Nothing to accept.")
        sug = th["suggestion"]
        patch = {"note": {"text": sug["note"], "session": sug.get("session")}}
        if sug["type"] == "resolve":
            patch["status"] = "resolved"
        c.update_thread(tid, patch)
        return self.dismiss_suggestion(tid)

    def dismiss_suggestion(self, tid):
        c = self._camp()
        threads = c.threads()
        for t in threads:
            if t["id"] == tid:
                t.pop("suggestion", None)
        c.save_threads(threads)
        return True

    def delete_thread(self, tid):
        return self._camp().delete_thread(tid)

    # ---- Discord ---------------------------------------------------------------------

    def discord_config(self):
        return discord.config(self._camp())

    def save_discord_config(self, cfg):
        c = self._camp()
        clean = {k: v for k, v in (cfg or {}).items() if k in discord.DEFAULTS}
        for w in clean.get("webhooks") or []:
            if w.get("url") and not discord.valid_url(w["url"]):
                raise campaign.CampaignError(f"“{w.get('name') or w['url']}” isn't a Discord webhook URL.")
        c.save_info({"discord": {**discord.config(c), **clean}})
        return discord.config(c)

    def discord_preview(self, sid, text, cfg=None):
        c = self._camp()
        s = c.read_session(sid)
        return discord.build(c, s, text, cfg)

    def discord_post(self, sid, text, webhook_index=0, cfg=None):
        c = self._camp()
        s = c.read_session(sid)
        conf = {**discord.config(c), **(cfg or {})}
        hooks = conf.get("webhooks") or []
        if not hooks:
            raise campaign.CampaignError("Add a Discord webhook in Settings → Discord first.")
        hook = hooks[int(webhook_index) if int(webhook_index) < len(hooks) else 0]
        ids = discord.post(hook["url"], discord.build(c, s, text, cfg))
        f = c.session_dir(sid) / "session.json"
        info = read_json(f, {}) or {}
        info.setdefault("discord_posts", []).append({"channel": hook.get("name") or "Discord", "ids": ids,
                                                     "date": time.strftime("%Y-%m-%d %H:%M")})
        write_json(f, info)
        return {"ids": ids, "channel": hook.get("name") or "Discord"}

    # ---- OBS -------------------------------------------------------------------------

    def obs_test(self):
        return obs.test()

    def obs_status(self):
        return obs.status()

    def obs_start(self, sid):
        st = obs.start()
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        self._camp().write_recording(sid, {"live": {"started": now}, "live_started": now, "chapters": []})
        self._camp().update_session(sid, {"played": True, "date": time.strftime("%Y-%m-%d")})
        return st

    def obs_chapter(self, sid, name):
        c = self._camp()
        res = obs.chapter(name)
        rec = c.read_recording(sid)
        chapters = rec.get("chapters") or []
        secs = res["seconds"]
        chapters.append({"seconds": secs, "time": f"{secs // 3600:02d}:{secs % 3600 // 60:02d}:{secs % 60:02d}", "name": name,
                         "in_file": res["in_file"]})
        c.write_recording(sid, {"chapters": chapters})
        return chapters

    def obs_stop(self, sid):
        c = self._camp()
        path = obs.stop()
        rec = {"live": None}
        if path:
            rec["path"] = path
        c.write_recording(sid, rec)
        queued = None
        if path:
            for _ in range(20):            # OBS may still be finishing the file
                try:
                    if Path(path).stat().st_size > 0:
                        break
                except OSError:
                    pass
                time.sleep(0.5)
            if transcription.status()["installed"]:
                try:
                    info = transcription.probe(path)
                    c.write_recording(sid, {"streams": info["audio"], "duration": info.get("duration"),
                                            "tracks": default_tracks(len(info["audio"]), c)})
                    if settings.get("auto_transcribe"):
                        queued = transcription.QUEUE.add(c, sid)
                except Exception as e:  # the recording is attached anyway; show why it didn't queue
                    return {"path": path, "queued": None, "error": str(e)}
        return {"path": path, "queued": queued}


def default_tracks(n_streams, camp=None):
    """Which audio tracks to transcribe, from Settings → OBS (track numbers are 1-based, like in OBS).
    The players' track expects as many voices as there are characters in the party list."""
    s = settings.load()
    party = len([p for p in (camp.info.get("party") or []) if p.get("character") or p.get("player")]) if camp else 0
    gm, players = int(s.get("obs_gm_track") or 0), int(s.get("obs_players_track") or 0)
    tracks = []
    if gm and gm <= n_streams:
        tracks.append({"stream": gm - 1, "speaker": "GM", "diarize": False})
    if players and players <= n_streams:
        tracks.append({"stream": players - 1, "speaker": "Players", "diarize": bool(s.get("diarize_players")), "voices": party or None})
    return tracks
