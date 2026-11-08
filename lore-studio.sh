#!/usr/bin/env bash
# Start Lore Studio on Linux.  ./lore-studio.sh            app window
#                              ./lore-studio.sh --browser  open in your web browser
#                              ./lore-studio.sh --debug    app window with dev tools
cd "$(dirname "$(readlink -f "$0")")"
if [ ! -x .venv/bin/python ]; then
  echo "Lore Studio isn't set up yet. Run ./install.sh first."
  exit 1
fi
exec .venv/bin/python main.py "$@"
