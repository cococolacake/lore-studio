"""World tools: boards, the timeline, handouts, clocks and the in-world calendar."""
from .. import boards, campaign, clocks, handouts, timeline, worldcal, discord, foundry


class WorldApi:
    # ---- boards ----------------------------------------------------------------------------------

    def boards(self):
        return boards.list_boards(self._camp())

    def board(self, bid):
        return boards.read(self._camp(), bid)

    def board_create(self, name="New board", page=None, session=None):
        return boards.create(self._camp(), name, page, session)

    def board_save(self, board):
        return boards.save(self._camp(), board)

    def board_delete(self, bid):
        return boards.delete(self._camp(), bid)

    def board_add_image(self, image):
        return boards.add_image(self._camp(), image)

    def boards_for(self, page=None, session=None):
        c = self._camp()
        return boards.for_page(c, page) if page else boards.for_session(c, session)

    # ---- timeline --------------------------------------------------------------------------------

    def timeline(self):
        return timeline.view(self._camp())

    def timeline_save_block(self, block):
        return timeline.save_block(self._camp(), block)

    def timeline_delete_block(self, bid):
        return timeline.delete_block(self._camp(), bid)

    def timeline_save_lanes(self, lanes):
        timeline.save_lanes(self._camp(), lanes)
        return self.timeline()

    # ---- handouts --------------------------------------------------------------------------------

    def handouts(self):
        return handouts.all_handouts(self._camp())

    def handout_save(self, item, image=None):
        return handouts.save(self._camp(), item, image)

    def handout_delete(self, hid):
        return handouts.delete(self._camp(), hid)

    def handout_reveal(self, hid, revealed=True):
        return handouts.mark(self._camp(), hid, None, revealed)

    def handout_foundry(self, hid, popup=True):
        """Make it a journal entry the players can see, and pop it up on everyone's screen."""
        c = self._camp()
        x = handouts.get(c, hid)
        html = foundry.md_to_html(x["text"], player_safe=True) if x.get("text") else ""
        foundry.push_handout(f"handout:{hid}", x["title"], html, handouts.data_url(c, x), x.get("image") or "", popup)
        return handouts.mark(c, hid, "foundry")

    def handout_discord(self, hid, text=None, webhook_index=0):
        c = self._camp()
        x = handouts.get(c, hid)
        conf = discord.config(c)
        hooks = conf.get("webhooks") or []
        if not hooks:
            raise campaign.CampaignError("Add a Discord webhook in Settings → Discord first.")
        hook = hooks[int(webhook_index) if int(webhook_index) < len(hooks) else 0]
        data, name = handouts.image_bytes(c, x)
        handouts.post_discord(hook["url"], handouts.discord_message(c, x, x["text"] if text is None else text, conf), data, name or "handout.png")
        return handouts.mark(c, hid, "discord:" + (hook.get("name") or "Discord"))

    # ---- clocks ----------------------------------------------------------------------------------

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

    # ---- in-world calendar -----------------------------------------------------------------------

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

    def calendar_format_range(self, date, end=None):
        cal = worldcal.read(self._camp())
        return worldcal.format_range(cal, date, end) if cal and date else ""

    def set_session_world_date(self, sid, date, end=None):
        """Date a session on the world calendar: one day, or `date` to `end` when it covers several.
        end="keep" moves the session to `date` keeping how many days it already covered."""
        c = self._camp()
        cal = worldcal.read(c)
        if end == "keep":
            old = next((x for x in c.sessions() if x["id"] == sid), {})
            end = None
            if date and old.get("world_date") and old.get("world_date_end"):
                span = worldcal.to_days(cal, old["world_date_end"]) - worldcal.to_days(cal, old["world_date"])
                end = worldcal.add_days(cal, worldcal.clamp(cal, date), span) if span > 0 else None
        if date:
            date = worldcal.clamp(cal, date)
            end = worldcal.clamp(cal, end) if end else None
            if end and worldcal.to_days(cal, end) <= worldcal.to_days(cal, date):
                end = None
            c.update_session(sid, {"world_date": date, "world_date_end": end,
                                   "in_world_date": worldcal.format_range(cal, date, end)})
        else:
            c.update_session(sid, {"world_date": None, "world_date_end": None})
        return self.session_full(sid)
