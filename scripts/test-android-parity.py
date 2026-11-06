#!/usr/bin/env python3
"""Offline Android acceptance, including the baseline drawer/draft checks.

Run only against a dedicated emulator with VITE_COMPANION_FIXTURE=1. Never pairs
with a Mac, changes accounts, or generates provider work. Restores display overrides.
"""
import os
import runpy
import subprocess
import time
from pathlib import Path

if not os.environ.get('FREDDAI_ANDROID_DEVICE', 'emulator-5554').startswith('emulator-'):
    raise SystemExit('UI fixtures are only permitted on a dedicated emulator.')
subprocess.run(['bash', str(Path(__file__).parent / 'tests/android-tree/build.sh')], check=True)
adb = str(Path(os.environ.get('ANDROID_HOME', str(Path.home() / 'Library/Android/sdk'))) / 'platform-tools/adb')
subprocess.run([adb, '-s', os.environ.get('FREDDAI_ANDROID_DEVICE', 'emulator-5554'), 'install', '-r', 'output/android-parity/tree-probe.apk'], check=True)
os.environ['FREDDAI_ANDROID_TREE_PROBE'] = '1'
checks = runpy.run_path(str(Path(__file__).with_name('test-android-ui.py')))
# Restoring font scale schedules one last Activity recreation.
time.sleep(2)
run, find, tap, tree = (checks[key] for key in ('run', 'find', 'tap', 'tree'))
out = Path('output/android-parity')
out.mkdir(parents=True, exist_ok=True)
def screenshot(name):
    import subprocess
    (out / name).write_bytes(subprocess.check_output([checks['adb'], '-s', checks['serial'], 'exec-out', 'screencap', '-p']))
def scroll_up():
    run('shell', 'input', 'swipe', '550', '1900', '550', '700', '450')
    time.sleep(.3)
def has(label):
    return any(label in (n.get('text', '') + n.get('content-desc', '')) for n in tree().iter('node'))

tap('Threads')
tap('Dashboard')
find('Daily summaries')
find('Completed the dashboard layout', partial=True)
find('New thread in Freddai')
find('Dictate task in Freddai.', partial=True)
tap('▾ Today')
assert not has('Completed the dashboard layout')
tap('▸ Today')
find('Completed the dashboard layout', partial=True)
screenshot('phone-dashboard.png')
tap('Expand office')
find('Close office')
tap('Close office')
find('Daily summaries')
# A drag beginning on a summary button must move the entire native page.
scroll_up()
find('Dormouse Rive')
screenshot('phone-dashboard-scrolled.png')
run('shell', 'input', 'swipe', '550', '650', '550', '2100', '450')
time.sleep(.4)
tap('Coding agent:', partial=True)
find('Project defaults', partial=True)
tap('Codex · Work')
find('Coding agent: Codex · Work')
tap('New thread in Freddai')
find('Coding agent: Codex · Work')
tap('Attach')
find('Photos')
find('Files')
find('Camera')
run('shell', 'input', 'keyevent', '4')
print('PASS: single-scroll native dashboard, summaries, Office expand/close, scrolling, agent retention, compact controls and attachment sources', flush=True)

# Use an isolated emulator's window overrides to test tablet and split-window rules.
try:
    run('shell', 'wm', 'density', '160')
    run('shell', 'wm', 'size', '1280x800')
    time.sleep(2)
    find('Search threads')  # visible without opening a drawer
    tap('Threads')
    assert not has('Search threads')
    tap('Threads')
    find('Search threads')
    tap('Sync read state between Mac and iPhone', partial=True)
    find('Search threads')  # selecting keeps the sidebar open
    tap('Dashboard')
    find('Daily summaries')
    find('New thread in Freddai')
    screenshot('tablet-landscape.png')
    run('shell', 'wm', 'size', '800x1280')
    time.sleep(2)
    find('Daily summaries')
    assert not has('Search threads')
    screenshot('tablet-portrait.png')
    run('shell', 'wm', 'size', '600x900')
    time.sleep(2)
    find('Daily summaries')
    assert not has('Search threads')
    screenshot('tablet-compact-window.png')
finally:
    run('shell', 'wm', 'size', 'reset')
    run('shell', 'wm', 'density', 'reset')
print('PASS: persistent tablet landscape sidebar, retained selection, portrait and compact-window fallback', flush=True)
