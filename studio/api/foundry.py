"""Foundry VTT: the bridge module, sending pages and recaps, and live-mode actions."""
from .. import campaign, foundry, settings


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
        return foundry.request("playlist", {"id": pid, "sound": sound, "action": action})

    def foundry_stop_sounds(self):
        return foundry.request("stop_all_sounds")

    def foundry_log(self, sid):
        return foundry.read_log(self._camp(), sid, limit=500)
