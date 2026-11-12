#!/usr/bin/env python3
"""Fail closed on non-universal or simulator-fixture distribution archives."""
import plistlib
import hashlib
import json
import sys
from pathlib import Path

archive = Path(sys.argv[1])
app = archive / 'Products/Applications/Freddai.app'
with (app / 'Info.plist').open('rb') as f:
    info = plistlib.load(f)
if info.get('CFBundleIdentifier') != 'com.freddai.companion':
    raise SystemExit('Wrong companion bundle identifier.')
if set(info.get('UIDeviceFamily', [])) != {1, 2}:
    raise SystemExit('Archive must support both iPhone and iPad.')
if info.get('UIRequiresFullScreen', True):
    raise SystemExit('iPad multitasking must be enabled.')
if len(info.get('UISupportedInterfaceOrientations~ipad', [])) != 4:
    raise SystemExit('Archive must support all four iPad orientations.')
# Tauri embeds compressed web assets in the Rust binary, rather than copying JS files into the app.
# Record production asset validation immediately after the build and bind it to that executable.
manifest = archive / 'Freddai-build.json'
digest = hashlib.sha256((app / info['CFBundleExecutable']).read_bytes()).hexdigest()
if len(sys.argv) == 4 and sys.argv[2] == '--record-production-assets':
    scripts = list(Path(sys.argv[3]).rglob('*.js'))
    if not scripts or any('fixture-client' in f.name or b'Fixture mode: no agent is running.' in f.read_bytes() for f in scripts):
        raise SystemExit('Missing production assets or simulator fixture found in build.')
    catalog = Path(__file__).resolve().parent.parent / 'apps/native/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset'
    icons = list(catalog.glob('*.png'))
    if not icons or any(f.read_bytes()[25] in (4, 6) for f in icons):
        raise SystemExit('App Store icons must not have an alpha channel.')
    manifest.write_text(json.dumps(dict(executableSHA256=digest, fixture=False, internalTestingOnly=False, iconsOpaque=True,
                                       assets={f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in scripts}), indent=2) + '\n')
record = json.loads(manifest.read_text())
if record.get('fixture') is not False or record.get('executableSHA256') != digest or record.get('internalTestingOnly') is not False or not record.get('iconsOpaque'):
    raise SystemExit('Archive does not match its verified production build record.')
print(f"Verified universal iPhone/iPad companion {info['CFBundleShortVersionString']} ({info['CFBundleVersion']}).")
