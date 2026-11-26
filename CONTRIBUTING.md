# Contributing

Thanks for wanting to help! Bug reports, ideas and pull requests are all welcome. How to *use* Lore Studio is in the [wiki](https://github.com/cococolacake/lore-studio/wiki); this file is about working on it.

## Running from source

```
git clone https://github.com/cococolacake/lore-studio
cd lore-studio
python -m pip install -r requirements.txt
python main.py --browser --debug
```

Python 3.10 or newer. On the welcome screen, **Try the demo campaign** gives you something to click around in.

## Tests

```
python -m pytest -q tests
```

No GPU, API key or internet needed: Claude, local models, Foundry and Discord are faked in the tests.
The pipeline test needs ffmpeg and PyAV and skips without them.

There's also a browser smoke test that opens every page (it's what CI runs):

```
npm install --no-save playwright@1 && npx playwright install chromium
python main.py --browser --port 8765 &
node tests/smoke.mjs
```

## How the code is laid out

- `studio/`: the backend. `api/` is everything the UI can call, one file per area (app, campaigns, lore, sessions, ai, world, monsters, foundry, discord, obs); most features have their own module.
- `web/`: the front end, plain HTML, CSS and JavaScript with **no build step**. One file per page in `web/js/pages/`; the biggest pages (Settings, Sessions) have a folder next to them with a file per section or tab.
- `foundry/lore-studio-bridge/`: the Foundry VTT module.
- `studio/site/`: the player lore book's viewer.
- `wiki/`: the wiki pages (published to the Wiki tab when merged).

In `studio/`: `campaign.py` (the folder), `legendkeeper.py` (the importer), `api` (what the UI calls),
`transcription.py` + `workers/transcribe.py` (the GPU worker, run in its own venv), `recaps.py` + `claude.py` (drafts),
`discord.py` (webhooks), `obs.py` (a small obs-websocket v5 client), `maps.py`, `plans.py` (Markdown plans → HTML),
`foundry.py` (talks to the bridge), `music.py` (the music downloader, using yt-dlp), `csstheme.py` (CSS themes) and `demo.py` (the demo campaign).
Claude, local models, Discord, OBS and Foundry use only the standard library.

## A few house rules

- **Keep it working on Python 3.10**, on Windows and Linux.
- **No build step** for the front end, and as few new dependencies as possible. Talking to Claude, local models,
  Discord, OBS and Foundry uses only the standard library.
- **Use made-up sample text**: John Doe, Jane Roe, the demo campaign. Never text from a real campaign.
- **Write the UI in plain words.** Buttons say what they do; messages say what happened and what to do next.
- **AI stays optional.** Every feature should still make sense with AI switched off (Settings → AI).

## Pull requests and releases

Small and focused is easiest to review. Fill in the checklist in the template, add a test
when you fix a bug or add a feature, and write the **Release notes** section for users (keep it last).

Merging is always **Squash and merge**, so each pull request becomes one commit on `main`.

**Releasing:** bump `__version__` in `studio/__init__.py` in the pull request. When it's merged, the release
workflow posts the release with the pull request's **Release notes**, the app zip, and the Foundry module
(whose version is set to match, so `module.json` doesn't need bumping). A pull request that doesn't bump the
version isn't released on its own: its notes are added to the next release (write `None` for changes users
don't need to hear about). The workflow can also be run by hand from the Actions tab.

**The wiki** is written in `wiki/`. When a change to it is merged, the Wiki workflow publishes it to the
Wiki tab, so edit the files here rather than on the website.
