#!/bin/bash
# Builds the iOS simulator app with the offline fixture client (VITE_COMPANION_FIXTURE=1), installs it
# on the selected simulator and launches it. Never pairs, never touches accounts. Not used by ios:install.
set -euo pipefail
cd "$(dirname "$0")/.."
device="$(xcrun simctl list devices available --json | FREDDAI_REQUESTED_SIM="${FREDDAI_SIM_DEVICE:-}" python3 -c '
import json,os,sys
devices=[d for ds in json.load(sys.stdin)["devices"].values() for d in ds]
requested=os.environ["FREDDAI_REQUESTED_SIM"]
matches=[d for d in devices if d["udid"]==requested or d["name"]==requested] if requested else [d for d in devices if d["state"]=="Booted"]
if not matches and not requested: matches=[d for d in devices if d["name"].startswith("iPhone")]
if not matches: raise SystemExit("Requested simulator is not available.")
if requested and len(matches)>1: raise SystemExit("More than one simulator has that name; set FREDDAI_SIM_DEVICE to its UDID.")
print(matches[0]["udid"])
')"
state="$(xcrun simctl list devices --json | FREDDAI_SELECTED_SIM="$device" python3 -c 'import json,os,sys; print(next(d["state"] for ds in json.load(sys.stdin)["devices"].values() for d in ds if d["udid"]==os.environ["FREDDAI_SELECTED_SIM"]))')"
if [ "$state" != Booted ]; then xcrun simctl boot "$device"; fi
xcrun simctl bootstatus "$device" -b
export VITE_COMPANION_FIXTURE=1
export VITE_COMPANION_FIXTURE_MANY="${VITE_COMPANION_FIXTURE_MANY:-}"
# Replies never complete in the fixture, so a sent follow-up stays in the queued-message strip (layout tests).
export VITE_COMPANION_FIXTURE_STALL="${VITE_COMPANION_FIXTURE_STALL:-1}"
pnpm --filter @freddai/native tauri ios build --debug --ci --target aarch64-sim
app="apps/native/src-tauri/gen/apple/build/arm64-sim/Freddai.app"
[ -d "$app" ] || { echo "Simulator Freddai.app not found" >&2; exit 1; }
xcrun simctl install "$device" "$app"
xcrun simctl launch "$device" com.freddai.companion
