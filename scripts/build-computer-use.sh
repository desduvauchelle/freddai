#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
app='apps/native/computer-use/.build/Freddai Computer.app'
mkdir -p "$app/Contents/MacOS"
for arch in arm64 x86_64; do
  swiftc -O -parse-as-library -target "$arch-apple-macos14.0" apps/native/computer-use/main.swift -o "apps/native/computer-use/.build/computer-$arch"
done
lipo -create apps/native/computer-use/.build/computer-arm64 apps/native/computer-use/.build/computer-x86_64 -output "$app/Contents/MacOS/freddai-computer"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.freddai.computer</string>
<key>CFBundleName</key><string>Freddai Computer</string>
<key>CFBundleExecutable</key><string>freddai-computer</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSScreenCaptureUsageDescription</key><string>Let your Freddai agent inspect the window you ask it to use.</string>
</dict></plist>
PLIST

# Release CI imports the existing Developer ID before this build. Sign nested
# code before Tauri seals and notarizes the parent application's resources.
if [ -n "${FREDDAI_COMPUTER_SIGNING_IDENTITY:-}" ]; then
  codesign --force --options runtime --timestamp --identifier com.freddai.computer --sign "$FREDDAI_COMPUTER_SIGNING_IDENTITY" "$app"
  codesign --verify --deep --strict "$app"
fi
