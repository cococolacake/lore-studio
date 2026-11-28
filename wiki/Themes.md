# Themes

Everything here is in **Settings → Appearance**, and changes apply right away.

## Glass themes

- **Themes:** Default, Cool Glass, Warm Glass, Lilac and Heart Glass, in light and dark (Lilac is light only).
- **Glass effects:** Efficient (the default), Full or Off.
- Pick the font, and **Save as theme** keeps your mix.

## CSS themes

Drag a `.css` file anywhere onto **Settings → Appearance** (or click the drop zone to choose one), and it's installed and switched on. It's saved in Lore Studio's data folder, so updates never touch it, and it's included in backups. Switch between your CSS themes, turn them off or delete them in the same card. Picking one of the built-in themes turns the CSS theme off.

Session notes inside the app (the plan preview and live mode) use the theme too, CSS theme included. To style them on their own, start a rule with `html[data-notes]`, for example `html[data-notes] .read { border-radius: 0; }`. Saved and printed notes keep their usual look.

## Theme values a CSS theme can set

Set these inside `html[data-style][data-family][data-base] { }` and the whole app follows, session notes included. For dark mode only, use `html[data-style][data-family][data-base="dark"]`. A plain `:root` rule loses to the built-in colours, so colours and fonts set there are ignored.

- **Colours:** `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--text`, `--text-2`, `--text-3`, `--line`, `--accent`, `--accent-text`, `--accent-soft`, and the status colours `--good`, `--warn`, `--bad` and `--info`.
- **Corners:** `--r-xs` (tiny bits like checkboxes), `--r-sm`, `--r-md`, `--r-lg`, `--r-xl` and `--pill`. Set them all to `0` for square corners everywhere.
- **Fonts:** `--font` (body text), `--font-display` (headings) and `--mono`.
- **Category colours:** `--cat-1` to `--cat-8` colour things by kind: graph dots, relationship lines, stats charts, encounter difficulty and calendar chips. Each slot is a hue: 1 red, 2 orange, 3 yellow, 4 green, 5 teal, 6 blue, 7 purple, 8 pink. Unset slots keep their usual colours.

Colours you pick yourself (timeline lanes, clocks, map pins, board notes, calendar events) stay as you picked them.

## Your own styles

`web/css/custom.css` is loaded last, so anything you put there wins, even over a CSS theme.
