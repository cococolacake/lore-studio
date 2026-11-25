# Sessions

- One folder per session: recap, player recap, plan, recording, transcript and notes (see [Your campaign folder](Your-campaign-folder)).
- Number, title, real date and in-world date for each session. Either can be one day or a range (a session played over two evenings, or one that covers several days in the world). Ranged sessions fill each of their days on the calendar and stretch across the timeline.

## Plan a session

- Write the plan in **Markdown** with a few extra blocks (read-aloud text with NPC lines and checks, NPC quotes, secrets, a cast list, a timed "at a glance" flow), and Lore Studio renders the session notes page in your theme as you type.
- **Open threads, right there**: above the plan, Lore Studio lists the open loose threads that involve the people and places your plan mentions. **Add to plan** drops a GM note about one at the cursor.
- **Previously on** pulls in the last recap, **Carry over** brings unplayed scenes forward, and **Suggest a scene** asks the AI for one that fits the lore and open threads.
- Already have HTML notes? Import them and keep editing as Markdown.
- Foundry links like `{actor:Goblin}` become one-click buttons while you run the plan. See [Foundry](Foundry#from-live-mode).

## Run it (live mode)

- One scene at a time, big and readable, with next/previous, a scratchpad for quick notes and a lore lookup.
- What you tick and note during play goes into the recap draft along with the transcript.
- **People here**: the NPCs the current scene mentions show as cards with their look, voice, what they want and their secret. Click the pencil to fill them in (they're saved on the NPC's page; the secret is GM-only), and the star to pin anyone else for the session.
- **Random tables**: tag a lore page `#table` and each list item is one result. Roll it from live mode; dice like `2d6` are rolled, `[[Another table]]` rolls that table too, and a plan's `{table:Name}` link rolls the matching table, with or without Foundry. Add a roll to the scratchpad with one click.

## Record → transcript → recap

- **OBS control**: start recording from the session page, mark named moments (they become chapters in a Hybrid MP4), stop. The recording is attached and transcribed automatically.
- **Transcription on your GPU** with faster-whisper (`large-v3-turbo`), in its own environment that the app installs for you. Works on any video or audio file.
- **Who said what**: with your mic and Discord on separate OBS audio tracks, every line is labelled *GM* or *Players*. Optional speaker detection (pyannote community-1) tells the players apart; name each voice once per session.
- **Spotlight**: who talked how much, as bars above the transcript, with each player's share of the players' talk time. Handy for noticing a quiet player. **Home → Campaign → Stats** adds it up across sessions, along with hours recorded, the pages your recaps mention most, and threads opened and resolved per session.
- **Your names, spelled right**: character and place names from the lore are passed to Whisper as hints.
- **The AI drafts the recap**, and finds loose threads. See [AI](AI).

## Post to Discord

Post a recap through a webhook, with a preview that looks like Discord, your edits, and a confirmation. Choose the name, avatar, colour, title, footer, role ping and spoiler tags.
