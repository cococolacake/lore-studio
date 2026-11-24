# Monsters and the party

## Monster maker

- Build creatures from a blank sheet, any of the 334 monsters in the free 5e rules (SRD 5.1, included), a creature in your Foundry world or compendiums (including monster books you own in Foundry), or a 5etools homebrew file, link or pasted creature.
- A live stat block, and a **challenge rating estimate** worked out the Dungeon Master's Guide way (hit points, AC, damage per round, attack bonus or save DC, legendary actions and resistance). Spells aren't counted, so check spellcasters by eye.
- **Scale it** to any challenge rating, or **to your party**: pick how hard the fight should be and how many of them, and Lore Studio works out the right CR from your party's levels. Hit points, AC, attack bonuses, save DCs and damage dice all move, and the monster keeps its character.
- **Send to Foundry** as a ready-to-use NPC with clickable attack and damage rolls (sending again updates it), or **Copy for a plan** to drop it into a session plan as a stat block.

## Encounter builder

Pick monsters (yours or from the free 5e rules), set how many of each, and a meter shows live how hard the fight is for your party, the Dungeon Master's Guide way. Copy it into a plan (summary, one-click Foundry links and stat blocks), send all its monsters to Foundry, and place their tokens, hidden, on the open scene. Tie it to a session and it's in Live mode with a **Place** button.

## Combat simulator

On any encounter, **Simulate the fight** runs it against your party hundreds or thousands of times and shows how it tends to go: how often the party wins, how many rounds it takes, and for each character how often they drop to 0 and how often they die, with their hit points left and damage dealt.

- **Characters come from Foundry.** When Foundry is connected, Lore Studio reads each linked character fresh: hit points, AC, saving throws, spell slots, how many attacks their Attack action makes, and every attack, damaging spell and heal on their sheet. A character with no linked sheet is estimated from their level and marked **est.**
- **Monsters come from their stat blocks**: attacks, Multiattack, recharge abilities, limited uses, legendary actions and Legendary Resistance, damage resistances and immunities.
- **Pick who's fighting**, how many runs, and your table's rules: how critical hits work (double dice, or max plus a roll), whether a natural 1 always misses, and whether characters start at full HP or as they are in Foundry right now.
- **Boss phases**: tick *One after another* and each monster in the list is fought in order, with the party keeping its hit points and spell slots between them. Put a boss's Phase 1 and Phase 2 in one encounter to see the whole fight.
- **Watch one fight** shows a round-by-round log, and **What the simulator leaves out** lists every ability it couldn't put a number on.

It's a rough model: everyone fights in one open space, and it skips movement, terrain, conditions, lair actions and spells that don't deal damage. Characters use their best damage each turn and heal a fallen friend when they can, which is more efficient than most tables. Use it to spot a fight that's much easier or much harder than the meter says.

## The party

- A page per player character: about the player, a backstory synopsis, and your plans for it (GM only, never in player recaps or the lore book).
- Link their Foundry character to see class, level, HP, AC and abilities. The party's levels feed **scale to my party**.
- **Fix hit points**: Lore Studio shows where a character's max HP comes from (each level-up, Constitution, bonuses, overrides), flags what's off (a level-up with no HP chosen, a bonus added to cover it), and writes the fix back to Foundry.
- **Features & scaling**: lists the character's scale values (what a die or number of uses is at each level, like an Exploit Die that's d6 at 2 and d8 at 7) and every feature's uses and formulas, read live from Foundry. It flags what imports from 5etools and homebrew often break: formulas pointing at a scale value that isn't on the sheet (often the wrong class identifier, like `@scale.fighter…` on an alternate fighter), and dice or uses typed in as fixed numbers. One click fixes each; you can also add or edit scale values level by level and edit any formula. Every fix can be undone.
