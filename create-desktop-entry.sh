#!/usr/bin/env bash
# Adds Lore Studio to your app menu (and to your Desktop folder, if you have one).
# Remove it again with:  ./create-desktop-entry.sh --remove
set -e
DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ENTRY="$APPS/lore-studio.desktop"
DESKTOP="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"

if [ "$1" = "--remove" ]; then
  rm -f "$ENTRY" "$DESKTOP/lore-studio.desktop"
  echo "Removed Lore Studio from your app menu."
  exit 0
fi

mkdir -p "$APPS"
cat > "$ENTRY" <<EOF
[Desktop Entry]
Type=Application
Name=Lore Studio
Comment=Plan, run and remember your tabletop campaign
Exec="$DIR/lore-studio.sh"
Path=$DIR
Icon=$DIR/web/assets/icon-512.png
Terminal=false
Categories=Game;Office;
StartupWMClass=lore-studio
EOF
chmod +x "$ENTRY"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true
echo "Added Lore Studio to your app menu."

if [ -d "$DESKTOP" ]; then
  cp "$ENTRY" "$DESKTOP/lore-studio.desktop"
  chmod +x "$DESKTOP/lore-studio.desktop"
  # GNOME wants desktop icons marked as trusted before they'll launch.
  command -v gio >/dev/null 2>&1 && gio set "$DESKTOP/lore-studio.desktop" metadata::trusted true 2>/dev/null || true
  echo "Added a shortcut to your Desktop too."
fi
