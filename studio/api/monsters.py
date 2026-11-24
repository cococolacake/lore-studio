"""The monster maker, the encounter builder and the party page."""
import json
import urllib.request

from .. import __version__, sheetfix, monsters, party, campaign, foundry, combatsim


class MonstersApi:
    # ---- monster maker ---------------------------------------------------------------------------

    def _m(self, fn, *args):
        try:
            return fn(*args)
        except ValueError as e:
            raise campaign.CampaignError(str(e))

    def monsters(self):
        return monsters.list_monsters(self._camp())

    def monster(self, mid):
        m = self._m(monsters.get, self._camp(), mid)
        return {**m, **self.monster_check(m)}

    def monster_check(self, m):
        """Derived numbers, the CR estimate and the stat block text, for the editor's live preview."""
        m = monsters.clean(m)
        return {"derived": monsters.derived(m), "estimate": monsters.estimate(m), "stat_text": monsters.stat_text(m)}

    def monster_save(self, m):
        return self.monster(monsters.save(self._camp(), m)["id"])

    def monster_delete(self, mid):
        monsters.delete(self._camp(), mid)
        return True

    def monster_new(self, source="blank", ref=None, name=None):
        """A new monster: blank, an SRD monster, a world creature or a compendium creature from Foundry."""
        if source == "srd":
            m = self._m(monsters.srd_get, ref)
        elif source == "foundry":
            m = monsters.from_foundry(foundry.request("actor_data", {"id": ref}, timeout=20))
        elif source == "pack":
            pack, _, aid = str(ref).partition("|")
            m = monsters.from_foundry(foundry.request("pack_actor", {"pack": pack, "id": aid}, timeout=20))
            m["foundry_id"] = ""
        else:
            m = monsters.blank(name or "New monster")
        if name:
            m["name"] = name
        return self.monster_save(m)

    def srd_monsters(self):
        return {"credit": monsters.SRD_CREDIT, "monsters": monsters.srd_list()}

    def monster_scale(self, m, target_cr):
        new, changes = monsters.scale(m, target_cr)
        return {"monster": {**new, **self.monster_check(new)}, "changes": changes}

    def monster_party_target(self, difficulty="hard", count=1, levels=None):
        lv = levels or party.levels(self._camp())
        if not lv:
            raise campaign.CampaignError("Lore Studio doesn't know your party's levels yet. Add them on the Party page (or link Foundry sheets).")
        return monsters.party_target(lv, difficulty, count)

    def monster_import(self, text=None, url=None):
        """5etools homebrew: a JSON file's text, a pasted creature, or a link to a homebrew file."""
        if url:
            if not str(url).startswith("https://"):
                raise campaign.CampaignError("Use an https:// link to the homebrew file.")
            try:
                req = urllib.request.Request(url, headers={"user-agent": f"lore-studio/{__version__}"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    text = r.read(20_000_000).decode("utf-8")
            except Exception as e:  # noqa: BLE001
                raise campaign.CampaignError(f"Couldn't download that file: {e}")
        try:
            data = json.loads(text or "")
        except ValueError:
            raise campaign.CampaignError("That isn't 5etools JSON. Paste the creature's JSON, or pick a homebrew .json file.")
        found = monsters.from_5etools(data)
        if not found:
            raise campaign.CampaignError("No creatures in there. (5etools files list them under \"monster\".)")
        return [self.monster_save(m)["id"] for m in found]

    def monster_to_foundry(self, mid):
        c = self._camp()
        m = monsters.get(c, mid)
        r = foundry.request("actor_save", {"id": m.get("foundry_id") or None, "data": monsters.to_foundry(m)}, timeout=30)
        if r.get("id") and r["id"] != m.get("foundry_id"):
            m["foundry_id"] = r["id"]
            monsters.save(c, m)
        return r

    def foundry_actor_packs(self):
        return foundry.request("actor_packs", {}, timeout=30)

    # ---- encounters ------------------------------------------------------------------------------

    def _levels(self, levels=None):
        return [int(x) for x in levels if str(x).strip().isdigit()] if levels else party.levels(self._camp())

    def encounters(self):
        return monsters.encounters(self._camp())

    def encounter(self, eid, levels=None):
        e = self._m(monsters.encounter_get, self._camp(), eid)
        lv = self._levels(levels)
        return {"encounter": e, "eval": monsters.evaluate(lv, e["groups"]), "levels": lv}

    def encounter_check(self, e, levels=None):
        """Difficulty for an encounter being edited (not saved yet)."""
        e = monsters.encounter_clean(self._camp(), e)
        lv = self._levels(levels)
        return {"encounter": e, "eval": monsters.evaluate(lv, e["groups"]), "levels": lv}

    def encounter_save(self, e):
        return monsters.encounter_save(self._camp(), e)

    def encounter_delete(self, eid):
        monsters.encounter_delete(self._camp(), eid)
        return True

    def encounter_text(self, e, levels=None):
        return monsters.encounter_text(self._camp(), e, self._levels(levels))

    def encounter_to_foundry(self, eid):
        """Send every monster in the encounter to Foundry (free-rules monsters are saved to your Monsters first)."""
        c = self._camp()
        e = monsters.encounter_get(c, eid)
        sent = []
        for g in e["groups"]:
            if g["kind"] == "srd":
                m = monsters.save(c, monsters.srd_get(g["ref"]))
                g["kind"], g["ref"] = "monster", m["id"]
            r = self.monster_to_foundry(g["ref"])
            sent.append({"name": g["name"], **r})
        monsters.encounter_save(c, e)
        return sent

    def encounter_place(self, eid, hidden=True):
        """Put every monster's tokens on the scene that's open in Foundry."""
        e = monsters.encounter_get(self._camp(), eid)
        missing = [g["name"] for g in e["groups"] if not g.get("foundry_id")]
        if missing:
            raise campaign.CampaignError(f"Send {', '.join(missing)} to Foundry first (Send all to Foundry).")
        placed = 0
        for g in e["groups"]:
            placed += foundry.request("place_actor", {"id": g["foundry_id"], "count": g["count"], "hidden": bool(hidden)})["placed"]
        return {"placed": placed}

    def encounter_simulate(self, e, opts=None):
        """Run the encounter against the party many times (the combat simulator). Linked characters are read fresh
        from Foundry first when it's connected, so their attacks, spells and hit points are current."""
        c = self._camp()
        opts = dict(opts or {})
        e = monsters.encounter_clean(c, e)
        members = party.get_all(c)
        pick = set(opts.get("members") or [])
        if pick:
            members = [p for p in members if p["id"] in pick]
        refreshed = 0
        if foundry.status()["connected"]:
            for p in members:
                if p.get("foundry_id"):
                    try:
                        p.update(party.sync(c, p["id"]))
                        refreshed += 1
                    except (ValueError, foundry.FoundryError):
                        pass
        groups = [(monsters._resolve(c, g), g["count"]) for g in e["groups"]]
        groups = [(m, n) for m, n in groups if m]
        try:
            out = combatsim.simulate(members, groups, opts.get("runs") or 1000, opts)
        except ValueError as err:
            raise campaign.CampaignError(str(err))
        out["refreshed"] = refreshed
        out["foundry"] = foundry.status()["connected"]
        return out

    # ---- the party page --------------------------------------------------------------------------

    def party(self):
        c = self._camp()
        out = []
        for p in party.get_all(c):
            out.append({**p, "hp_check": party.hp_breakdown((p.get("sheet") or {}).get("hp_detail"))})
        return {"party": out, "foundry_origin": foundry.status().get("origin") or ""}

    def party_save(self, entry):
        return self._m(party.save, self._camp(), entry)

    def party_delete(self, pid):
        party.delete(self._camp(), pid)
        return True

    def party_sync(self, pid):
        return self._m(party.sync, self._camp(), pid)

    def party_fix_hp(self, pid, changes):
        return self._m(party.fix_hp, self._camp(), pid, changes)

    def party_undo_hp(self, pid):
        return self._m(party.undo_hp, self._camp(), pid)

    def party_features(self, pid):
        return self._m(sheetfix.read, self._camp(), pid)

    def party_features_fix(self, pid, changes):
        return self._m(sheetfix.fix, self._camp(), pid, changes)

    def party_features_undo(self, pid):
        return self._m(sheetfix.undo, self._camp(), pid)
