"""Isolated macOS host snapshot benchmark; synthetic history, no accounts or provider turns."""
import json, pathlib, re, socket, subprocess, sys, tempfile, threading, time

binary = str(pathlib.Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory(prefix='freddai-memory-') as directory:
    root = pathlib.Path(directory)
    text = 'synthetic tool output ' * 50000
    sessions = [dict(id=str(i), project='', account='', title='Memory fixture', status='done',
                     updated=1, provider_id=None, pending=None, error=None,
                     messages=[dict(id='tool', role='tool', text=text)]) for i in range(128)]
    with (root / 'workspace.json').open('w') as f:
        json.dump(dict(accounts=[], projects=[], sessions=sessions, queues=[], preferences={"prefer_last": False}, schedules=[]), f)
    del sessions, text
    with (root / 'host.log').open('w') as log:
        process = subprocess.Popen([binary, '--host', directory], stdout=log, stderr=log)
        peak = [0]
        stop = threading.Event()
        def measure():
            while not stop.wait(.05):
                result = subprocess.run(['ps', '-o', 'rss=', '-p', str(process.pid)], capture_output=True, text=True)
                if result.stdout.strip(): peak[0] = max(peak[0], int(result.stdout.strip()))
        sampler = threading.Thread(target=measure); sampler.start()
        try:
            for _ in range(600):
                if (root / 'host.sock').exists(): break
                if process.poll() is not None: raise RuntimeError((root / 'host.log').read_text())
                time.sleep(.1)
            start = time.monotonic()
            for _ in range(6):
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(60); client.connect(str(root / 'host.sock'))
                    request = dict(version='2', method='snapshot_since', params=dict(revision=0, openThreads=[])) if '--desktop' in sys.argv else dict(version='2', method='snapshot', params={})
                    client.sendall((json.dumps(request)+'\n').encode())
                    # Drain without creating a second in-memory copy in the benchmark process.
                    size = 0
                    while True:
                        chunk = client.recv(1024 * 1024)
                        if not chunk: break
                        size += len(chunk)
                    if '--desktop' in sys.argv: assert size < 128 * 1024, f'Desktop Home downloaded {size} bytes of hidden history'
                    else: assert size > 128 * 1000000, size
            if '--check-idle' in sys.argv:
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(60); client.connect(str(root / 'host.sock'))
                    initial = dict(revision=0, messageDeltas=True)
                    if '--desktop' in sys.argv: initial['openThreads'] = []
                    client.sendall((json.dumps(dict(version='2', method='snapshot_since', params=initial))+'\n').encode())
                    prefix = b''
                    while True:
                        chunk = client.recv(1024 * 1024)
                        if not chunk: break
                        if len(prefix) < 4096: prefix += chunk[:4096-len(prefix)]
                    revision = int(re.search(rb'"revision":(\d+)', prefix)[1])
                    host = re.search(rb'"hostId":"([^"]+)"', prefix)[1].decode()
                time.sleep(4.2) # two housekeeping cycles
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(60); client.connect(str(root / 'host.sock'))
                    client.sendall((json.dumps(dict(version='2', method='snapshot_since', params=dict(revision=revision, hostId=host, messageDeltas=True)))+'\n').encode())
                    reply = client.makefile('rb').readline(4096)
                    assert len(reply) < 4096, 'Idle housekeeping resent transcript history'
                    assert json.loads(reply)['result']['unchanged'] is True
                    print('PASS: two idle housekeeping cycles return an unchanged snapshot, no transcript payload')
            print(json.dumps(dict(binary=binary, fixture_mib=round(128*1050000/1024/1024,1), snapshot_bytes=size, desktop='--desktop' in sys.argv, polls=6, peak_rss_mib=round(peak[0]/1024,1), seconds=round(time.monotonic()-start,2))))
        finally:
            # Only this isolated, account-free fixture process is stopped.
            process.terminate(); process.wait(timeout=10)
            stop.set(); sampler.join()
