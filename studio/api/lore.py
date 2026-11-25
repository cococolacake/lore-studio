"""Lore pages, search, tags, the graph, maps and pins, header images, and the player lore book."""
import time
from pathlib import Path

from .. import banners, playersite, maps
from ..util import Task, open_in_explorer


class LoreApi:
    # ---- lore ------------------------------------------------------------------------------------

    def lore_tree(self):
        return self._camp().tree()

    def lore_page(self, pid):
        return self._camp().read_page(pid)

    def save_export_image(self, name, data_url):
        """Save a picture the app drew (the graph, say) as a PNG in the campaign's exports folder. Returns its path."""
        import base64, re, time
        m = re.match(r"^data:image/png;base64,(.+)$", data_url or "", re.S)
        if not m:
            raise ValueError("That isn't a PNG image.")
        c = self._camp()
        folder = c.root / "exports"
        folder.mkdir(exist_ok=True)
        stem = re.sub(r"[^\w\- ]+", "", name or "image").strip() or "image"
        f = folder / f"{stem} {time.strftime('%Y-%m-%d %H%M%S')}.png"
        f.write_bytes(base64.b64decode(m.group(1)))
        return str(f)

    def set_relations(self, pid, rels):
        return self._camp().set_relations(pid, rels)

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

    # ---- maps ------------------------------------------------------------------------------------

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

    # ---- player lore book ------------------------------------------------------------------------

    def player_site(self):
        c = self._camp()
        opts = playersite.options(c)
        out = Path(opts["out_dir"] or playersite.default_dir(c)).expanduser()
        built = out / "data.js"
        sessions = c.sessions()
        no_player = [s["number"] for s in sessions if not c.player_recap(s["id"]).strip() and c.read_session(s["id"])["recap"].strip()]
        inside = c.root in out.resolve().parents
        return {"options": opts, "path": str(out), "default": str(playersite.default_dir(c)),
                "built": time.strftime("%Y-%m-%d %H:%M", time.localtime(built.stat().st_mtime)) if built.exists() else "",
                "preview": f"/c/{out.resolve().relative_to(c.root).as_posix()}/index.html" if inside and built.exists() else "",
                "gm_pages": sum(1 for p in c.pages() if p["visibility"] == "gm"),
                "sessions_without_player_recap": no_player}

    def player_site_save(self, opts):
        c = self._camp()
        clean = {k: v for k, v in (opts or {}).items() if k in playersite.DEFAULTS}
        c.save_info({"player_site": {**playersite.options(c), **clean}})
        return self.player_site()

    def player_site_build(self):
        c = self._camp()
        task = Task.spawn("Building the player lore book", lambda t: playersite.build(c, log=t.log))
        task.kind = "site"
        return task.id

    def player_site_open(self):
        info = self.player_site()
        open_in_explorer(info["path"])
        return True

    # ---- live mode: NPC cards and random tables ---------------------------------------------

    def npc_cards(self, ids):
        c = self._camp()
        out = []
        for pid in ids or []:
            try:
                out.append(c.npc_card(pid))
            except Exception:
                pass
        return out

    def save_npc_card(self, pid, fields):
        return self._camp().save_npc_card(pid, fields)

    def random_tables(self):
        return self._camp().tables()
