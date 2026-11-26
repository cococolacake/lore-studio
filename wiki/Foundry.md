# Foundry

## The bridge module

A small Foundry module (v13–v14) that Lore Studio installs for you (**Settings → Foundry**). To install it from inside Foundry instead, go to **Add-on Modules → Install Module** and paste this manifest URL:

```
https://github.com/cococolacake/lore-studio/releases/latest/download/module.json
```

- While you play, rolls, chat, combat turns and scene changes are logged to the session, and they're used when drafting the recap.
- **Send to Foundry** turns a lore page or a player recap into a journal entry (GM-only blocks removed when players can see it).
- Monsters, encounters and player characters work with Foundry too. See [Monsters and the party](Monsters-and-the-party).

## From live mode

Roll Foundry's tables, look up monsters' stat blocks and drop their tokens on the scene, move the players to another scene, and play or stop music. Write `{actor:Goblin}`, `{table:Wild Magic}`, `{scene:The Cellar}`, `{sound:Rain}` or `{handout:Wanted poster}` in a plan, and they become one-click links while you run it.

### Music

The **Sounds** tab lists your Foundry playlists and their tracks.

- **Now playing.** Whatever the players hear shows at the top of the Foundry panel, on every tab, with previous, pause, next and stop buttons and a volume slider. Pausing a track and playing it again picks up where it left off.
- **Preview.** The headphones button next to a track plays it for you only, so you can check it before the players hear it. It plays in Lore Studio with a progress bar you can drag. If Lore Studio can't reach the file, it plays in your Foundry tab instead, still only for you.
- **Play mode.** Each playlist has a menu for how it plays: in order, shuffle, soundboard (tracks play only when you pick them) or all at once.

These need version 0.12.0 or newer of the Lore Studio Bridge module. Update it in Foundry, or reinstall it from Settings → Foundry.

## Downloading music

**Settings → Foundry → Music** downloads YouTube links as mp3s, ready to add to a Foundry playlist. Paste one link per line and click **Download**. Links that don't work stay in the box so you can fix them and try again.

- The files go in **Save mp3s in**. Pick a folder inside Foundry's Data folder (by default `Data/assets/Music`) so Foundry can play them.
- Tick the playlist box to download a whole YouTube playlist into a folder named after it. Otherwise only the one video is downloaded.
- It needs two free tools. **yt-dlp** does the downloading, and Lore Studio can install it for you. **ffmpeg** makes the mp3s: on Windows, open PowerShell and run `winget install Gyan.FFmpeg`; on Linux, install it with your package manager.
- Only download music you're allowed to use.

## Scenery

The bridge also runs your scenery, with or without Lore Studio open. Put scenery scenes in a scene folder called **Static Scenery** (you can change the name in Module Settings). Each part can be switched off in Module Settings.

- **Fit to 1920×1080.** Scenery scenes are sized to 1920×1080 with no grid, and the background fills the screen with the edges cropped. Your image files aren't changed.
- **Time of day.** Name the images like `canyon_dawn.webp`, `canyon_day.webp`, `canyon_dusk.webp` and `canyon_night.webp`, in the same folder, and set the scene to any one of them. The background follows Calendaria's clock and its sunrise and sunset, and crossfades on every screen when it changes. You don't need all four: a missing dawn or dusk uses day, and a missing night uses dusk, then day.
- **Time-of-day sounds.** Sounds named the same way (`forest_day.ogg`, `forest_night.ogg`) switch too: ambient sounds placed on the scene, and playlist sounds that are playing.
- **Scenery sounds.** In Module Settings → **Scenery sounds**, list your sounds (Rain, Forest, Wind...), then choose which one plays for each kind of weather and which one loops on each scene. They fade in and out for everyone and follow each player's Ambient volume.
- **Weather.** With FXMaster, Calendaria's weather plays on scenery scenes: rain, storms, snow, hail, fog, clouds and embers, plus sandstorms with FXMaster+. **Weather strength** sets how strong they are (40% by default). Turn on **Weather effects on every scene** to get it on battle maps too.
- **Scenery mode.** On scenery scenes, players see just the picture: no scene controls or token HUD, and the view stays fitted to their screen.
- **From Lore Studio.** The map button on a lore page shows the players that place, crossfading into it. Lore Studio picks the scene named like the page, or asks which one and remembers it. Scenery scenes in live mode crossfade the same way.
- **In recaps.** The session log notes where the party was, the time of day and the weather, so recaps can say where things happened.
