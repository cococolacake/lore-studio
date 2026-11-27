# Retakes every screenshot in this folder from a fresh copy of the demo campaign.
#   python -m pip install playwright pillow && python -m playwright install chromium
#   python docs/screenshots/take.py
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SIZE = {"width": 1440, "height": 900}
PORT = 8765   # the usual port, so the Foundry page shows a familiar address
# Shown instead of the temporary folder, which would otherwise show in paths (and, on Windows, the username).
SHOWN_PATH = "~/Campaigns/The Sunken Crown (demo)"

HIDE_PATH_JS = """([roots, shown]) => {
  const swap = (s) => roots.reduce((t, r) => t.split(r).join(shown), s);
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walk.nextNode());) n.nodeValue = swap(n.nodeValue);
  for (const el of document.querySelectorAll("input, textarea")) { el.value = swap(el.value); el.placeholder = swap(el.placeholder); }
}"""


def main():
    base = f"http://127.0.0.1:{PORT}"

    def api(method, *args):
        req = urllib.request.Request(f"{base}/api/{method}", json.dumps({"args": list(args)}).encode(),
                                     {"Content-Type": "application/json"})
        r = json.load(urllib.request.urlopen(req))
        if r.get("error"):
            raise RuntimeError(f"{method}: {r['error']}")
        return r.get("result")

    with tempfile.TemporaryDirectory() as tmp:
        # its own app data folder, so the real settings and campaigns are never touched
        env = {**os.environ, "LORE_STUDIO_HOME": str(Path(tmp) / "home")}
        server = subprocess.Popen([sys.executable, "main.py", "--browser", "--port", str(PORT)], cwd=ROOT, env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:
                    urllib.request.urlopen(base, timeout=1)
                    break
                except OSError:
                    time.sleep(0.2)
            take_all(api, base, tmp)
        finally:
            server.terminate()


def take_all(api, base, tmp):
    root = api("create_demo", str(Path(tmp) / "campaigns"))["path"]
    # the demo has no monsters; these match the encounter in the screenshots
    owlbear = api("monster_new", "srd", "owlbear")["id"]
    api("monster_new", "srd", "wolf")
    enc = api("encounter_save", {"name": "Ambush at the mill", "session": "004-voices-in-the-water",
                                 "groups": [{"kind": "monster", "ref": owlbear, "count": 1},
                                            {"kind": "srd", "ref": "wolf", "count": 2}]})["id"]
    api("save_discord_config", {"webhooks": [{"name": "#session-recaps",
                                              "url": "https://discord.com/api/webhooks/1/demo"}]})
    party = {p["character"]: p["id"] for p in api("party")["party"]}

    shots = [
        ("home", "home", {}),
        ("sessions", "sessions", {"id": "002-lanterns-in-the-fog", "tab": "recap"}),
        ("recap", "sessions", {"id": "003-the-drowned-chapel", "tab": "recap"}),
        ("transcript", "sessions", {"id": "003-the-drowned-chapel", "tab": "transcript"}),
        ("plan", "sessions", {"id": "004-voices-in-the-water", "tab": "notes"}),
        ("live", "live", {"id": "004-voices-in-the-water"}),
        ("party", "party", {"id": party["Jane Roe"]}),
        ("lore", "lore", {"id": "Characters/John Doe"}),
        ("edit", "lore", {"id": "Characters/John Doe", "edit": True}),
        ("graph", "graph", {}),
        ("maps", "maps", {"id": "westmarch"}),
        ("calendar", "calendar", {}),
        ("timeline", "timeline", {}),
        ("monsters", "monsters", {"id": owlbear}),
        ("encounter", "monsters", {"enc": enc}),
        ("boards", "boards", {"id": api("boards")[0]["id"]}),
        ("threads", "threads", {"view": "review"}),
        ("clocks", "clocks", {}),
        ("handouts", "handouts", {}),
        ("chat", "chat", {}),
        ("foundry", "settings", {"section": "foundry"}),
        ("playersite", "settings", {"section": "playersite"}),   # before the lore book is built
        ("discordpost", "sessions", {"id": "002-lanterns-in-the-fog", "tab": "recap"}),
    ]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=SIZE)
        page.goto(base)
        page.wait_for_function("window.ctx && window.ctx.boot")
        for name, page_id, params in shots:
            page.evaluate("([id, params]) => window.ctx.go(id, params)", [page_id, params])
            page.wait_for_timeout(1500)
            if name == "discordpost":
                page.get_by_role("button", name="Post to Discord").click()
                page.wait_for_timeout(1000)
            page.evaluate(HIDE_PATH_JS, [[root, root.replace("\\", "/")], SHOWN_PATH])
            save(page, name)
        tid = api("player_site_build")
        while (api("task", tid) or {}).get("status") == "running":
            time.sleep(0.5)
        page.goto(base + api("player_site")["preview"])
        page.wait_for_timeout(1000)
        save(page, "lorebook")
        browser.close()


def save(page, name):
    Image.open(BytesIO(page.screenshot())).save(HERE / f"{name}.webp", quality=82, method=6)
    print(name)


if __name__ == "__main__":
    main()
