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

> **Public beta (0.7).** Everything below works and is tested, but expect rough edges. [Report a bug](https://github.com/cococolacake/lore-studio/issues/new/choose) if you hit one.
> AI is optional: use Claude, a model on your own computer, or switch AI off entirely in **Settings → AI**.
> New here? On the welcome screen, **Try the demo campaign** builds *The Sunken Crown*, a small made-up campaign to click around in.

## What it does

**Lore vault**
- **Pages in a tree**, like LegendKeeper or a wiki. A page can have subpages.
- **Markdown editor** with live preview and `[[Page name]]` link autocomplete.
- **GM-only secrets**: put text in a `:::gm` block, or mark a whole page *GM only*. The eye button previews what players would see.
- **Automatic links**: the first mention of a page's name, an alias, or a character's first name becomes a link while you read. Your files aren't changed.
- **Mentioned in**: every page lists the pages and session recaps that mention it.
- **Tags**: tag pages and sessions, click a tag to see everything with it, or search `#character`. New pages inherit their parent's main tag. The AI can suggest tags for pages and for sessions (from their recap or plan); nothing is added until you approve it.
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
- Number, title, real date and in-world date for each session. Either can be one day or a range (a session played over two evenings, or one that covers several days in the world). Ranged sessions fill each of their days on the calendar and stretch across the timeline.

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

**Clocks, handouts, calendar, timeline and boards**
- **Clocks** track what factions and threats do off-screen: tick them between sessions or in play, with a note of what happened.
- **Handouts** (pictures, letters, posters) pop up on every player's screen in Foundry with one click, or post to Discord.
- **Boards**: mood boards and conspiracy walls. Paste or drop pictures, add sticky notes, lore page cards and links, and tie them together with strings. A board can belong to a page or a session (it shows in live mode).
- **Timeline**: lanes of events and spans on your calendar (world history, the party, each faction). Zoom from millennia to days, drag blocks to move or stretch them, double-click to add one; sessions with an in-world date appear on their own. LegendKeeper timelines come across on import.
- **Calendar**: build your world's own: any months, festival days outside the week, leap rules, eras, as many moons as you like with their phases, seasons, holidays and events. Date sessions on it, and advance "today" in play.

**Monster maker**
- Build creatures from a blank sheet, any of the 334 monsters in the free 5e rules (SRD 5.1, included), a creature in your Foundry world or compendiums (including monster books you own in Foundry), or a 5etools homebrew file, link or pasted creature.
- A live stat block, and a **challenge rating estimate** worked out the Dungeon Master's Guide way (hit points, AC, damage per round, attack bonus or save DC, legendary actions and resistance). Spells aren't counted, so check spellcasters by eye.
- **Scale it** to any challenge rating, or **to your party**: pick how hard the fight should be and how many of them, and Lore Studio works out the right CR from your party's levels. Hit points, AC, attack bonuses, save DCs and damage dice all move, and the monster keeps its character.
- **Send to Foundry** as a ready-to-use NPC with clickable attack and damage rolls (sending again updates it), or **Copy for a plan** to drop it into a session plan as a stat block.
- **Encounter builder**: pick monsters (yours or from the free 5e rules), set how many of each, and a meter shows live how hard the fight is for your party, the Dungeon Master's Guide way. Copy it into a plan (summary, one-click Foundry links and stat blocks), send all its monsters to Foundry, and place their tokens, hidden, on the open scene. Tie it to a session and it's in Live mode with a **Place** button.

**The party**
- A page per player character: about the player, a backstory synopsis, and your plans for it (GM only, never in player recaps or the lore book).
- Link their Foundry character to see class, level, HP, AC and abilities. The party's levels feed **scale to my party**.
- **Fix hit points**: Lore Studio shows where a character's max HP comes from (each level-up, Constitution, bonuses, overrides), flags what's off (a level-up with no HP chosen, a bonus added to cover it), and writes the fix back to Foundry.

**Foundry VTT bridge**
- A small Foundry module (v13–v14) that Lore Studio installs for you. While you play, rolls, chat, combat turns and scene changes are logged to the session, and they're used when drafting the recap.
- **Send to Foundry** turns a lore page or a player recap into a journal entry (GM-only blocks removed when players can see it).
- **From live mode**: roll Foundry's tables, look up monsters' stat blocks and drop their tokens on the scene, move the players to another scene, and play or stop music. Write `{actor:Goblin}`, `{table:Wild Magic}`, `{scene:The Cellar}`, `{sound:Rain}` or `{handout:Wanted poster}` in a plan, and they become one-click links while you run it.

**Connection graph**
- Every page (and session) as a dot, with a line wherever one mentions another. Colours follow tags; hide tags, highlight names, drag dots, click to open.
- **Link by tags** (on by default, switch it off in the side panel): each shared tag becomes a small ring joined by dashed lines to every page and session that has it. Click a ring to list them.

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
  <tr>
    <td><img src="docs/screenshots/calendar.png" alt="The in-world calendar with two moons"></td>
    <td><img src="docs/screenshots/timeline.png" alt="The timeline"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/clocks.png" alt="Faction clocks"></td>
    <td><img src="docs/screenshots/handouts.png" alt="Handouts"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/monsters.png" alt="The monster maker"></td>
    <td><img src="docs/screenshots/party.png" alt="A character on the Party page"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/encounter.png" alt="The encounter builder"></td>
    <td></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/boards.png" alt="An inspiration board"></td>
    <td><img src="docs/screenshots/chat.png" alt="Chat with the AI"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/playersite.png" alt="Player lore book settings"></td>
    <td><img src="docs/screenshots/lorebook.png" alt="The player lore book website"></td>
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
  monsters/                your monsters, one .json each
  encounters/              encounters you built
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

### Backing up and moving computers

**Settings → Campaign → Export everything** packs the whole campaign into one .zip: every lore page, session (plans, transcripts, recaps, live notes, Foundry logs), map, monster, encounter, board, handout, the calendar, timeline, clocks, threads, chats and the party, plus Lore Studio's settings and themes. API keys, passwords and Discord webhooks are left out unless you tick them in, and session recordings (usually large) are optional. **Restore a backup** (on the welcome screen or in Settings → Campaign) unpacks it into a new folder and opens it; nothing is ever overwritten.

## Privacy

Lore Studio runs on your computer. There are no accounts, no tracking and no telemetry. It only goes online when you ask it to:

| What | When | Where it goes |
| --- | --- | --- |
| Transcripts, matching lore pages and recent recaps | You draft a recap, check for loose threads, suggest a scene or tags, or chat | **Claude:** Anthropic's API, under [Anthropic's commercial terms](https://www.anthropic.com/legal/commercial-terms). **A local model:** nowhere; it stays on your computer or network. **AI off:** nothing is sent. |
| Recordings | Never | Transcription runs on your own GPU or CPU. Speaker detection downloads its models from Hugging Face once. |
| A recap or handout | You press **Post** in the Discord preview | The Discord channel you picked |
| Pages, recaps and handouts | You press **Send to Foundry** | Your Foundry world, through the bridge on your own computer |
| Map and header images | You import from LegendKeeper or paste an image link | Downloaded from where they're hosted, once, into your campaign folder |
| The player lore book | You upload it yourself | Wherever you host it. GM-only content is removed first. |

API keys and passwords stay in Lore Studio's settings on your computer, never in your campaign folder. See [SECURITY.md](SECURITY.md).

## Install

You need **Python 3.10 or newer** ([python.org](https://www.python.org/downloads/); on Windows, tick *Add python.exe to PATH*).

Download **lore-studio-<version>.zip** from the [latest release](https://github.com/cococolacake/lore-studio/releases/latest) and unzip it anywhere. Or clone the repo.

**Windows:** double-click `Install.bat`, then `Lore Studio.bat`. `Create desktop shortcut.bat` adds a desktop icon.

**Linux:** `./install.sh`, then `./lore-studio.sh`. `./create-desktop-entry.sh` adds it to your app menu.

Prefer your browser? Run `python main.py --browser`.

To update, download the new release and unzip it over the old folder (or `git pull`). Your campaigns live in their own folders and your settings in your user folder, so nothing is lost.

### Foundry VTT

Lore Studio can install the bridge module for you (**Settings → Foundry**). To install it from inside Foundry instead, go to **Add-on Modules → Install Module** and paste this manifest URL:

```
https://github.com/cococolacake/lore-studio/releases/latest/download/module.json
```

## Roadmap

| Phase | What | Status |
| --- | --- | --- |
| 1. Foundation | App shell, lore vault, tags, graph, sessions, LegendKeeper import | ✅ Done |
| 2. Record to recap | GPU transcription (faster-whisper) with speaker labels from OBS tracks, AI recaps and loose threads, post recaps to Discord with a preview | ✅ Done |
| 3. Plan and play | Markdown session plans rendered to HTML, live mode, Foundry VTT bridge, interactive maps with pins, demo campaign | ✅ Done |
| 4. More to play with | Calendar, timeline, faction clocks, handouts, inspiration boards, chat, AI tag suggestions, player lore book | ✅ Done |
| 5. Public beta | Release downloads, Foundry install URL, AI switch, monster maker, encounter builder, party page, feedback | 🚧 Now |

## Development

```
python -m pytest -q tests          # tests (the pipeline test needs ffmpeg + PyAV; no GPU or API key needed)
python main.py --browser --debug   # run with dev tools
```

To release: bump the version in `studio/__init__.py` and `foundry/lore-studio-bridge/module.json`, add `docs/release-notes/<version>.md`,
then run the **release** workflow from the Actions tab (or push a `v<version>` tag).

The front end is plain HTML, CSS and JavaScript (no build step): `web/js/pages/` has one file per page.
The backend is `studio/`: `campaign.py` (the folder), `legendkeeper.py` (the importer), `api.py` (what the UI calls),
`transcription.py` + `workers/transcribe.py` (the GPU worker, run in its own venv), `recaps.py` + `claude.py` (drafts),
`discord.py` (webhooks), `obs.py` (a small obs-websocket v5 client), `maps.py`, `plans.py` (Markdown plans → HTML),
`foundry.py` + `foundry/lore-studio-bridge/` (the Foundry module) and `demo.py` (the demo campaign).
Claude, local models, Discord, OBS and Foundry use only the standard library.

## Contributing

Bug reports and ideas are very welcome: [open an issue](https://github.com/cococolacake/lore-studio/issues/new/choose), and include **Settings → About → Copy diagnostics** for bugs.
Questions go in [Discussions](https://github.com/cococolacake/lore-studio/discussions). For code, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).

The monsters in `studio/data/srd-monsters.json` are from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC,
available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the
[Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/legalcode).
The data was converted from the [5e-bits/5e-database](https://github.com/5e-bits/5e-database) project (MIT).
