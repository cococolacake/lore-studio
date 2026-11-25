"""Sessions: the list, plans, live mode, recordings, transcripts and the transcription environment."""
import re
import time
from pathlib import Path

from .. import campaign, frontmatter, obs, plans, recaps, settings, transcription
from ..util import Task, read_json, write_json


class SessionsApi:
    # ---- sessions --------------------------------------------------------------------------------

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

    # ---- session plans ---------------------------------------------------------------------------

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

    # ---- live mode -------------------------------------------------------------------------------

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
        """patch: {"current": id, "finished": {scene: bool}, "ticks": {scene: [i...]}, "ticked_text": {...}} merged into live.json.
        Opening a scene only records that you looked at it; a scene counts as played when you mark it finished."""
        c = self._camp()
        live = c.read_live(sid)
        if "finished" in patch:
            fin = set(live.get("finished") or [])
            for scene, on in (patch["finished"] or {}).items():
                (fin.add if on else fin.discard)(scene)
            text = (c.session_dir(sid) / "plan.md").read_text(encoding="utf-8") if (c.session_dir(sid) / "plan.md").exists() else ""
            order = plans.scene_titles(text)
            live["finished"] = [x["id"] for x in order if x["id"] in fin]
            live["finished_titles"] = [x["title"] for x in order if x["id"] in fin]
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

    # ---- sessions: recording, transcript ---------------------------------------------------------

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
        if p.is_dir() or (p.is_file() and p.suffix.lower() == ".zip"):
            return self._set_person_files(c, sid, p)
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

    def _set_person_files(self, c, sid, p):
        """One audio file per person (a Craig download, as a folder or a .zip)."""
        try:
            files = transcription.gather_person_files(p, c.session_dir(sid) / "voices")
        except ValueError as e:
            raise campaign.CampaignError(str(e))
        rec = {"path": str(p), "per_person": True, "streams": [], "duration": None, "live": False,
               "tracks": transcription.person_tracks(files, c), "unpacked": p.suffix.lower() == ".zip"}
        d = c.session_dir(sid)
        write_json(d / "recording.json", rec)
        return rec

    def set_tracks(self, sid, tracks, diarize_mix=False):
        c = self._camp()
        if c.read_recording(sid).get("per_person"):
            transcription.remember_person_names(c, tracks)
        return c.write_recording(sid, {"tracks": tracks, "diarize_mix": bool(diarize_mix)})

    def transcribe(self, sid):
        return transcription.QUEUE.add(self._camp(), sid)

    def save_speakers(self, sid, mapping):
        self._camp().save_speakers(sid, mapping)
        return self.session_full(sid)

    def spotlight(self, sid):
        return self._camp().spotlight(sid)

    def spotlight_all(self):
        return self._camp().spotlight_all()

    def suggest_name_fixes(self, sid):
        return self._camp().suggest_name_fixes(sid)

    def fix_names(self, sid, pairs, transcript=True, remember=True, ignore=None):
        counts = self._camp().fix_names(sid, pairs, bool(transcript), bool(remember), ignore or [])
        return {"counts": counts, "session": self.session_full(sid)}

    def spellings(self):
        return self._camp().spellings()

    def not_names(self):
        return self._camp().not_names()

    def save_not_names(self, words):
        c = self._camp()
        c.save_info({"not_names": [w.strip() for w in words or [] if w and w.strip()]})
        return c.not_names()

    def save_spellings(self, mapping):
        c = self._camp()
        c.save_info({"spellings": {k: v for k, v in (mapping or {}).items() if k and v and k != v}})
        return c.spellings()

    # ---- transcription environment ---------------------------------------------------------------

    def transcription_status(self):
        return transcription.status()

    def install_transcription(self, diarization=False):
        return Task.spawn("Installing transcription", transcription.install, bool(diarization)).id


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
