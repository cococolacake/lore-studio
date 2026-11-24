# Getting started

## Install

You need **Python 3.10 or newer** ([python.org](https://www.python.org/downloads/); on Windows, tick *Add python.exe to PATH*).

Download **lore-studio-&lt;version&gt;.zip** from the [latest release](https://github.com/cococolacake/lore-studio/releases/latest) and unzip it anywhere. Or clone the repo.

**Windows:** double-click `Install.bat`, then `Lore Studio.bat`. `Create desktop shortcut.bat` adds a desktop icon.

**Linux:** `./install.sh`, then `./lore-studio.sh`. `./create-desktop-entry.sh` adds it to your app menu.

Prefer your browser? Run `python main.py --browser`.

## First steps

On the welcome screen, **Try the demo campaign** builds a small made-up campaign to click around in. You can also start a new campaign, open a campaign folder, import from LegendKeeper (see [Lore and maps](Lore-and-maps#import-from-legendkeeper)), or restore a backup (see [Your campaign folder](Your-campaign-folder#backing-up-and-moving-computers)).

For Foundry VTT, Lore Studio installs its bridge module for you in **Settings → Foundry**. See [Foundry](Foundry).

AI is optional. Use Claude with your own API key, a model on your own computer, or switch AI off in **Settings → AI**. See [AI](AI).

## Updating

Download the new release and unzip it over the old folder (or `git pull`). Your campaigns live in their own folders and your settings in your user folder, so nothing is lost.

What changed in each version is on the [Releases](https://github.com/cococolacake/lore-studio/releases) page.

## Bugs and ideas

[Open an issue](https://github.com/cococolacake/lore-studio/issues/new/choose), and include **Settings → About → Copy diagnostics** for bugs. Questions go in [Discussions](https://github.com/cococolacake/lore-studio/discussions).
