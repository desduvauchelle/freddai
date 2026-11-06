#!/usr/bin/env python3
"""Exercise the packaged MCP stdio bridge against an isolated, account-free host."""
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile
import time

binary = Path(sys.argv[1]).resolve()

def send(proc, value):
    proc.stdin.write(json.dumps(value) + '\n')
    proc.stdin.flush()

def receive(proc):
    ready, _, _ = select.select([proc.stdout], [], [], 15)
    assert ready, 'MCP response timed out'
    line = proc.stdout.readline()
    assert line, 'MCP exited before replying'
    return json.loads(line)

def request(proc, id, method, params=None):
    send(proc, {'jsonrpc': '2.0', 'id': id, 'method': method, 'params': params or {}})
    value = receive(proc)
    assert value['id'] == id, value
    return value

def tool(proc, id, name, arguments=None):
    return request(proc, id, 'tools/call', {'name': name, 'arguments': arguments or {}})

with tempfile.TemporaryDirectory(prefix='freddai-mcp-test-') as tmp:
    root = Path(tmp)
    # No accounts, sessions, credentials or live provider turns are created.
    host = subprocess.Popen([str(binary), '--host', tmp], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    bridge = None
    try:
        for _ in range(200):
            if (root / 'host.sock').exists(): break
            assert host.poll() is None, 'fixture host exited'
            time.sleep(.05)
        assert (root / 'host.sock').exists(), 'fixture host did not start'
        bridge = subprocess.Popen([str(binary), '--mcp', tmp], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        init = request(bridge, 1, 'initialize', {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'offline-test', 'version': '1'}})
        assert init['result']['serverInfo']['name'] == 'freddai'
        send(bridge, {'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        catalog = request(bridge, 2, 'tools/list')['result']['tools']
        assert len(catalog) == 9
        assert all(t['inputSchema']['additionalProperties'] is False for t in catalog)
        assert tool(bridge, 3, 'freddai_context')['result']['structuredContent']['ready'] is True
        assert tool(bridge, 4, 'freddai_list_projects')['result']['structuredContent']['projects'] == []
        assert tool(bridge, 5, 'freddai_list_agents')['result']['structuredContent']['agents'] == []
        assert tool(bridge, 6, 'freddai_list_threads')['result']['structuredContent']['items'] == []
        assert tool(bridge, 7, 'freddai_list_schedules')['result']['structuredContent']['items'] == []
        assert tool(bridge, 8, 'freddai_read_thread', {'thread': 'missing'})['result']['isError'] is True
        assert tool(bridge, 9, 'freddai_start_task', {'prompt': 'Never run', 'request_id': 'offline-check'})['result']['isError'] is True
        assert tool(bridge, 10, 'freddai_start_task', {'prompt': 'Never run', 'request_id': 'offline-check', 'permission_mode': 'bypass'})['error']['code'] == -32602
        assert tool(bridge, 11, 'respond', {})['error']['code'] == -32602
        assert request(bridge, 12, 'ping')['result'] == {}
        bridge.stdin.close()
        assert bridge.wait(timeout=5) == 0
        workspace = json.loads((root / 'workspace.json').read_text())
        assert workspace['accounts'] == [] and workspace['sessions'] == [] and workspace['schedules'] == []
        print('PASS: signed stdio handshake, catalog, readiness, reads, validation, missing-ID errors, clean EOF, zero accounts/turns')
    finally:
        if bridge and bridge.poll() is None:
            bridge.terminate()
            bridge.wait(timeout=5)
        # Only the isolated fixture host is stopped; never a real host or agent.
        host.terminate()
        host.wait(timeout=5)
