#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export FREDDAI_REPO_ROOT="$PWD"
device="${FREDDAI_SIM_DEVICE:-}"
if [ -z "$device" ]; then
  device="$(xcrun simctl list devices available --json | python3 -c 'import json,sys; print(next(d["udid"] for ds in json.load(sys.stdin)["devices"].values() for d in ds if d["name"].startswith("iPad")))')"
fi
scheme=CompanionLayoutTests
if [ "${1:-}" = --ui ]; then
  scheme=CompanionLayoutUITests
  FREDDAI_SIM_DEVICE="$device" bash scripts/ios-sim-fixture.sh
fi
mkdir -p output/ios-layout-tests
xcodegen generate --spec scripts/tests/ios-layout/project.yml --project-root output/ios-layout-tests --project output/ios-layout-tests
xcodebuild test -project output/ios-layout-tests/CompanionLayoutTests.xcodeproj \
  -scheme "$scheme" -destination "platform=iOS Simulator,id=$device" \
  -derivedDataPath output/ios-layout-tests/DerivedData CODE_SIGNING_ALLOWED=NO
