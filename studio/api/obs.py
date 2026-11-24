"""OBS: connecting, recording and chapter marks."""
import time
from pathlib import Path

from .. import obs, settings, transcription
from .sessions import default_tracks


class ObsApi:
    # ---- OBS -------------------------------------------------------------------------------------

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
