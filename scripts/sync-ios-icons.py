#!/usr/bin/env python3
"""Package the existing Freddai artwork as opaque App Store icons in Xcode's generated catalog."""
import json
import subprocess
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
source = repo / 'apps/native/src-tauri/icons/ios'
catalog = repo / 'apps/native/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset'
manifest = catalog / 'Contents.json'
if not manifest.exists():
    raise SystemExit('Initialize the native iOS project before building its icons.')
images = json.loads(manifest.read_text())['images']
originals = []
for image in images:
    name = image['filename']
    if Path(name).name != name:
        raise SystemExit('Invalid icon filename in the Xcode catalog.')
    original = source / name
    if not original.is_file():
        raise SystemExit(f'Missing Freddai app icon: {original}')
    originals.append(original)
subprocess.run(['swift', str(repo / 'scripts/opaque-ios-icons.swift'), str(catalog), *map(str, originals)], check=True)
for original in originals:
    data = (catalog / original.name).read_bytes()
    # PNG IHDR byte 25 is the color type. Types 4/6 contain alpha and App Store Connect rejects them.
    if data[:8] != b'\x89PNG\r\n\x1a\n' or data[16:24] != original.read_bytes()[16:24] or data[25] in (4, 6):
        raise SystemExit(f'App icon must retain its dimensions and contain no alpha: {original.name}')
print(f'Packaged {len(images)} existing Freddai app icons without alpha for the iOS catalog.')
