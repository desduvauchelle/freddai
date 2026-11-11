# Fake agent for day-summary tests. argv[1] = codex | claude | fail. Never a live provider.
import sys, json
mode = sys.argv[1]
def out(v): print(json.dumps(v), flush=True)
REPLY = "## Project A\n- Fixed the login redirect\n- Open: needs review"
if mode == 'claude':
    prompt = sys.stdin.read()
    assert 'Project A' in prompt
    print(REPLY, flush=True)
elif mode == 'fail':
    sys.stderr.write('boom\n'); sys.exit(3)
else:
    for line in sys.stdin:
        v = json.loads(line)
        m = v.get('method')
        if m == 'initialize': out({'id': 1, 'result': {}})
        elif m == 'model/list': out({'id':v['id'],'result':{'data':[{'model':'gpt-6.1-sol','supportedReasoningEfforts':[{'reasoningEffort':'medium'}]}]}})
        elif m == 'thread/start':
            assert v['params']['ephemeral'] is True and v['params']['sandbox'] == 'read-only'
            out({'id': 2, 'result': {'thread': {'id': 'side'}}})
        elif m == 'turn/start':
            assert 'Project A' in json.dumps(v['params']['input'])
            out({'id': 3, 'result': {'turn': {'id': 't'}}})
            out({'method': 'item/completed', 'params': {'threadId': 'side', 'item': {'type': 'agentMessage', 'text': REPLY}}})
            out({'method': 'turn/completed', 'params': {'threadId': 'side', 'turn': {'status': 'completed'}}})
