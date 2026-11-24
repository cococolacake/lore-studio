"""AI: tag suggestions, Claude and local models, chat, recap drafts and loose threads."""
from .. import autotag, campaign, chat, claude, recaps


class AiApi:
    # ---- AI tag suggestions ----------------------------------------------------------------------

    def tag_suggest_estimate(self, scope="untagged", pid=None, folder=None):
        return autotag.estimate(self._camp(), scope, pid, folder)

    def tag_suggest(self, scope="untagged", pid=None, folder=None):
        return autotag.start(self._camp(), scope, pid, folder)

    def tag_suggestions(self):
        return autotag.pending(self._camp())

    def tag_accept(self, pid, tags=None):
        return autotag.accept(self._camp(), pid, tags)

    def tag_dismiss(self, pid, tags=None):
        return autotag.dismiss(self._camp(), pid, tags)

    def tag_accept_all(self):
        return autotag.accept_all(self._camp())

    # ---- Claude ----------------------------------------------------------------------------------

    def claude_models(self):
        return claude.MODELS

    # ---- chat ------------------------------------------------------------------------------------

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

    # ---- threads ---------------------------------------------------------------------------------

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
