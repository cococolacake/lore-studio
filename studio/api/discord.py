"""Discord: webhooks, previews and posting."""
import time

from .. import campaign, discord
from ..util import read_json, write_json


class DiscordApi:
    # ---- Discord ---------------------------------------------------------------------------------

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
