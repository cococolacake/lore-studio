"""A small made-up campaign, "The Sunken Crown", to try Lore Studio with (and to take screenshots of).

Everything here is invented placeholder content: John Doe the human fighter, Jane Roe the rogue, and friends.
"""
import json
from pathlib import Path

from . import campaign, maps, plans
from .util import write_json

DEMO_DIR = Path(__file__).resolve().parent / "demo"
NAME = "The Sunken Crown"

PAGES = [
    ("Characters", {"tags": ["character"]}, "Everyone the party has met so far.\n\n{{children}}\n"),
    ("Characters/John Doe", {"tags": ["character", "pc", "fighter"], "aliases": ["John"]},
     "A human fighter from [[Westmarch]]. Good with a shield, bad with secrets.\n\n"
     "> ### At a glance\n> **Player:** Sam\n> **Class:** Fighter 5\n> **Wants:** to pay off his family's debt to [[The Thieves' Guild]]\n\n"
     "## Story so far\nJohn signed on with [[The Lantern Watch]] after the bridge at [[Millbrook]] washed out. "
     "He carried [[Old Tobin]] out of the flood and hasn't stopped hearing about it since.\n\n"
     ":::gm\nThe guild's collector is already in [[Millbrook]], and he knows John's face.\n:::\n"),
    ("Characters/Jane Roe", {"tags": ["character", "pc", "rogue"], "aliases": ["Jane"]},
     "A half-elf rogue who grew up on the docks. She talks her way in and climbs her way out.\n\n"
     "**Player:** Alex. Keeps a list of every lock she has ever opened.\n"),
    ("Characters/Pip Thistlewood", {"tags": ["character", "pc", "wizard"], "aliases": ["Pip"]},
     "A gnome wizard who studies tides, drowned things and, lately, the [[The Sunken Crown|Sunken Crown]].\n\n"
     "**Player:** Lee. Pip's familiar is a very offended crab named Duchess.\n"),
    ("Characters/Mira Vance", {"tags": ["character", "npc", "lantern-watch"], "aliases": ["Mira", "Captain Vance"]},
     "Captain of [[The Lantern Watch]]. Calm, dry, never without her storm lantern.\n\n"
     ":::gm\nMira found the [[The Sunken Crown|crown]] ten years ago and threw it back into the sea. She hasn't told anyone why.\n:::\n"),
    ("Characters/Old Tobin", {"tags": ["character", "npc", "millbrook"], "aliases": ["Tobin"]},
     "Innkeeper of the Leaky Kettle in [[Millbrook]]. Knows everyone's business and charges extra for it.\n"),
    ("Locations", {"tags": ["location"]}, "{{children}}\n"),
    ("Locations/Westmarch", {"tags": ["location", "region"]},
     "A windy border region of fishing villages, salt marsh and old roads. [[Millbrook]] is its only market town.\n\n{{children}}\n"),
    ("Locations/Millbrook", {"tags": ["location", "town", "millbrook"]},
     "A market town where the river meets the road. Home of the Leaky Kettle and [[Old Tobin]].\n\n"
     ":::callout\nThe bridge washed out in session 1. The ferry costs a silver piece and a long wait.\n:::\n"),
    ("Locations/The Drowned Chapel", {"tags": ["location", "dungeon"]},
     "A chapel that sank into the bay a hundred years ago. At the lowest tides, its bell tower comes up out of the water.\n\n"
     ":::gm\nThe [[The Sunken Crown|Sunken Crown]] sits on the altar. Whoever wears it hears the drowned.\n:::\n"),
    ("Organizations", {"tags": ["organization"]}, "{{children}}\n"),
    ("Organizations/The Lantern Watch", {"tags": ["organization", "lantern-watch"]},
     "Westmarch's coast guard, led by [[Mira Vance]]. They keep the lighthouses lit and the smugglers honest, mostly.\n"),
    ("Organizations/The Thieves' Guild", {"tags": ["organization", "villain"]},
     "A polite, patient guild that always collects. [[John Doe]]'s family owes them more than a farm is worth.\n"),
    ("Items", {"tags": ["item"]}, "{{children}}\n"),
    ("Items/The Sunken Crown", {"tags": ["item", "artifact"], "aliases": ["the crown"]},
     "A crown of green bronze and pearl, lost with the [[The Drowned Chapel|chapel]].\n\n"
     ":::gm\nIt lets the wearer speak with anyone who drowned in the bay. Some of them want to come back.\n:::\n"),
]

LANDING = ("Welcome to **The Sunken Crown**, a demo campaign for Lore Studio. Everything here is made up, "
           "so poke at it freely: edit pages, open the map, read the session recaps, or check the loose threads.\n\n"
           "The party: [[John Doe]], [[Jane Roe]] and [[Pip Thistlewood]].\n\n{{sessions}}\n")

TRANSCRIPT = [
    ("GM", "The tide is going out fast. Where the bay was an hour ago there's mud, and in the middle of it, a bell tower."),
    ("Players 00", "I want to check the mud before anyone walks on it."),
    ("GM", "Give me a Survival check."),
    ("Players 00", "Seventeen."),
    ("GM", "There's a path of old flagstones under the mud. Someone walked it this morning, boots, heading out."),
    ("Players 01", "Footprints? Then someone got here first. I'll follow them, quietly."),
    ("Players 02", "Duchess is not coming in the mud. I'm carrying her."),
    ("GM", "The prints end at the tower door. It's open. Inside, stairs go down into dark water, and you hear a bell. Once."),
    ("Players 00", "Mira said the bell hasn't rung in a hundred years."),
    ("GM", "Mira, at the back, has gone very quiet. Her lantern is shaking."),
    ("Players 01", "Captain, you've been here before, haven't you?"),
    ("GM", "She says, “Ten years ago. I took something out of this place, and I put it back. We should leave.”"),
    ("Players 02", "Absolutely not. I cast detect magic."),
    ("GM", "Below you, under the water, something on the altar is glowing green. It's the brightest thing you've ever felt."),
    ("Players 00", "I go down the stairs. Shield up."),
    ("GM", "Roll initiative. The water starts moving, and three drowned sailors stand up out of it."),
    ("Players 01", "Twenty-two."),
    ("GM", "Jane, you're first. The nearest sailor has a guild tattoo on its wrist, the same one John's collector had."),
    ("Players 00", "Wait, the guild sent people down here?"),
    ("GM", "Ten minutes later: the last sailor goes down. The water is up to your knees and rising. You can grab the crown, or get out."),
    ("Players 02", "I grab the crown!"),
    ("Players 00", "Pip, no."),
    ("GM", "Pip's fingers close on it, and every drowned voice in the bay says his name at once. Let's stop there."),
]

GM_RECAP = """## Summary
The party walked out to the [[The Drowned Chapel|Drowned Chapel]] at low tide, followed someone else's footprints inside, \
fought three drowned sailors and came out with the [[The Sunken Crown|Sunken Crown]]. {t:00:00:05}

## What happened
- **The causeway.** [[John Doe|John]] found an old flagstone path under the mud (Survival 17) and fresh boot prints heading out. {t:00:00:41}
- **The bell.** The chapel bell rang once as they went in. [[Mira Vance|Mira]] admitted she took something from the chapel ten years ago and put it back. {t:00:02:10}
- **The fight.** Three drowned sailors rose from the flooded nave. One wore the [[The Thieves' Guild|guild]] tattoo. {t:00:03:30}
- **The crown.** [[Pip Thistlewood|Pip]] grabbed the crown as the tide came back, and every drowned voice in the bay said his name. {t:00:05:02}

:::gm
Mira knows exactly what the crown does. The guild sent the sailors (alive) last month, and the chapel kept them.
:::

## Loose ends
- Who walked out to the chapel this morning?
- Why does the guild want the crown?
"""

PLAYER_RECAP = """The tide went out, and the [[The Drowned Chapel|Drowned Chapel]] came up out of the bay.

Following a stranger's footprints across the mud, the party found the chapel door already open and heard its bell ring for \
the first time in a hundred years. Captain [[Mira Vance|Mira]] went pale: she had been here before.

Below the water, three drowned sailors stood up to stop them, one with a [[The Thieves' Guild|guild]] tattoo on its wrist. \
When the last one fell, [[Pip Thistlewood|Pip]] reached for the green glow on the altar, and every drowned voice in the bay \
said his name at once.

*Next time: what do the drowned want with Pip?*
"""

PLAN_4 = """---
title: Voices in the Water
eyebrow: The Sunken Crown · Session 4
lede: Pip can hear the drowned. Some of them are very interested in the party.
---

## Session at a glance {glance}
- Back in Millbrook | 15 min
- branch: The collector's offer | 20 min
- free: Free time at the Kettle | flex

:::cast
**The Lantern Watch** Mira Vance (captain). **Millbrook** Old Tobin (innkeeper). **The guild** the collector.
:::

## Back in Millbrook
:::read
The Leaky Kettle is warm, loud and smells of fish stew.
Old Tobin: "You lot look like you've been dragged up from the bottom of the bay."
~ Pip hears a whisper from the window. Wisdom save, DC 12.
:::

- **What Tobin knows.**
  > A man in a grey coat asked about you this morning.
  >> He paid in guild silver.

:::note
**Secret: the collector.** He wants the crown, not the debt. He'll forgive John's family everything for it.
:::

## The Collector's Offer
:::read
A man in a grey coat sits down at your table without asking.
The collector: "Mr Doe. Let's talk about your family's farm."
:::
"""


def create(path, name=NAME):
    """Make the demo campaign in an empty folder and return the Campaign."""
    camp = campaign.create(path, name)
    camp.write_page("index", {"title": f"Welcome to {name}"}, LANDING)
    folders = {pid.rpartition("/")[0] for pid, _, _ in PAGES}
    for pid, meta, body in PAGES:
        title = pid.rpartition("/")[2]
        camp.write_page(pid + "/index" if pid in folders else pid, {"title": title, **meta}, body)
    camp.save_info({"party": [{"character": "John Doe", "player": "Sam", "speaker": "Players 00"},
                              {"character": "Jane Roe", "player": "Alex", "speaker": "Players 01"},
                              {"character": "Pip Thistlewood", "player": "Lee", "speaker": "Players 02"}],
                    "recap_style": "Keep player recaps under 300 words. End with an italic one-line teaser."})

    s1 = camp.create_session("The Bridge at Millbrook", 1)
    camp.update_session(s1, {"date": "2026-10-03", "in_world_date": "1st of Deepwinter, 1042"})
    camp.write_session_text(s1, "recap", "The party met in [[Millbrook]] the night the bridge washed out. "
                            "[[John Doe|John]] carried [[Old Tobin]] out of the flood, and [[Mira Vance]] offered all three of them a job.\n")
    s2 = camp.create_session("Lanterns in the Fog", 2)
    camp.update_session(s2, {"date": "2026-10-10", "in_world_date": "4th of Deepwinter, 1042"})
    camp.write_session_text(s2, "recap", "Working for [[The Lantern Watch]], the party caught smugglers landing crates of guild silver, "
                            "and [[Pip Thistlewood|Pip]] worked out that the next low tide would uncover [[The Drowned Chapel]].\n")
    camp.write_player_recap(s2, "Smugglers, fog and a lot of guild silver. Next stop: the chapel under the bay.\n")

    s3 = camp.create_session("The Drowned Chapel", 3)
    camp.update_session(s3, {"date": "2026-10-17", "in_world_date": "6th of Deepwinter, 1042"})
    segs, t = [], 2.0
    for who, text in TRANSCRIPT:
        dur = 2.5 + len(text) / 18
        segs.append({"start": round(t, 2), "end": round(t + dur, 2), "speaker": who, "text": text})
        t += dur + 6
    write_json(camp.session_dir(s3) / "transcript.json",
               {"segments": segs, "speakers": {"Players 00": "John Doe", "Players 01": "Jane Roe", "Players 02": "Pip Thistlewood"},
                "duration": round(t, 1), "model": "large-v3-turbo", "created": "2026-10-17 23:40:00"})
    camp.write_recording(s3, {"path": "", "tracks": [{"index": 1, "role": "gm"}, {"index": 2, "role": "players", "voices": 3}],
                              "chapters": [{"time": "00:03:30", "name": "The drowned sailors"}]})
    camp.write_draft(s3, {"gm": GM_RECAP, "player": PLAYER_RECAP, "threads": {"new": 2, "suggestions": 1},
                          "truncated": [], "cost": 0.12, "model": "claude-sonnet-5-5",
                          "created": "2026-10-17 23:52", "usage": [{"input": 21400, "output": 2900, "cache_read": 0, "cache_write": 0}]})

    s4 = camp.create_session("Voices in the Water", 4)
    d4 = camp.session_dir(s4)
    (d4 / "plan.md").write_text(PLAN_4, encoding="utf-8")
    (d4 / "plan.html").write_text(plans.render(PLAN_4, name, 4), encoding="utf-8")

    debt = camp.add_thread("The debt to the Thieves' Guild", "John's family owes the guild more than their farm is worth.", "debt", session=s1)
    camp.add_thread("Who sent the smugglers?", "Crates of guild silver, landed at night under the lighthouse.", "question", session=s2)
    camp.add_thread("Mira's secret", "She took something from the chapel ten years ago and put it back.", "secret", session=s3, t="00:02:10")
    camp.add_thread("Who walked out to the chapel first?", "Fresh boot prints on the causeway, heading out.", "question",
                    status="proposed", session=s3, t="00:00:41")
    camp.add_thread("The bridge at Millbrook", "Washed out; the town is rebuilding it.", "hook", status="resolved", session=s1)
    threads = camp.threads()
    for th in threads:
        if th["id"] == debt:
            th["suggestion"] = {"type": "progress", "note": "A drowned sailor wore the guild's tattoo.", "session": s3}
    camp.save_threads(threads)

    world = maps.create(camp, "Westmarch", {"path": str(DEMO_DIR / "westmarch.png")}, page="Locations/Westmarch")
    for pin in ({"name": "Millbrook", "x": 0.555, "y": 0.6, "page": "Locations/Millbrook", "color": "#F59E0B"},
                {"name": "The Drowned Chapel", "x": 0.51, "y": 0.86, "page": "Locations/The Drowned Chapel", "color": "#3B82F6"},
                {"name": "Thornwood", "x": 0.29, "y": 0.55, "color": "#22C55E"},
                {"name": "Greyspine Hills", "x": 0.6, "y": 0.33, "color": "#9381FF"},
                {"name": "Smugglers' cove", "x": 0.86, "y": 0.62, "color": "#EF4444", "gm": True}):
        maps.save_pin(camp, world["id"], pin)
    return camp


if __name__ == "__main__":
    import sys
    c = create(sys.argv[1])
    print(json.dumps(c.stats()))
