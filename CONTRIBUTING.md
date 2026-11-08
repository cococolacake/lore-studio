# Contributing

Thanks for wanting to help! Bug reports, ideas and pull requests are all welcome.

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

- `studio/`: the backend. `api.py` is everything the UI can call; most features have their own module.
- `web/`: the front end, plain HTML, CSS and JavaScript with **no build step**. One file per page in `web/js/pages/`.
- `foundry/lore-studio-bridge/`: the Foundry VTT module.
- `studio/site/`: the player lore book's viewer.

## A few house rules

- **Keep it working on Python 3.10**, on Windows and Linux.
- **No build step** for the front end, and as few new dependencies as possible. Talking to Claude, local models,
  Discord, OBS and Foundry uses only the standard library.
- **Use made-up sample text**: John Doe, Jane Roe, the demo campaign. Never text from a real campaign.
- **Write the UI in plain words.** Buttons say what they do; messages say what happened and what to do next.
- **AI stays optional.** Every feature should still make sense with AI switched off (Settings → AI).

## Pull requests

Small and focused is easiest to review. Fill in the checklist in the template, and add a test
when you fix a bug or add a feature.
