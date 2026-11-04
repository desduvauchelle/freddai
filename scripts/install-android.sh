#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
adb="$ANDROID_HOME/platform-tools/adb"
if [ ! -x "$adb" ]; then echo 'Android platform-tools are required.' >&2; exit 1; fi
device="${FREDDAI_ANDROID_DEVICE:-}"
if [ -z "$device" ]; then
  device="$("$adb" devices | awk 'NR>1 && $2=="device" {print $1}')"
  if [ "$(printf '%s\n' "$device" | wc -w | tr -d ' ')" != 1 ]; then
    echo 'Connect one authorized Android device, or set FREDDAI_ANDROID_DEVICE to its adb serial.' >&2; exit 1
  fi
fi
bash scripts/build-android.sh
apk="apps/native/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
if [ ! -f "$apk" ]; then echo 'No debug APK produced.' >&2; exit 1; fi
"$adb" -s "$device" install -r "$apk"
"$adb" -s "$device" shell am start -n com.freddai.companion/.MainActivity
