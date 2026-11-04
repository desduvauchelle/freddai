#!/bin/bash
# One universal iPhone/iPad companion. Uses the existing Xcode account; no credentials in source.
set -euo pipefail
cd "$(dirname "$0")/.."
action="${1:-archive}"
case "$action" in archive|upload) ;; *) echo 'Usage: distribute-ios.sh archive|upload' >&2; exit 2 ;; esac
if [ "${VITE_COMPANION_FIXTURE:-0}" != 0 ]; then
  echo 'Refusing to distribute a fixture build. Unset VITE_COMPANION_FIXTURE.' >&2
  exit 1
fi
# Ignore local Vite .env fixture flags too: distribution must always use real pairing.
export VITE_COMPANION_FIXTURE=0
if [ "$action" = archive ]; then
  # Apple limits component lengths to 4.2.2 digits. Days since 2020 + UTC hour/minute is monotonic.
  number="${FREDDAI_IOS_BUILD_NUMBER:-$(python3 -c 'from datetime import datetime,timezone,date; n=datetime.now(timezone.utc); print(f"{(n.date()-date(2020,1,1)).days}.{n.hour}.{n.minute}")')}"
  if ! [[ "$number" =~ ^[1-9][0-9]{0,3}(\.[0-9]{1,2}){0,2}$ ]]; then
    echo 'FREDDAI_IOS_BUILD_NUMBER must use up to three numeric components (maximum 4.2.2 digits).' >&2; exit 1
  fi
  destination="$PWD/output/ios-distribution/$number"
  if [ -e "$destination" ]; then echo "Archive output already exists: $destination" >&2; exit 1; fi
  python3 scripts/provision-iphone.py >/dev/null
  pnpm --filter @freddai/native tauri ios build --ci --archive-only --export-method app-store-connect \
    --config "{\"bundle\":{\"iOS\":{\"bundleVersion\":\"$number\"}}}"
  mkdir -p "$destination"
  ditto apps/native/src-tauri/gen/apple/build/freddai-native_iOS.xcarchive "$destination/Freddai.xcarchive"
  python3 scripts/verify-ios-archive.py "$destination/Freddai.xcarchive" --record-production-assets apps/native/dist-ios/assets
  codesign --verify --deep --strict "$destination/Freddai.xcarchive/Products/Applications/Freddai.app"
  printf '%s\n' "$destination/Freddai.xcarchive" > output/ios-distribution/latest-archive.txt
  echo "Universal release archive: $destination/Freddai.xcarchive"
  echo 'Run pnpm ios:upload to upload this archive for internal TestFlight testing.'
  exit 0
fi
archive="${FREDDAI_IOS_ARCHIVE:-}"
if [ -z "$archive" ]; then
  [ -f output/ios-distribution/latest-archive.txt ] || { echo 'Run pnpm ios:archive first.' >&2; exit 1; }
  IFS= read -r archive < output/ios-distribution/latest-archive.txt
fi
python3 scripts/verify-ios-archive.py "$archive"
codesign --verify --deep --strict "$archive/Products/Applications/Freddai.app"
destination="$(dirname "$archive")/upload"
mkdir -p "$destination"
# This build currently trusts the developer Mac. Keep it internal until generic enrollment is shipped.
python3 - "$destination/ExportOptions.plist" <<'PY'
import plistlib,sys
with open(sys.argv[1], 'wb') as f:
    plistlib.dump(dict(method='app-store-connect', destination='upload', signingStyle='automatic',
                      teamID='BSH2UEDLU5', uploadSymbols=True, manageAppVersionAndBuildNumber=True,
                      testFlightInternalTestingOnly=True), f)
PY
xcodebuild -exportArchive -archivePath "$archive" -exportPath "$destination" \
  -exportOptionsPlist "$destination/ExportOptions.plist" -allowProvisioningUpdates
echo 'Upload completed. Apple processing and internal tester assignment are separate App Store Connect steps.'
