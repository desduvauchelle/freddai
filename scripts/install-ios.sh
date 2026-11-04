#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Uses the existing Xcode account and development team. No credentials in this repo.
python3 scripts/provision-iphone.py >/dev/null
pnpm native:install
python3 scripts/start-companion.py
pnpm --filter @freddai/native tauri ios build --debug --ci --export-method debugging --archive-only
bundle="apps/native/src-tauri/gen/apple/build/freddai-native_iOS.xcarchive/Products/Applications/Freddai.app"
codesign --verify --deep --strict "$bundle"
device="${FREDDAI_IOS_DEVICE:-}"
if [ -z "$device" ]; then
  device="$(python3 - <<'PY'
import json,subprocess
p=subprocess.run(['xcrun','devicectl','list','devices','--json-output','-'],capture_output=True,text=True,check=True)
devices=[d for d in json.loads(p.stdout)['result']['devices'] if d.get('hardwareProperties',{}).get('reality')=='physical' and d.get('hardwareProperties',{}).get('deviceType') in ('iPhone','iPad') and d.get('connectionProperties',{}).get('pairingState')=='paired' and d.get('connectionProperties',{}).get('tunnelState')=='connected']
if len(devices)!=1: raise SystemExit('Set FREDDAI_IOS_DEVICE to the intended connected, paired iPhone or iPad identifier.')
print(devices[0]['identifier'])
PY
)"
fi
xcrun devicectl --timeout 180 device install app --device "$device" "$bundle"
xcrun devicectl --timeout 30 device process launch --device "$device" com.freddai.companion
