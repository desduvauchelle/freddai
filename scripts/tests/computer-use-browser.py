"""Read-only Safari toolbar regression, or opt-in public-page navigation smoke test.
No accounts, sign-ins, or provider turns. Uses the actual MCP helper.
"""
import json, subprocess, sys, time, uuid
p = subprocess.Popen([sys.argv[1]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
def call(name, **args):
    p.stdin.write(json.dumps(dict(jsonrpc='2.0', id=1, method='tools/call', params=dict(name=name, arguments=args)))+'\n'); p.stdin.flush()
    r = json.loads(p.stdout.readline())['result']
    assert not r.get('isError'), r
    return json.loads(r['content'][0]['text'])
try:
    if len(sys.argv) == 2:
        window = next(w for w in call('computer_windows') if w['bundle_id']=='com.apple.Safari')
        o = call('computer_observe', window_id=window['window_id'])
        fields = [e for e in o['elements'] if e.get('AXRole') in ('AXTextField', 'AXComboBox') and any(label in e.get('AXDescription','').lower() for label in ('address', 'smart search'))]
        assert fields, f"Safari address bar missing from {len(o['elements'])} observed elements"
        print('Safari address bar is observable.')
    else:
        bundle = sys.argv[2]
        marker = 'freddai-smoke-'+uuid.uuid4().hex
        result = call('computer_open_url', bundle_id=bundle, url='https://example.com/#'+marker)
        assert result['dispatched'] and not result['page_verified']
        for attempt in range(15):
            windows = [w for w in call('computer_windows') if w['bundle_id']==bundle and 'Example Domain' in w['title']]
            if windows:
                o = call('computer_observe', window_id=windows[0]['window_id'])
                assert any(e.get('AXRole')=='AXWebArea' and 'Example Domain' in json.dumps(e) for e in o['elements']), 'Browser/sidebar title alone is insufficient'
                if marker not in json.dumps(o['elements']):
                    time.sleep(.5)
                    continue
                print(f'{bundle}: Example Domain loaded and observed through native accessibility; focus_changed={result["focus_changed"]}.')
                break
            time.sleep(.5)
        else: raise AssertionError('Expected browser page did not appear')
finally:
    p.stdin.close(); p.wait(timeout=5)
