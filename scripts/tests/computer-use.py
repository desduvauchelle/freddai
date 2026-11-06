"""MCP transport/permission checks; no credentials, accounts or provider turns."""
import json, subprocess, sys, fcntl, pathlib
binary = sys.argv[1]
p = subprocess.Popen([binary], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
def rpc(method, params=None):
    rpc.id += 1
    p.stdin.write(json.dumps(dict(jsonrpc='2.0', id=rpc.id, method=method, params=params or {}))+'\n'); p.stdin.flush()
    result = json.loads(p.stdout.readline())
    assert result['id'] == rpc.id and result['jsonrpc'] == '2.0'
    return result
rpc.id = 0
try:
    init = rpc('initialize')['result']
    assert init['protocolVersion'] == '2024-11-05'
    p.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n'); p.stdin.flush()
    assert rpc('ping')['result'] == {}
    catalog = rpc('tools/list')['result']['tools']
    assert len({t['name'] for t in catalog}) == 7
    assert 'computer_open_url' in {t['name'] for t in catalog}
    for url in ['javascript:alert(1)', 'file:///tmp/test', 'https://', 'https://user:secret@example.com', 'not a URL']:
        rejected = rpc('tools/call', {'name':'computer_open_url','arguments':{'bundle_id':'com.apple.Safari','url':url}})['result']
        assert rejected.get('isError') and 'HTTP(S)' in rejected['content'][0]['text'], rejected
    missing = rpc('tools/call', {'name':'computer_open_url','arguments':{'bundle_id':'invalid.freddai.browser','url':'https://example.com'}})['result']
    assert missing.get('isError') and 'not found' in missing['content'][0]['text']
    lock_path = pathlib.Path.home()/'Library/Application Support/com.freddai.desktop/computer-use.lock'
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        busy = rpc('tools/call', {'name':'computer_open_url','arguments':{'bundle_id':'com.apple.Safari','url':'https://example.com'}})['result']
        assert busy.get('isError') and 'Another Freddai agent' in busy['content'][0]['text'], busy
    for t in catalog: assert t['inputSchema']['additionalProperties'] is False
    assert rpc('unknown')['error']['code'] == -32601
    assert rpc('tools/call', {'name':'unknown'})['result']['isError']
    assert rpc('tools/call', {'name':'computer_observe','arguments':{}})['result']['isError']
    status = json.loads(rpc('tools/call', {'name':'computer_status'})['result']['content'][0]['text'])
    assert isinstance(status['accessibility'],bool) and isinstance(status['screen_recording'],bool)
    assert status['foreground_requires_idle_seconds'] == 2
    assert status['foreground_allows_idle_focused_editor'] is True
    assert status['foreground_protects_editing'] is False
    print('MCP initialize, notifications, ping, schemas, errors and permission status passed.')
    print('Native permissions:', json.dumps(status))
    if not all(status[k] for k in ('accessibility','screen_recording')):
        denied = rpc('tools/call', {'name':'computer_action','arguments':{'action':'click','observation':'invalid','x':0,'y':0}})['result']
        assert denied['isError']
        print('Action correctly refused without required permissions. Interactive verification requires user grants.')
finally:
    p.stdin.close(); p.wait(timeout=5)
    assert p.returncode == 0
