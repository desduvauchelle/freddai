"""Mood contact sheets from real Rive state-machine frames.

Renders several frames per mood and writes sheets at full review size, 148 px and 38 px
(the two sizes the app shows the mascot). Usage: python3 render_moods.py [out_dir]
Outputs: build/moods-large.png plus <out_dir>/mascot3-moods-148.png, mascot3-moods-38.png
and mascot3-moods-38-x4.png (the 38 px sheet enlarged 4x with nearest-neighbour for inspection).
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
RIVE = Path.home() / '.rive/bin/rive'
OUT = HERE / 'build' / 'mood-frames'
OUT.mkdir(parents=True, exist_ok=True)
DEST = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'build'
DEST.mkdir(parents=True, exist_ok=True)
FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 15)
# (label, mood, [animation frames at 60 fps after the mood is set])
MOODS = [
    ('0 Idle', 0, [30, 120, 220, 330]),
    ('2 Working', 2, [30, 39, 48, 57, 66, 75]),
    ('4 Waiting', 4, [40, 55, 70, 85, 100, 115]),
    ('6 Done', 6, [10, 22, 36, 52, 75, 110, 200, 400]),
    ('7 Interrupted', 7, [10, 30, 60, 120]),
    ('8 Failed', 8, [10, 30, 60, 150]),
]
BG = '#F6F1E7'  # warm light, like the app header; dark variant is checked in the app screenshots


def render(args):
    label, mood, frame = args
    target = OUT / f'm{mood}_{frame:04d}.png'
    subprocess.run([str(RIVE), '.', f'--screenshot={target}', '--scale=0.4', f'--data=mood={mood}',
                    f'--advance={frame}', '--quiet'], cwd=HERE, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return target


jobs = [(l, m, f) for l, m, fs in MOODS for f in fs]
with ThreadPoolExecutor(6) as pool:
    list(pool.map(render, jobs))


def sheet(size, name, dark=False, zoom=1):
    cols = max(len(fs) for _, _, fs in MOODS)
    pad, label_w = 8, 130
    cell = size
    bg = '#1E1E1E' if dark else BG
    fg = '#F1EEE6' if dark else '#2E2418'
    img = Image.new('RGB', (label_w + cols * (cell + pad) + pad, len(MOODS) * (cell + pad) + pad), bg)
    d = ImageDraw.Draw(img)
    for r, (label, mood, frames) in enumerate(MOODS):
        y = pad + r * (cell + pad)
        d.text((8, y + cell // 2), label, font=FONT, fill=fg, anchor='lm')
        for c, f in enumerate(frames):
            src = Image.open(OUT / f'm{mood}_{f:04d}.png').convert('RGBA')
            tile = Image.new('RGBA', src.size, bg)
            tile.alpha_composite(src)
            tile = tile.convert('RGB').resize((cell, cell), Image.LANCZOS)
            img.paste(tile, (label_w + pad + c * (cell + pad), y))
    if zoom != 1:
        img = img.resize((img.width * zoom, img.height * zoom), Image.NEAREST)
    img.save(DEST / name)
    return img


sheet(240, 'moods-large.png')
sheet(148, 'mascot3-moods-148.png')
sheet(38, 'mascot3-moods-38.png')
sheet(38, 'mascot3-moods-38-x4.png', zoom=4)
sheet(38, 'mascot3-moods-38-dark.png', dark=True)
print('Wrote sheets to', DEST)
