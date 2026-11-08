#!/usr/bin/env python3
"""Wrap a released AppImage without changing its bytes; preserve executable mode."""
import argparse
from pathlib import Path
import tarfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('appimage', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
if not args.appimage.is_file():
    parser.error('AppImage must be an existing file')
root = Path(__file__).resolve().parent.parent
with tarfile.open(args.output, 'w:gz') as archive:
    for source, name, mode in [
        (args.appimage, 'Freddai-linux-x64.AppImage', 0o755),
        (root / 'docs/linux.md', 'README.md', 0o644),
    ]:
        info = archive.gettarinfo(str(source), arcname=f'Freddai-linux-x64/{name}')
        info.mode, info.uid, info.gid, info.uname, info.gname = mode, 0, 0, '', ''
        with source.open('rb') as stream:
            archive.addfile(info, stream)
print(args.output)
