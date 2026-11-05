"""Offline bidirectional protocol contract; never starts a provider or authenticates."""
import json, sys
provider = sys.argv[1]
scenario = sys.argv[2]
claude = provider == 'claude'
turn = 0
cancelled = False
permission_cancelled = False

def out(v):
    print(json.dumps(v), flush=True)

def permission():
    if claude:
        out({'type': 'control_request', 'request_id': f'permission-{turn}', 'request': {'subtype': 'can_use_tool', 'tool_name': 'Bash', 'input': {'command': 'fixture'}}})
    else:
        out({'id': 90 + turn, 'method': 'session/request_permission', 'params': {'sessionId': 'provider-session', 'options': [{'kind': 'allow_once', 'optionId': 'allow'}]}})

def text(value):
    if claude:
        out({'type': 'assistant', 'message': {'id': f'message-{turn}', 'content': [{'type': 'text', 'text': value}]}})
    else:
        out({'method': 'session/update', 'params': {'sessionId': 'provider-session', 'update': {'sessionUpdate': 'agent_message_chunk', 'content': {'type': 'text', 'text': value}}}})

for line in sys.stdin:
    v = json.loads(line)
    method = v.get('method')
    subtype = v.get('request', {}).get('subtype')
    if method == 'initialize':
        out({'id': 101, 'result': {'protocolVersion': 1, 'agentCapabilities': {'loadSession': True}, 'authMethods': [{'id': 'oauth-personal' if provider == 'gemini' else 'cached_token'}]}})
    elif method == 'authenticate':
        out({'id': 102, 'result': {}})
    elif method in ['session/new', 'session/load']:
        out({'id': 103, 'result': {'sessionId': 'provider-session', 'configOptions': [{'id': 'model', 'category': 'model', 'type': 'select', 'options': [{'value': 'fixture-model', 'name': 'Fixture'}]}]}})
    elif method == 'session/set_config_option':
        out({'id': 105, 'result': {}})
    elif subtype == 'initialize':
        out({'type': 'control_response', 'response': {'request_id': 'init', 'subtype': 'success'}})
    elif subtype == 'generate_session_title':
        out({'type': 'control_response', 'response': {'request_id': v['request_id'], 'subtype': 'success', 'response': {'title': 'Fixture'}}})
    elif method == 'session/cancel' or subtype == 'interrupt':
        assert turn == 1 and not cancelled
        cancelled = True
        if scenario == 'timeout':
            continue
        if claude and scenario == 'reject':
            out({'type': 'control_response', 'response': {'request_id': v['request_id'], 'subtype': 'error', 'error': 'Synthetic interruption rejection'}})
            continue
        if claude:
            if scenario == 'background-idle':
                out({'type': 'control_response', 'response': {'request_id': v['request_id'], 'subtype': 'success'}})
                continue
            if scenario == 'background-woke':
                out({'type': 'control_response', 'response': {'request_id': v['request_id'], 'subtype': 'success'}})
                # Make premature follow-up delivery observable in the next request assertion.
                import time
                time.sleep(0.1)
                out({'type': 'result', 'is_error': False})
                continue
            if scenario == 'ack-first':
                out({'type': 'control_response', 'response': {'request_id': v['request_id'], 'subtype': 'success'}})
                out({'type': 'result', 'is_error': False})
                continue
            # Result can precede the interrupt acknowledgement.
            out({'type': 'result', 'is_error': False})
            out({'type': 'control_response', 'response': {'request_id': v['request_id'], 'subtype': 'success'}})
        else:
            assert v['params']['sessionId'] == 'provider-session'
            out({'id': prompt_id, 'result': {'stopReason': 'cancelled'}})
    elif method == 'session/prompt' or v.get('type') == 'user':
        turn += 1
        assert turn <= 2
        content = v['message']['content'] if claude else v['params']['prompt']
        assert 'ATTACHMENT_FIXTURE_CONTENT' in json.dumps(content)
        if turn == 2:
            assert cancelled and permission_cancelled
            assert 'Revised direction' in json.dumps(content)
            assert (v['session_id'] if claude else v['params']['sessionId']) == 'provider-session'
        if claude:
            out({'type': 'system', 'subtype': 'init', 'session_id': 'provider-session'})
        else:
            prompt_id = v['id']
        text('Before interruption' if turn == 1 else 'After interruption')
        permission()
        if turn == 1 and scenario.startswith('background-'):
            out({'type': 'system', 'subtype': 'task_started', 'task_id': 'background-agent', 'task_type': 'local_agent'})
            out({'type': 'result', 'is_error': False})
            if scenario == 'background-woke':
                # Empty stream frame marks the resumed main-agent turn without adding text.
                out({'type': 'stream_event', 'event': {'type': 'message_start', 'message': {'id': 'wake'}}})
            out({'type': 'system', 'subtype': 'task_started', 'task_id': 'ready-marker', 'task_type': 'local_agent'})
    elif v.get('type') == 'control_response' or v.get('id') in [91, 92]:
        if turn == 1:
            if claude:
                assert v['response']['response']['behavior'] == 'deny'
            else:
                assert v['result']['outcome'] == {'outcome': 'cancelled'}
            permission_cancelled = True
        else:
            if claude:
                assert v['response']['response']['behavior'] == 'allow'
                if scenario.startswith('background-'):
                    for task in ['background-agent', 'ready-marker']:
                        out({'type': 'system', 'subtype': 'task_notification', 'task_id': task, 'status': 'completed'})
                out({'type': 'result', 'is_error': False})
            else:
                assert v['result']['outcome']['optionId'] == 'allow'
                out({'id': prompt_id, 'result': {'stopReason': 'end_turn'}})
