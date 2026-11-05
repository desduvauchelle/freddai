"""Run only against the disposable computer-use-fixture.swift window."""
import base64, fcntl, json, pathlib, subprocess, sys, time
p = subprocess.Popen([sys.argv[1]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
seq = 0
def call(name, **args):
    if name == 'computer_action': args['mode'] = 'foreground'
    global seq
    seq += 1
    p.stdin.write(json.dumps(dict(jsonrpc='2.0',id=seq,method='tools/call',params=dict(name=name,arguments=args)))+'\n'); p.stdin.flush()
    return json.loads(p.stdout.readline())['result']
def data(r):
    assert not r.get('isError'), r
    return json.loads(r['content'][0]['text'])
try:
    windows = data(call('computer_windows'))
    w = next(w for w in windows if w['title']=='Freddai Computer Test Fixture')
    r = call('computer_observe',window_id=w['window_id']); o = data(r)
    print('Observed fixture:', o['width'], o['height'], 'pixels;',len(o['elements']),'AX elements')
    before = int(next(e['value'].split(': ')[1] for e in o['elements'] if e.get('value','').startswith('Count: ')))
    e = next(e for e in o['elements'] if e.get('AXTitle')=='Increment')
    r = call('computer_action',observation=o['observation'],action='press',element=e['id']); after = data(r)
    assert any(e.get('value')==f'Count: {before+1}' for e in after['elements']), after
    print(f'AXPress changed fixture to Count: {before+1}; verified in fresh observation.')
    stale = call('computer_action',observation=o['observation'],action='press',element=e['id'])
    assert stale.get('isError'), stale
    print('Consumed observation rejected; no duplicate press.')
    o = data(call('computer_observe',window_id=w['window_id']))
    lock_path = pathlib.Path.home()/'Library/Application Support/com.freddai.desktop/computer-use.lock'
    with lock_path.open('r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        busy = call('computer_action',observation=o['observation'],action='press',element=e['id'])
        assert busy.get('isError') and 'Another Freddai agent' in busy['content'][0]['text'], busy
    print('Competing desktop action rejected by shared lock.')
    if '--ax-only' in sys.argv:
        print('Pointer and typing checks explicitly skipped; AX and coordination checks passed.')
        sys.exit(0)
    r = call('computer_observe',window_id=w['window_id']); o = data(r)
    # Window is 440x240 points + title bar. Input center is x=200, y=190 from window top.
    r = call('computer_action',observation=o['observation'],action='click',x=round(o['width']*200/440),y=round(o['height']*190/268)); o = data(r)
    r = call('computer_action',observation=o['observation'],action='type',text='Freddai test ✓'); after = data(r)
    assert any(e.get('value')=='Freddai test ✓' for e in after['elements']), after
    print('Pixel-coordinate click and Unicode typing verified in fresh AX evidence.')
    open('/tmp/freddai-computer-fixture.png','wb').write(base64.b64decode(r['content'][1]['data']))
finally:
    p.stdin.close(); p.wait(timeout=5)
