"""Everything the web UI can call. Exposed to JavaScript as window.pywebview.api.<method>
(and over HTTP by devserver.py when running in a normal browser).

Api is put together from one class per area of the app, each in its own file here:
app, campaigns, lore, sessions, ai, world, monsters, foundry, discord and obs."""
from .. import watch, campaign, settings
from .app import AppApi
from .campaigns import CampaignsApi
from .lore import LoreApi
from .sessions import SessionsApi
from .ai import AiApi
from .world import WorldApi
from .monsters import MonstersApi
from .foundry import FoundryApi
from .discord import DiscordApi
from .obs import ObsApi
from .app import _public_settings
from .sessions import default_tracks

__all__ = ["Api", "_public_settings", "default_tracks"]


class Api(AppApi, CampaignsApi, LoreApi, SessionsApi, AiApi, WorldApi, MonstersApi, FoundryApi, DiscordApi, ObsApi):
    def __init__(self):
        self._window = None
        watch.install()
        self._campaign = None
        self._base_url = ""
        self._open_saved()

    def _attach_window(self, window):
        self._window = window

    _titlebar = None   # set by main.py on Windows: tints the window's title bar

    def set_titlebar(self, bg, text, dark=False):
        """Match the Windows title bar to the theme. Does nothing elsewhere."""
        import re
        ok = all(isinstance(c, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", c) for c in (bg, text))
        return bool(ok and self._titlebar and self._titlebar(bg, text, bool(dark)))

    _zoom = None   # set by main.py in the app window: zooms the whole window

    def set_zoom(self, factor):
        """Zoom the app window (0.5 to 2, 1 = 100%). False in a browser, where Ctrl + and Ctrl - do it."""
        try:
            factor = min(2.0, max(0.5, float(factor)))
        except (TypeError, ValueError):
            return False
        return bool(self._zoom and self._zoom(factor))

    def _open_saved(self):
        path = settings.get("campaign_dir")
        if path and campaign.is_campaign(path):
            try:
                self._campaign = campaign.Campaign(path)
            except campaign.CampaignError:
                self._campaign = None

    def _camp(self):
        if not self._campaign:
            raise campaign.CampaignError("No campaign is open. Open or create one first.")
        return self._campaign
