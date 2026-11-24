"""Campaigns: opening and creating them, the demo, LegendKeeper import, export/restore and the before-session checklist."""
from pathlib import Path

from .. import backup, checklist, campaign, legendkeeper, notify, settings
from ..util import Task, read_json


class CampaignsApi:
    # ---- campaigns -------------------------------------------------------------------------------

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
        from .. import demo
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

    # ---- export everything / restore -------------------------------------------------------------

    def backup_info(self):
        c = self._camp()
        rec_bytes = 0
        for sdir in (c.root / "sessions").glob("*"):
            rec = read_json(sdir / "recording.json", {}) or {}
            for src in [rec.get("path")] + [t.get("file") for t in rec.get("tracks") or []]:
                if src and Path(src).is_file():
                    rec_bytes += Path(src).stat().st_size
        return {"name": backup.default_name(c), "folder": str(c.root.parent), "recordings_gb": round(rec_bytes / 1e9, 2)}

    def backup_export(self, dest, include_media=False, include_settings=True, include_secrets=False):
        c = self._camp()

        def job(task):
            task.progress = {"n": 0, "total": 100, "msg": ""}
            def prog(f):
                task.progress = {"n": int(f * 100), "total": 100, "msg": ""}
            try:
                return backup.export(c, dest, include_media, include_settings, include_secrets, log=task.log, progress=prog)
            except ValueError as e:
                raise campaign.CampaignError(str(e))
        task = Task.spawn("Exporting everything", job)
        task.kind = "backup"
        return task.id

    def backup_inspect(self, zip_path):
        try:
            return backup.inspect(zip_path)
        except (ValueError, OSError) as e:
            raise campaign.CampaignError(str(e))
        except Exception:  # noqa: BLE001 - not a zip at all
            raise campaign.CampaignError("That file isn't a Lore Studio backup .zip.")

    def backup_restore(self, zip_path, parent, restore_settings=False):
        def job(task):
            def prog(f):
                task.progress = {"n": int(f * 100), "total": 100, "msg": ""}
            return backup.restore(zip_path, parent, restore_settings, log=task.log, progress=prog)
        task = Task.spawn("Restoring a backup", job)
        task.kind = "restore"
        return task.id

    # ---- before-session checklist ----------------------------------------------------------------

    def _check(self, fn, *args):
        try:
            return fn(self._camp(), *args)
        except ValueError as e:
            raise campaign.CampaignError(str(e))

    def checklist(self, sid):
        return self._check(checklist.get, sid)

    def checklist_toggle(self, sid, item_id, done):
        return self._check(checklist.toggle, sid, item_id, bool(done))

    def checklist_add(self, sid, text, every=True):
        return self._check(checklist.add, sid, text, bool(every))

    def checklist_remove(self, sid, item_id):
        return self._check(checklist.remove, sid, item_id)

    def checklist_template(self):
        return {"items": checklist.template(self._camp())}

    def checklist_edit(self, item_id, text):
        return self._check(checklist.edit, item_id, text)

    def checklist_move(self, item_id, step):
        return self._check(checklist.move, item_id, int(step))

    def checklist_start(self):
        return self._check(checklist.start)
