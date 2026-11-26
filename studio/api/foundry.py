"""Foundry VTT: the bridge module, sending pages and recaps, live-mode actions and the music downloader."""
from pathlib import Path

from .. import campaign, foundry, music, settings
from ..util import Task, open_in_explorer


def _music(result):
    """Sound actions answer with the playlists as they are now: keep Lore Studio's copy current with them."""
    if isinstance(result, dict) and isinstance(result.get("playlists"), list):
        foundry.set_inventory({"playlists": result["playlists"]})
    return result


class FoundryApi:
    # ---- Foundry ---------------------------------------------------------------------------------

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

    # live-mode extras: everything below asks the GM's Foundry and waits for the answer
    def foundry_inventory(self):
        return foundry.inventory()

    def foundry_refresh(self):
        foundry.set_inventory(foundry.request("inventory") or {})
        return foundry.inventory()

    def foundry_roll_table(self, tid, private=False):
        return foundry.request("roll_table", {"id": tid, "private": bool(private)})

    def foundry_actor(self, aid):
        return foundry.request("actor", {"id": aid})

    def foundry_open_sheet(self, aid):
        return foundry.request("open_sheet", {"id": aid})

    def foundry_place(self, aid, count=1, hidden=False):
        return foundry.request("place_actor", {"id": aid, "count": int(count), "hidden": bool(hidden)})

    def foundry_scene(self, sid, mode="view"):
        return foundry.request("scene", {"id": sid, "mode": mode})

    def foundry_scenery(self, sid):
        """Move the players to a scene, crossfading into it."""
        return foundry.request("scenery", {"id": sid})

    def set_page_scene(self, pid, scene=None):
        """Link a lore page to a Foundry scene by name (None unlinks it)."""
        camp = self._camp()
        page = camp.read_page(pid)
        meta = dict(page["meta"])
        if scene:
            meta["scene"] = str(scene)
        else:
            meta.pop("scene", None)
        camp.write_page(pid, meta, page["body"])
        return camp.read_page(pid)

    def foundry_playlist(self, pid, sound=None, action="play"):
        return _music(foundry.request("playlist", {"id": pid, "sound": sound, "action": action}))

    def foundry_stop_sounds(self):
        return _music(foundry.request("stop_all_sounds"))

    def foundry_playlist_step(self, pid, direction=1):
        """The next track (direction 1) or the previous one (-1)."""
        return _music(foundry.request("playlist_step", {"id": pid, "direction": -1 if int(direction) < 0 else 1}))

    def foundry_playlist_mode(self, pid, mode):
        """-1 soundboard only, 0 in order, 1 shuffle, 2 all at once (Foundry's playlist modes)."""
        return _music(foundry.request("playlist_mode", {"id": pid, "mode": int(mode)}))

    def foundry_sound_volume(self, pid, sound, volume):
        return _music(foundry.request("sound_volume", {"id": pid, "sound": sound, "volume": max(0.0, min(1.0, float(volume)))}))

    def foundry_preview_sound(self, pid=None, sound=None, volume=None, stop=False):
        """Play a track in the GM's Foundry tab only, so the players don't hear it."""
        args = {"id": pid, "sound": sound, "stop": bool(stop)}
        if volume is not None:
            args["volume"] = max(0.0, min(1.0, float(volume)))
        return foundry.request("preview_sound", args)

    def foundry_log(self, sid):
        return foundry.read_log(self._camp(), sid, limit=500)

    # ---- music downloader ------------------------------------------------------------------------

    def music_info(self):
        return music.info()

    def music_set_folder(self, path):
        settings.save({"music_dir": str(path or "").strip()})
        return music.info()

    def music_download(self, text, playlist=False):
        """Download the pasted links as mp3s into the music folder. Returns a task id."""
        links = music.clean_links(text)
        if not links:
            raise ValueError("Paste at least one link (starting with https://).")
        title = f"Downloading {len(links)} song{'s' if len(links) != 1 else ''}"
        return Task.spawn(title, music.download, links, music.folder(), bool(playlist)).id

    def music_install_ytdlp(self):
        return Task.spawn("Installing yt-dlp", music.install_ytdlp).id

    def music_open_folder(self):
        d = Path(music.folder()).expanduser()
        d.mkdir(parents=True, exist_ok=True)
        open_in_explorer(d)
        return True
