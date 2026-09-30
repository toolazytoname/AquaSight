#!/bin/sh
# Requires librsvg (rsvg-convert). Run from the repository root.
set -eu
master=docs/design/logo-concepts/ponder-app-icon.svg
python3 - <<'PYTHON'
from pathlib import Path
source = Path('docs/design/logo-concepts/ponder-app-icon.svg').read_text()
Path('web/icon.svg').write_text(source.replace('height="64" fill=', 'height="64" rx="14" fill='))
PYTHON
rsvg-convert -w 1024 -h 1024 "$master" -o clients/ios/AquaSight/Assets.xcassets/AppIcon.appiconset/icon-1024.png
rsvg-convert -w 180 -h 180 "$master" -o web/apple-touch-icon.png
rsvg-convert -w 192 -h 192 "$master" -o web/icon-192.png
rsvg-convert -w 512 -h 512 "$master" -o web/icon-512.png
