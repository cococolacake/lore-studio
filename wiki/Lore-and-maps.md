# Lore and maps

## Lore vault

- **Pages in a tree**, like LegendKeeper or a wiki. A page can have subpages.
- **Markdown editor** with live preview and `[[Page name]]` link autocomplete.
- **GM-only secrets**: put text in a `:::gm` block, or mark a whole page *GM only*. The eye button previews what players would see.
- **Automatic links**: the first mention of a page's name, an alias, or a character's first name becomes a link while you read. Your files aren't changed.
- **Mentioned in**: every page lists the pages and session recaps that mention it.
- **Tags**: tag pages and sessions, click a tag to see everything with it, or search `#character`. New pages inherit their parent's main tag. The AI can suggest tags for pages and for sessions (from their recap or plan); nothing is added until you approve it.
- **Search** across pages and session recaps.
- **Header images**: give any page a banner (choose a file, paste one, drop one in, or use a link) and drag it to choose which part shows. Images are copied into the campaign folder, and LegendKeeper banners are downloaded on import.

How pages are stored is on [Your campaign folder](Your-campaign-folder).

## Maps

- Upload a map image and drop **pins** on it. A pin can open a lore page, open another map (a region inside the world map), or both. GM-only pins stay hidden in the player view.
- Pan and zoom with the mouse; every page lists the maps it's pinned on. LegendKeeper maps and pins come across on import.

## Connection graph

- Every page (and session) as a dot, with a line wherever one mentions another. Colours follow tags; hide tags, highlight names, drag dots, click to open.
- **Link by tags** (on by default, switch it off in the side panel): each shared tag becomes a small ring joined by dashed lines to every page and session that has it. Click a ring to list them.
- **Relationships** show as coloured curves (see below), with their own legend.
- **Around this page**: the graph button on a lore page opens the graph showing only what's within one or two steps of it.
- **As of session N**: only the sessions up to then and the pages their recaps mention, so you can see what the party knew by that point.
- **Dots stay where you drag them.** Double-click a dot to let it move again, or use the ✕ button to free them all.
- **Look**: dot size by number of links or all equal, names always / automatically / on hover, shapes by kind (places ◆, groups ▲, sessions ■), and sliders for spacing and how tightly tags pull their pages together. Click a tag's dot in the legend to pick its colour.
- **Save as a picture**: the download button saves a PNG in the campaign's `exports` folder.

## Relationships

On a lore page, the **Relationships** card lists who the page is tied to and how: ally, friend, family, romance, rival, enemy, member of, serves, owes, or just linked. Click **+** to add one. It's saved on that page (as `relations: ["rival: Jane Roe"]` in its frontmatter, so it works in Obsidian too) and shows on both pages, reading the right way round from each ("Serves" on one, "Served by" on the other).

## Import from LegendKeeper

Export your LegendKeeper project as JSON and import it. Pages keep their tree, order, tags and banners; secret blocks become GM-only blocks; the Campaign Log becomes sessions; maps keep their pins; calendars and timelines are kept for later. Pages are tagged automatically from where they sit (Characters → `#character`, a region's places → `#location #westmarch`).
