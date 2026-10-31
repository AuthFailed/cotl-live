#!/usr/bin/env bash
# Runs cotl-live on the real game on another PC over SSH, for testing. Reads .env (not in the repo):
#   COTL_SSH=user@host  COTL_KEY=~/.ssh/key  COTL_GAME_DIR=<game folder>  COTL_SAVES_DIR=<saves folder>
#   COTL_REFS=<a folder holding "Cult Of The Lamb_Data/Managed" and "BepInEx/core" copied from the game, to build against>
#
#   tools/test/game.sh start        build, back up the saves (once), install the plugin and the test helper, launch,
#                                   load slot 0 and wait in the cult; restores the backed-up saves first, so every run
#                                   starts from the same state
#   tools/test/game.sh crusade      start a crusade and wait until the Lamb is in it
#   tools/test/game.sh act JSON     POST /act, print the answer
#   tools/test/game.sh get PATH     GET a path (/status, /map, ...), print the answer
#   tools/test/game.sh shot FILE    save the game's screen
#   tools/test/game.sh stop         quit the game, put the saves back, remove the test helper (the plugin stays)
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=/dev/null  # local, not in the repo
source .env
: "${COTL_SSH:?}" "${COTL_KEY:?}" "${COTL_GAME_DIR:?}" "${COTL_SAVES_DIR:?}"
PORT=47820 URL=http://127.0.0.1:47820
q() { printf '%q' "$1"; }
SAVES=$(q "$COTL_SAVES_DIR") PLUGINS=$(q "$COTL_GAME_DIR/BepInEx/plugins")
SESSION='XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus'
pc() { ssh -n -o BatchMode=yes -i "$COTL_KEY" -o ConnectTimeout=15 "$COTL_SSH" "$@"; }
pc_in() { ssh -o BatchMode=yes -i "$COTL_KEY" -o ConnectTimeout=15 "$COTL_SSH" "$@"; }

tunnel() {
  curl -s -m 2 -o /dev/null "$URL/capabilities" 2>/dev/null && return 0
  pgrep -f "$PORT:127.0.0.1:$PORT" >/dev/null || ssh -f -N -o BatchMode=yes -o ExitOnForwardFailure=yes -i "$COTL_KEY" -L "$PORT:127.0.0.1:$PORT" "$COTL_SSH"
}

wait_for() {  # wait_for <python expression on the status dict s> <seconds>
  for _ in $(seq "$2"); do
    tunnel || true
    if curl -s -m 5 "$URL/status" 2>/dev/null | python3 -c "import json,sys; s=json.load(sys.stdin); sys.exit(0 if ($1) else 1)" 2>/dev/null; then return 0; fi
    sleep 1
  done
  echo "timed out waiting for: $1" >&2; return 1
}

case "${1:-}" in
  start)
    : "${COTL_REFS:?set COTL_REFS to build against the game}"
    mod/build.sh "$COTL_REFS/Cult Of The Lamb_Data/Managed" "$COTL_REFS/BepInEx/core"
    tools/test/build.sh "$COTL_REFS/Cult Of The Lamb_Data/Managed" "$COTL_REFS/BepInEx/core"
    pc "pkill -f '[C]ult Of The Lamb.exe'; sleep 5; true"
    # The first start keeps a copy of the saves; every later start (and stop) puts that copy back.
    pc "B=\$(cat /tmp/cotl-live-backup 2>/dev/null); if [ -z \"\$B\" ] || [ ! -d \"\$B\" ]; then B=~/cotl-live-saves-backup-\$(date +%Y%m%d-%H%M%S); cp -a $SAVES \"\$B\" && echo \"\$B\" > /tmp/cotl-live-backup && echo \"saves backed up to \$B\"; else cd $SAVES && rsync -a --delete \"\$B/\" ./ && echo \"saves reset from \$B\"; fi"
    pc_in "cat > $PLUGINS/CotlLive.dll" < mod/CotlLive.dll
    pc_in "cat > $PLUGINS/TestHelper.dll" < tools/test/TestHelper.dll
    pc "touch /tmp/cotl-live-load; $SESSION systemctl --user is-active -q cotl-live-awake || $SESSION systemd-run --user --collect --unit=cotl-live-awake systemd-inhibit --what=sleep:idle --who=cotl-live --why='Testing over SSH' --mode=block sleep 14400 >/dev/null"
    pc "$SESSION systemd-run --user --collect --unit=cotl-live-launch-\$(date +%s) --setenv=DISPLAY=:0 steam -applaunch 1313140 >/dev/null"
    wait_for "s['inBase']" 300
    sleep 12  # let the base finish spawning its buildings and followers
    echo "in the cult"
    ;;
  crusade)
    pc "touch /tmp/cotl-live-crusade"
    wait_for "s['inDungeon']" 120
    sleep 6
    echo "on a crusade"
    ;;
  act) tunnel; curl -s -m 10 -X POST "$URL/act" -H 'Content-Type: application/json' -d "$2"; echo ;;
  get) tunnel; curl -s -m 10 "$URL$2"; echo ;;
  shot) tunnel; curl -s -m 10 -o "$2" "$URL/screen" && echo "saved $2" ;;
  stop)
    pc "pkill -f '[C]ult Of The Lamb.exe'; sleep 6; rm -f $PLUGINS/TestHelper.dll /tmp/cotl-live-load /tmp/cotl-live-crusade"
    pc "B=\$(cat /tmp/cotl-live-backup 2>/dev/null) && [ -d \"\$B\" ] && cd $SAVES && rsync -a --delete \"\$B/\" ./ && (cd \"\$B\" && sha256sum *) | sha256sum -c --quiet && echo \"saves restored from \$B\" && rm /tmp/cotl-live-backup"
    pc "$SESSION systemctl --user stop cotl-live-awake 2>/dev/null; true"
    pkill -f "$PORT:127.0.0.1:$PORT" || true
    ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
