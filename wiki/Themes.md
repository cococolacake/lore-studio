# Themes

Everything here is in **Settings → Appearance**, and changes apply right away.

## Glass themes

- **Themes:** Default, Cool Glass, Warm Glass, Lilac and Heart Glass, in light and dark (Lilac is light only).
- **Glass effects:** Efficient (the default), Full or Off.
- Pick the font, and **Save as theme** keeps your mix.

## CSS themes

Drag a `.css` file anywhere onto **Settings → Appearance** (or click the drop zone to choose one), and it's installed and switched on. It's saved in Lore Studio's data folder, so updates never touch it, and it's included in backups. Switch between your CSS themes, turn them off or delete them in the same card. Picking one of the built-in themes turns the CSS theme off.

Session notes inside the app (the plan preview and live mode) use the theme too, CSS theme included. To style them on their own, start a rule with `html[data-notes]`, for example `html[data-notes] .read { border-radius: 0; }`. Saved and printed notes keep their usual look.

## Your own styles

`web/css/custom.css` is loaded last, so anything you put there wins, even over a CSS theme.
