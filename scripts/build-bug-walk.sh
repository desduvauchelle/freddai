#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
app='apps/native/bug-walk/.build/Freddai Bug Walk.app'
mkdir -p "$app/Contents/MacOS"
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos14.0" apps/native/bug-walk/*.swift -o "apps/native/bug-walk/.build/bugwalk-$arch"
done
lipo -create apps/native/bug-walk/.build/bugwalk-arm64 apps/native/bug-walk/.build/bugwalk-x86_64 -output "$app/Contents/MacOS/bugwalk-helper"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.freddai.bugwalk</string>
<key>CFBundleName</key><string>Freddai Bug Walk</string>
<key>CFBundleExecutable</key><string>bugwalk-helper</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSScreenCaptureUsageDescription</key><string>Record the screen region you pick for a bug walk.</string>
<key>NSMicrophoneUsageDescription</key><string>Record your voice while you walk through the bugs.</string>
</dict></plist>
PLIST

# Release CI imports the Developer ID first; sign nested code before Tauri seals the parent app.
if [ -n "${FREDDAI_COMPUTER_SIGNING_IDENTITY:-}" ]; then
  codesign --force --options runtime --timestamp --identifier com.freddai.bugwalk --sign "$FREDDAI_COMPUTER_SIGNING_IDENTITY" "$app"
  codesign --verify --deep --strict "$app"
fi
