<p align="center">
  <img src="docs/icon.png" width="96" alt="Lore Studio icon">
</p>

<h1 align="center">Lore Studio</h1>

<p align="center">
  A friendly Windows & Linux app for game masters: keep your world's lore, plan and run sessions,<br>
  and turn session recordings into transcripts and recaps with Claude or a local AI model.
</p>

<p align="center">
  <img src="docs/screenshots/home.png" alt="Lore Studio home screen" width="900">
</p>

---

> **Status: Phase 3 of 4.** Lore vault, maps, session plans, live mode, Foundry VTT, and recording → transcript → AI recap (Claude or a local model) → Discord.
> New here? On the welcome screen, **Try the demo campaign** builds *The Sunken Crown*, a small made-up campaign to click around in.

## What it does

**Lore vault**
- **Pages in a tree**, like LegendKeeper or a wiki. A page can have subpages.
- **Markdown editor** with live preview and `[[Page name]]` link autocomplete.
- **GM-only secrets**: put text in a `:::gm` block, or mark a whole page *GM only*. The eye button previews what players would see.
- **Automatic links**: the first mention of a page's name, an alias, or a character's first name becomes a link while you read. Your files aren't changed.
- **Mentioned in**: every page lists the pages and session recaps that mention it.
- **Tags**: tag pages, click a tag to see everything with it, or search `#character`. New pages inherit their parent's main tag.
- **Search** across pages and session recaps.

- **Header images**: give any page a banner (choose a file, paste one, drop one in, or use a link) and drag it to choose which part shows. Images are copied into the campaign folder, and LegendKeeper banners are downloaded on import.

**Maps**
- Upload a map image and drop **pins** on it. A pin can open a lore page, open another map (a region inside the world map), or both. GM-only pins stay hidden in the player view.
- Pan and zoom with the mouse; every page lists the maps it's pinned on. LegendKeeper maps and pins come across on import.

**Plan sessions**
- Write the plan in **Markdown** with a few extra blocks (read-aloud text with NPC lines and checks, NPC quotes, secrets, a cast list, a timed "at a glance" flow), and Lore Studio renders the session notes page in your theme as you type.
- **Previously on** pulls in the last recap, **Carry over** brings unplayed scenes forward, and **Suggest a scene** asks the AI for one that fits the lore and open threads.
- Already have HTML notes? Import them and keep editing as Markdown.

**Run sessions (live mode)**
- One scene at a time, big and readable, with next/previous, a scratchpad for quick notes and a lore lookup.
- What you tick and note during play goes into the recap draft along with the transcript.

**Sessions**
- One folder per session: recap, player recap, plan, recording, transcript and notes.
- Number, title, real date and in-world date for each session.

**Record → transcript → recap**
- **OBS control**: start recording from the session page, mark named moments (they become chapters in a Hybrid MP4), stop. The recording is attached and transcribed automatically.
- **Transcription on your GPU** with faster-whisper (`large-v3-turbo`), in its own environment that the app installs for you. Works on any video or audio file.
- **Who said what**: with your mic and Discord on separate OBS audio tracks, every line is labelled *GM* or *Players*. Optional speaker detection (pyannote community-1) tells the players apart; name each voice once per session.
- **Your names, spelled right**: character and place names from the lore are passed to Whisper as hints.
- **The AI drafts the recap**: a detailed GM recap with time markers that jump to the transcript, a player-safe recap in the voice of your previous recaps, and loose threads. GM-only lore never reaches the player recap. Nothing replaces your recap until you accept it.
- **Claude or your own model**: use Claude with your own Anthropic API key, or a model you host yourself through any OpenAI-compatible server (Ollama, LM Studio, llama.cpp, KoboldCpp, vLLM, text-generation-webui). Local drafting is free and private (with Ollama, Lore Studio sets the context size on every request so long prompts aren't silently cut); when a transcript is longer than the model's context window, Lore Studio condenses it into notes part by part first. Models without function calling still work.
- **Loose threads**: hooks, promises, debts and unanswered questions, proposed by the AI, accepted or dismissed by you, resolved when the story closes them.
- **Check past recaps**: have the AI read recaps that were written before Lore Studio (or by hand) and find their loose threads too, oldest first, so threads a later session settled are filed as resolved.
- **Post to Discord** through a webhook, with a preview that looks like Discord, your edits, and a confirmation. Choose the name, avatar, colour, title, footer, role ping and spoiler tags.

**Chat about your campaign**
- Talk with the AI (Claude or your local model) like a chatbot that knows your world. Every reply sees your landing page, party, latest recaps, open threads and the lore pages the conversation mentions, so you can ask what happened, brainstorm names and hooks, or improvise an NPC mid-session.
- Replies stream in as they're written. Save a good answer as a lore page, or turn on **Player-safe** to keep GM-only lore out so you can share answers with players.

**Player lore book**
- One click builds a website of everything the players are allowed to see: lore pages with their header images, player recaps, maps without GM pins, revealed handouts, the calendar and public clocks, with search and dark mode. GM-only pages, GM blocks, GM pins and secrets are removed before anything is written.
- It's a plain folder, so share it with a link through Netlify Drop, GitHub Pages or any static host, or zip it into Discord. It opens straight from disk too.

**Clocks, handouts and the in-world calendar**
- **Clocks** track what factions and threats do off-screen: tick them between sessions or in play, with a note of what happened.
- **Handouts** (pictures, letters, posters) pop up on every player's screen in Foundry with one click, or post to Discord.
- **Calendar**: build your world's own: any months, festival days outside the week, leap rules, eras, as many moons as you like with their phases, seasons, holidays and events. Date sessions on it, and advance "today" in play.

**Foundry VTT bridge**
- A small Foundry module (v13–v14) that Lore Studio installs for you. While you play, rolls, chat, combat turns and scene changes are logged to the session, and they're used when drafting the recap.
- **Send to Foundry** turns a lore page or a player recap into a journal entry (GM-only blocks removed when players can see it).
- **From live mode**: roll Foundry's tables, look up monsters' stat blocks and drop their tokens on the scene, move the players to another scene, and play or stop music. Write `{actor:Goblin}`, `{table:Wild Magic}`, `{scene:The Cellar}`, `{sound:Rain}` or `{handout:Wanted poster}` in a plan, and they become one-click links while you run it.

**Connection graph**
- Every page (and session) as a dot, with a line wherever one mentions another. Colours follow tags; hide tags, highlight names, drag dots, click to open.

**Import from LegendKeeper**
- Export your LegendKeeper project as JSON and import it. Pages keep their tree, order, tags and banners; secret blocks become GM-only blocks; the Campaign Log becomes sessions; maps keep their pins; calendars and timelines are kept for later. Pages are tagged automatically from where they sit (Characters → `#character`, a region's places → `#location #westmarch`).

**Looks**
- A soft pastel look: light and dark modes, 10 pastel accents, patterned or image headers, and your own `web/css/custom.css`.

<table>
  <tr>
    <td><img src="docs/screenshots/lore.png" alt="A lore page"></td>
    <td><img src="docs/screenshots/graph.png" alt="Connection graph"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/sessions.png" alt="A session recap"></td>
    <td><img src="docs/screenshots/edit.png" alt="Page editor"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/recap.png" alt="Claude's recap draft"></td>
    <td><img src="docs/screenshots/transcript.png" alt="Transcript with speakers"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/threads.png" alt="Loose threads to review"></td>
    <td><img src="docs/screenshots/discordpost.png" alt="Post to Discord preview"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/plan.png" alt="Writing a session plan"></td>
    <td><img src="docs/screenshots/live.png" alt="Live mode"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/maps.png" alt="A map with pins"></td>
    <td><img src="docs/screenshots/foundry.png" alt="Foundry VTT settings"></td>
  </tr>
</table>

<sub>Screenshots show the made-up demo campaign.</sub>

## Your campaign is a folder

```
My Campaign/
  campaign.json            name and settings
  lore/                    Markdown pages; a folder with an index.md is a page with subpages
    index.md               the landing page
    Characters/index.md
    Characters/John Doe.md
  sessions/
    003-the-drowned-chapel/
      session.json         number, title, dates
      recording.json       where the video is, which tracks to use, marked moments
      transcript.json      timed lines with speakers (+ .srt and .txt)
      recap.md             the GM recap
      player-recap.md      the one your players see
      plan.md              the session plan (plan.html is rendered from it)
      live.json            ticks and quick notes from live mode
      foundry-log.jsonl    rolls, chat and combat from Foundry
  threads.json             loose threads
  maps/                    map images and their pins
  assets/  templates/
  .trash/                  deleted pages and sessions go here, not into the void
```

Pages are ordinary Markdown with a small header, so they open in Obsidian or any editor:

```markdown
---
title: John Doe
tags: [character, westmarch]
aliases: [John]
visibility: gm
---
A human fighter from Westmarch. Good with a shield, bad with secrets...

:::gm
Only the GM sees this.
:::
```

Back it up, sync it, or put it in git like any folder.

## Install

You need **Python 3.10 or newer**.

**Windows:** double-click `Install.bat`, then `Lore Studio.bat`. `Create desktop shortcut.bat` adds a desktop icon.

**Linux:** `./install.sh`, then `./lore-studio.sh`. `./create-desktop-entry.sh` adds it to your app menu.

Prefer your browser? Run `python main.py --browser`.

## Roadmap

| Phase | What | Status |
| --- | --- | --- |
| 1. Foundation | App shell, lore vault, tags, graph, sessions, LegendKeeper import | ✅ Done |
| 2. Record to recap | GPU transcription (faster-whisper) with speaker labels from OBS tracks, AI recaps and loose threads, post recaps to Discord with a preview | ✅ Done |
| 3. Plan and play | Markdown session plans rendered to HTML, live mode, Foundry VTT bridge, interactive maps with pins, demo campaign | ✅ Done |
| 4. Public release | Notion import, player-safe exports, MCP server, docs | Next |

## Development

```
python -m pytest -q tests          # tests (the pipeline test needs ffmpeg + PyAV; no GPU or API key needed)
python main.py --browser --debug   # run with dev tools
```

The front end is plain HTML, CSS and JavaScript (no build step): `web/js/pages/` has one file per page.
The backend is `studio/`: `campaign.py` (the folder), `legendkeeper.py` (the importer), `api.py` (what the UI calls),
`transcription.py` + `workers/transcribe.py` (the GPU worker, run in its own venv), `recaps.py` + `claude.py` (drafts),
`discord.py` (webhooks), `obs.py` (a small obs-websocket v5 client), `maps.py`, `plans.py` (Markdown plans → HTML),
`foundry.py` + `foundry/lore-studio-bridge/` (the Foundry module) and `demo.py` (the demo campaign).
Claude, local models, Discord, OBS and Foundry use only the standard library.

## License

MIT. See [LICENSE](LICENSE).
