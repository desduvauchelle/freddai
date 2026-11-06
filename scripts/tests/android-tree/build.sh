#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
java="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
tools="$sdk/build-tools/36.0.0"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/classes" output/android-parity
"$java/bin/javac" -source 8 -target 8 -classpath "$sdk/platforms/android-36/android.jar" -d "$work/classes" scripts/tests/android-tree/TreeProbe.java
JAVA_HOME="$java" "$tools/d8" --lib "$sdk/platforms/android-36/android.jar" --output "$work" "$work/classes/com/freddai/parityprobe/TreeProbe.class"
"$tools/aapt" package -f -M scripts/tests/android-tree/AndroidManifest.xml -I "$sdk/platforms/android-36/android.jar" -F "$work/probe.apk"
(cd "$work" && "$tools/aapt" add probe.apk classes.dex)
"$tools/zipalign" -f 4 "$work/probe.apk" "$work/aligned.apk"
"$tools/apksigner" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android --key-pass pass:android --out output/android-parity/tree-probe.apk "$work/aligned.apk"
