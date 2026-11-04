#!/usr/bin/env python3
"""Copy the existing Freddai platform artwork into Xcode's generated catalog."""
import json
import shutil
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
source = repo / 'apps/native/src-tauri/icons/ios'
catalog = repo / 'apps/native/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset'
manifest = catalog / 'Contents.json'
if not manifest.exists():
    raise SystemExit('Initialize the native iOS project before building its icons.')
images = json.loads(manifest.read_text())['images']
for image in images:
    name = image['filename']
    if Path(name).name != name:
        raise SystemExit('Invalid icon filename in the Xcode catalog.')
    original = source / name
    if not original.is_file():
        raise SystemExit(f'Missing Freddai app icon: {original}')
    shutil.copyfile(original, catalog / name)
    if original.read_bytes() != (catalog / name).read_bytes():
        raise SystemExit(f'Icon copy failed: {name}')
print(f'Synced {len(images)} existing Freddai app icons to the iOS catalog.')
