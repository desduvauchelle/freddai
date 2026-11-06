"""Opt-in local-page native browser smoke test. Opens one disposable tab per browser.
No browser scripting API, accounts, credentials or provider calls.
"""
import http.server, json, subprocess, sys, threading, time, uuid
marker = 'Freddai browser fixture ' + uuid.uuid4().hex[:8]
change_target = False
page = ('<!doctype html><title>'+marker+'</title><h1>'+marker+'</h1>'
        '<input aria-label="Freddai test text"><button onclick="document.getElementById(\'result\').textContent=\'Pressed successfully\'">Freddai test button</button>'
        '<p id="result">Waiting for press</p><span id="clock"></span>'
        '<script>setInterval(async()=>{document.getElementById("clock").textContent=Date.now();'
        'if(await (await fetch("/state")).text()==="change")document.querySelector("button").textContent="Changed target";},80)</script>').encode()
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write((b"change" if change_target else b"same") if self.path=="/state" else page)
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
p = subprocess.Popen([sys.argv[1]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
def call(name, _error=False, **args):
    p.stdin.write(json.dumps(dict(jsonrpc='2.0', id=1, method='tools/call', params=dict(name=name, arguments=args)))+'\n'); p.stdin.flush()
    r = json.loads(p.stdout.readline())['result']
    if _error:
        assert r.get('isError'), r
        return r['content'][0]['text']
    assert not r.get('isError'), r
    return json.loads(r['content'][0]['text'])
try:
    bundle = sys.argv[2]
    r = call('computer_open_url', bundle_id=bundle, url=f'http://127.0.0.1:{server.server_port}/')
    assert not r['focus_changed'], 'Stop: browser changed focus'
    for attempt in range(20):
        windows = [w for w in call('computer_windows') if w['bundle_id']==bundle and marker in w['title']]
        if windows: break
        time.sleep(.25)
    assert windows, 'Fixture page did not open'
    time.sleep(.5)
    o = call('computer_observe', window_id=windows[0]['window_id'])
    button = next(e for e in o['elements'] if 'Freddai test button' in json.dumps(e) and e.get('AXRole')=='AXButton')
    if '--inspect-only' in sys.argv:
        assert any(e.get('AXRole')=='AXTextField' and 'Freddai test text' in json.dumps(e) for e in o['elements'])
        print(bundle+': page controls exposed through accessibility; interaction checks explicitly skipped.')
        sys.exit(0)
    o = call('computer_action', observation=o['observation'], action='press', element=button['id'])
    assert 'Pressed successfully' in json.dumps(o['elements'])
    field = next(e for e in o['elements'] if e.get('AXRole')=='AXTextField' and 'Freddai test text' in json.dumps(e))
    if '--expect-edit-unverified' in sys.argv:
        error = call('computer_action', _error=True, observation=o['observation'], action='set_value', element=field['id'], text='Browser edit verified')
        assert 'field value did not match' in error, error
        o = call('computer_observe', window_id=windows[0]['window_id'])
        print('Unsupported background text editing reported explicitly.')
    else:
        o = call('computer_action', observation=o['observation'], action='set_value', element=field['id'], text='Browser edit verified')
        assert any(e.get('value')=='Browser edit verified' for e in o['elements'])
    button = next(e for e in o['elements'] if 'Freddai test button' in json.dumps(e) and e.get('AXRole')=='AXButton')
    change_target = True
    time.sleep(.5)
    error = call('computer_action', _error=True, observation=o['observation'], action='press', element=button['id'])
    assert 'target or window changed' in error, error
    error = call('computer_action', _error=True, observation=o['observation'], action='press', element=button['id'])
    assert 'consumed observation' in error, error
    print(bundle+': background press succeeded despite animation; changed target and replay rejected.')
finally:
    p.stdin.close(); p.wait(timeout=5); server.shutdown(); server.server_close()
