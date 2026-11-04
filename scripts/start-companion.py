#!/usr/bin/env python3
"""Refresh only the detached companion listener; preserve the GUI and agent host."""
import os, signal, subprocess, time
from pathlib import Path
root = Path.home() / 'Library/Application Support/com.freddai.desktop'
binary = Path('/Applications/Freddai.app/Contents/MacOS/freddai-native')
# The listener holds no provider processes. A normal termination releases its lock;
# outstanding host work continues in the independent agent supervisor.
processes = subprocess.check_output(['ps', '-axo', 'pid=,command='], text=True)
for line in processes.splitlines():
    parts = line.strip().split(None, 1)
    if len(parts) != 2:
        continue
    pid, command = parts
    if '/Contents/MacOS/freddai-native --companion-server ' not in command or not command.endswith('--companion-server ' + str(root)):
        continue
    os.kill(int(pid), signal.SIGTERM)
    for _ in range(50):
        try:
            os.kill(int(pid), 0)
        except ProcessLookupError:
            break
        time.sleep(0.1)
    else:
        raise SystemExit('Previous companion listener did not stop normally; leaving it alone.')
log = root / 'companion/listener.log'
fd = os.open(log, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
with os.fdopen(fd, 'ab') as output:
    process = subprocess.Popen([str(binary), '--companion-server', str(root)], stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=True)
time.sleep(0.5)
if process.poll() is not None:
    raise SystemExit('Companion listener did not start; inspect its local log.')
print('Started signed companion listener:', process.pid)
