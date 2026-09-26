#!/bin/sh
# Boot a NABU in MAME against the headless adaptor, run timed steps, and
# save the logs and screenshots. See README.md.
#
# usage: tools/mame/run.sh <name> <directory> [imageName] <steps>
set -e

if [ $# -lt 3 ]; then
  echo "usage: $0 <name> <directory> [imageName] <steps>" >&2
  exit 2
fi
NAME=$1 DIR=$2
if [ $# -ge 4 ]; then IMG=$3 STEPS=$4; else IMG= STEPS=$3; fi

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
OUT=${NABU_MAME_OUT:-$HERE/out}
ROMS=${NABU_MAME_ROMS:-$REPO/mame/roms}
PORT=${NABU_MAME_PORT:-5827}

mkdir -p "$OUT"
# Bundle the adaptor, since Node can't load the app's extensionless imports.
(cd "$REPO" && npx rolldown "$HERE/adaptor.js" -o "$OUT/adaptor.mjs" -p node -f esm >/dev/null)

# A fresh copy of the MAME config each run; MAME rewrites it on exit.
rm -rf "$OUT/$NAME" && mkdir -p "$OUT/$NAME/cfg"
cp "$HERE/cfg/nabupc.cfg" "$OUT/$NAME/cfg/"

node "$OUT/adaptor.mjs" "$PORT" "$DIR" "$IMG" "$OUT/$NAME/adaptor.log" &
ADAPTOR=$!
trap 'kill $ADAPTOR 2>/dev/null' EXIT
sleep 0.5

# The dummy SDL drivers keep MAME from opening a window.
SDL_VIDEO_DRIVER=dummy SDL_VIDEODRIVER=dummy \
SDL_AUDIO_DRIVER=dummy SDL_AUDIODRIVER=dummy \
NABU_STEPS="$STEPS" mame nabupc -rompath "$ROMS" \
  -cfg_directory "$OUT/$NAME/cfg" -nvram_directory "$OUT/$NAME/nvram" \
  -snapshot_directory "$OUT/$NAME" -snapname "snap/%i" \
  -video none -sound none -window -skip_gameinfo -nomouse \
  -hcca null_modem -bitb "socket.127.0.0.1:$PORT" \
  -autoboot_script "$HERE/steps.lua" > "$OUT/$NAME/mame.log" 2>&1 || true

ls "$OUT/$NAME/snap"/*.png 2>/dev/null || echo "no snapshots; see $OUT/$NAME/mame.log" >&2
