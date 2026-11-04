#!/bin/bash
# Builds the iOS simulator app with the offline fixture client (VITE_COMPANION_FIXTURE=1), installs it
# on a booted simulator and launches it. Never pairs, never touches accounts. Not used by ios:install.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! xcrun simctl list devices booted | grep -q Booted; then
  name="${FREDDAI_SIM_DEVICE:-iPhone 17 Pro}"
  xcrun simctl boot "$name" 2>/dev/null || xcrun simctl boot "$(xcrun simctl list devices available | grep -m1 'iPhone' | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
  open -a Simulator
fi
export VITE_COMPANION_FIXTURE=1
pnpm --filter @freddai/native tauri ios build --debug --ci --target aarch64-sim
app="apps/native/src-tauri/gen/apple/build/arm64-sim/Freddai.app"
[ -n "$app" ] || { echo "Simulator Freddai.app not found" >&2; exit 1; }
xcrun simctl install booted "$app"
xcrun simctl launch booted com.freddai.companion
