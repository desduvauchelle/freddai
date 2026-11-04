#!/usr/bin/env python3
"""Smoke-check an already installed offline fixture APK on a dedicated emulator."""
import os, re, subprocess, time, xml.etree.ElementTree as ET
from pathlib import Path
adb = str(Path(os.environ.get('ANDROID_HOME', str(Path.home() / 'Library/Android/sdk'))) / 'platform-tools/adb')
serial = os.environ.get('FREDDAI_ANDROID_DEVICE', 'emulator-5554')
if not serial.startswith('emulator-'):
    raise SystemExit('UI fixtures are only permitted on a dedicated emulator.')
def run(*args):
    return subprocess.check_output([adb, '-s', serial, *args], text=True)
def tree():
    run('shell', 'uiautomator', 'dump', '/sdcard/freddai-ui.xml')
    return ET.fromstring(run('shell', 'cat', '/sdcard/freddai-ui.xml'))
def find(label, partial=False):
    for _ in range(8):
        for node in tree().iter('node'):
            values = [node.get('text', ''), node.get('content-desc', '')]
            if any(label in v if partial else label == v for v in values): return node
        time.sleep(.3)
    raise AssertionError('Missing UI: ' + label)
def tap_node(node):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
    run('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
def tap(label, partial=False):
    tap_node(find(label, partial))
# This text only exists in the offline client. Never send to a real Mac.
find('Project: Freddai')
assert any(n.get('class') == 'android.widget.EditText' for n in tree().iter('node'))
tap('Threads')
find('Search threads')
tap('Status')
find('Needs you')
run('shell', 'input', 'keyevent', '4')
tap('Sync read state between Mac and iPhone', partial=True)
find('Send')
run('shell', 'input', 'keyevent', '4')
find('What should we work on today?')
tap('Project: Freddai')
find('Lucy Web', partial=True)
run('shell', 'input', 'keyevent', '4')
tap('Project: Freddai')
find('Lucy Web', partial=True)
run('shell', 'input', 'keyevent', '4')
print('PASS: native drawer, filters, thread selection, Android Back, picker dismissal/reopening, shared home')

editor = next(n for n in tree().iter('node') if n.get('class') == 'android.widget.EditText')
tap_node(editor)
time.sleep(1)
run('shell', 'input', 'text', 'Draft42')
find('Draft42')
run('shell', 'input', 'keyevent', '4')
try:
    run('shell', 'wm', 'user-rotation', 'lock', '1')
    time.sleep(1)
    find('Draft42')
    run('shell', 'wm', 'user-rotation', 'lock', '0')
    time.sleep(1)
    find('Draft42')
finally:
    run('shell', 'wm', 'user-rotation', 'free')
print('PASS: native editing and draft retention across rotation')

# Font-scale changes recreate the Activity (unlike handled orientation changes).
old_scale = run('shell', 'settings', 'get', 'system', 'font_scale').strip()
try:
    run('shell', 'settings', 'put', 'system', 'font_scale', '1.1')
    time.sleep(2)
    find('Threads')
    find('Draft42')
finally:
    if old_scale == 'null': run('shell', 'settings', 'delete', 'system', 'font_scale')
    else: run('shell', 'settings', 'put', 'system', 'font_scale', old_scale)
print('PASS: native shell and draft survive Activity recreation')
