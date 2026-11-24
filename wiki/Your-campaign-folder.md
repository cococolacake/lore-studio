# Your campaign folder

A campaign is a plain folder:

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

## Editing with other tools

You can edit these files with other tools while Lore Studio is open, such as Obsidian, a text editor, or an AI assistant with the folder connected. Lore Studio notices, tells you which page or session changed, and offers to refresh. The refresh button in the sidebar redraws the current page from disk at any time, and it asks first if you have unsaved edits. Turn the notifications off in **Settings → Reading**.

Back it up, sync it, or put it in git like any folder.

## Backing up and moving computers

**Settings → Campaign → Export everything** packs the whole campaign into one .zip: every lore page, session (plans, transcripts, recaps, live notes, Foundry logs), map, monster, encounter, board, handout, the calendar, timeline, clocks, threads, chats and the party, plus Lore Studio's settings, themes and CSS themes. API keys, passwords and Discord webhooks are left out unless you tick them in, and session recordings (usually large) are optional.

**Restore a backup** (on the welcome screen or in **Settings → Campaign**) unpacks it into a new folder and opens it; nothing is ever overwritten.
