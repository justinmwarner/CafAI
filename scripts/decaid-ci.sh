#!/usr/bin/env bash
# Start Decaid's Linux release headless, with a simulated machine and scale,
# for CafAI's checks against a real Decaid (spec 4.4): npm run test:decaid and
# npm run e2e:real. Linux only (CI, or a Linux computer); on Windows start the
# simulator as docs/SIMULATOR.md says.
#
#   bash scripts/decaid-ci.sh         download, start, wait until the machine and the scale are connected
#   bash scripts/decaid-ci.sh stop    stop it and gather its logs
#
# Env:
#   DECAID_TAG        a Decaid release tag (v0.8.8), or latest (the default)
#   GH_TOKEN          optional: lets gh, or the GitHub API, name the latest release without a rate limit
#   DECAID_SKIN_PATH  the skin Decaid serves on :3000 (default: this repository's dist/, from npm run build)
#
# Decaid's API answers on http://localhost:8080 and the skin on http://localhost:3000.
# Everything else lives in $RUNNER_TEMP/decaid-ci (or /tmp/decaid-ci): the
# download, the app, a fresh profile per start (XDG folders), the log and logs/.
set -euo pipefail

REPO=decentespresso/decaid
API=http://localhost:8080
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${RUNNER_TEMP:-/tmp}/decaid-ci"
PIDFILE="$WORK/decaid.pid"
LOG="$WORK/decaid.log"
SKIN_PATH="${DECAID_SKIN_PATH:-$ROOT/dist}"
# The runtime libraries Decaid's own PR job installs (.github/workflows/pr-checks.yml, "Linux build smoke").
PACKAGES=(libgtk-3-dev libsecret-1-dev xvfb)
READY_S=60
CONNECT_S=60

say() { echo "decaid-ci: $*"; }
die() {
  echo "decaid-ci: $*" >&2
  exit 1
}

# Copy Decaid's output and its own log files to $WORK/logs, for the workflow to keep.
collect_logs() {
  mkdir -p "$WORK/logs"
  if [ -f "$LOG" ]; then cp "$LOG" "$WORK/logs/"; fi
  if [ -d "$WORK/xdg" ]; then
    find "$WORK/xdg" -type f \( -name '*.log' -o -name 'log*.txt' \) -exec cp {} "$WORK/logs/" \; 2>/dev/null || true
  fi
}

stop() {
  if [ -f "$PIDFILE" ]; then
    local pid
    pid="$(cat "$PIDFILE")"
    # Its own process group (setsid): xvfb-run, Xvfb and Decaid go together.
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 -- "-$pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -KILL -- "-$pid" 2>/dev/null || true
    rm -f "$PIDFILE"
    say "stopped Decaid"
  else
    say "Decaid is not running"
  fi
  collect_logs
}

install_runtime() {
  if dpkg -s "${PACKAGES[@]}" >/dev/null 2>&1; then return 0; fi
  command -v apt-get >/dev/null 2>&1 || die "Decaid needs ${PACKAGES[*]} (or their runtime libraries): install them first."
  local sudo=()
  if [ "$(id -u)" -ne 0 ]; then sudo=(sudo); fi
  say "installing ${PACKAGES[*]}"
  ${sudo[@]+"${sudo[@]}"} apt-get update
  ${sudo[@]+"${sudo[@]}"} apt-get install -y "${PACKAGES[@]}"
}

# The latest release's tag: gh when it can, else the API; empty when neither answers.
latest_tag() {
  if command -v gh >/dev/null 2>&1 && gh release view -R "$REPO" --json tagName -q .tagName 2>/dev/null; then return 0; fi
  local token="${GH_TOKEN:-${GITHUB_TOKEN:-}}" auth=()
  if [ -n "$token" ]; then auth=(-H "Authorization: Bearer $token"); fi
  curl -fsSL ${auth[@]+"${auth[@]}"} "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null |
    node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { try { console.log(JSON.parse(s).tag_name || ""); } catch { console.log(""); } });' ||
    true
}

# Download the release's Linux tarball into $WORK/download, check it against the
# release's SHA256SUMS when it has one, and unpack it into $WORK/app.
download() {
  local tag="$1" version base asset sums
  if [ "$tag" = latest ]; then
    # Every release carries -latest copies of its assets (decaid's scripts/create_release_aliases.sh).
    base="https://github.com/$REPO/releases/latest/download"
    asset=decaid-linux-x64-latest.tar.gz
    sums=decaid-latest-SHA256SUMS.txt
  else
    version="${tag#v}"
    base="https://github.com/$REPO/releases/download/$tag"
    asset="decaid-linux-x64-$version.tar.gz"
    sums="decaid-$version-SHA256SUMS.txt"
  fi
  rm -rf "$WORK/download" "$WORK/app"
  mkdir -p "$WORK/download" "$WORK/app"
  say "downloading $base/$asset"
  curl -fsSL --retry 3 -o "$WORK/download/$asset" "$base/$asset" || die "could not download $base/$asset"
  if curl -fsSL --retry 3 -o "$WORK/download/$sums" "$base/$sums"; then
    (cd "$WORK/download" && sha256sum --check --ignore-missing --strict "$sums") || die "$asset does not match (or is not in) the release's $sums"
  else
    say "warning: the release has no $sums, so the download is not checked"
  fi
  # On stdin: GNU tar reads an archive name with a colon in it as host:file.
  tar -xz -C "$WORK/app" <"$WORK/download/$asset"
  [ -x "$WORK/app/bundle/decaid" ] || die "$asset has no bundle/decaid"
}

# Exit status 0 when a devices list on stdin has a connected machine and a connected scale.
both_connected() {
  node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let list = [];
      try { list = JSON.parse(s); } catch {}
      const on = (type) => Array.isArray(list) && list.some((d) => d && d.type === type && d.state === "connected");
      process.exit(on("machine") && on("scale") ? 0 : 1);
    });'
}

running() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

# The simulated machine and scale (applied at the next scan), and no update checks against GitHub.
simulate() {
  curl -fsS -o /dev/null --max-time 10 -X POST -H 'Content-Type: application/json' \
    -d '{"simulatedDevices":["machine","scale"],"automaticUpdateCheck":false}' \
    "$API/api/v1/settings"
}

# A start that fails says why, shows Decaid's last words and leaves nothing running.
on_start_exit() {
  local status="$1"
  [ "$status" -eq 0 ] && return 0
  if [ -f "$LOG" ]; then
    echo "decaid-ci: the last 200 lines of Decaid's log:" >&2
    tail -n 200 "$LOG" >&2 || true
  fi
  stop >&2 || true
}

start() {
  [ -f "$SKIN_PATH/index.html" ] || die "no CafAI build at $SKIN_PATH: run npm run build first"
  running && die "Decaid is already running (pid $(cat "$PIDFILE")): bash scripts/decaid-ci.sh stop"
  if curl -fsS -o /dev/null --max-time 2 "$API/api/v1/devices" 2>/dev/null; then die "something already answers on $API"; fi
  mkdir -p "$WORK"
  install_runtime

  local tag="${DECAID_TAG:-latest}"
  if [ "$tag" = latest ]; then
    local resolved
    resolved="$(latest_tag)"
    if [ -n "$resolved" ]; then
      say "the latest Decaid release is $resolved"
      tag="$resolved"
    else
      say "GitHub did not name the latest release: using its -latest assets"
    fi
  fi
  download "$tag"

  trap 'on_start_exit $?' EXIT
  # A fresh profile every start: settings, shots, the KV store and skin ports from an earlier run would leak in.
  rm -rf "$WORK/xdg" "$WORK/logs"
  mkdir -p "$WORK/xdg/data" "$WORK/xdg/config" "$WORK/xdg/cache"
  export XDG_DATA_HOME="$WORK/xdg/data" XDG_CONFIG_HOME="$WORK/xdg/config" XDG_CACHE_HOME="$WORK/xdg/cache"
  # Its own session, all three streams redirected: a later step can stop the
  # whole group, and nothing holds this step's output open. The flags
  # (lib/src/cli/cli_args.dart): no keyring, no onboarding, this build as the skin.
  setsid xvfb-run -a "$WORK/app/bundle/decaid" --no-account --bypass-onboarding --skin-path="$SKIN_PATH" \
    >"$LOG" 2>&1 </dev/null &
  echo $! >"$PIDFILE"
  say "started Decaid (pid $(cat "$PIDFILE")), log in $LOG"

  local deadline=$((SECONDS + READY_S))
  until curl -fsS -o /dev/null --max-time 5 "$API/api/v1/devices" 2>/dev/null; do
    running || die "Decaid exited before its API answered"
    [ "$SECONDS" -lt "$deadline" ] || die "Decaid's API did not answer within $READY_S s"
    sleep 1
  done
  say "the API answers"

  simulate || die "POST /api/v1/settings failed"

  # A scan connects what it finds. The device services may still be starting,
  # and Decaid may still be loading its own settings over the simulated
  # devices, so set them and scan until both are connected.
  deadline=$((SECONDS + CONNECT_S))
  until curl -fsS --max-time 10 "$API/api/v1/devices" 2>/dev/null | both_connected; do
    running || die "Decaid exited while connecting the simulated machine and scale"
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "decaid-ci: devices: $(curl -fsS --max-time 5 "$API/api/v1/devices" 2>/dev/null || echo 'no answer')" >&2
      die "the simulated machine and scale did not connect within $CONNECT_S s"
    fi
    simulate || true
    curl -fsS -o /dev/null --max-time 30 "$API/api/v1/devices/scan?connect=true" 2>/dev/null || true
    sleep 1
  done
  say "the simulated machine and scale are connected"
  echo "decaid-ci: GET /api/v1/info: $(curl -fsS --max-time 5 "$API/api/v1/info")"
  say "Decaid is up: API $API, CafAI http://localhost:3000"
  trap - EXIT
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  *)
    echo "usage: bash scripts/decaid-ci.sh [start|stop]" >&2
    exit 2
    ;;
esac
