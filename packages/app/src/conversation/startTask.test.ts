import { describe, expect, it } from 'vitest';
import { parseStartedTasks } from './startTask';

const msg = (id: string, value: unknown) => ({ id, role: 'tool', text: JSON.stringify(value, null, 2) });
const mcp = (payload: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload });
const use = (id: string, name = 'mcp__freddai__freddai_start_task') => msg(id, { type: 'tool_use', id, name, input: { prompt: 'x' } });

describe('parseStartedTasks', () => {
  it('pairs a Claude tool_use with its tool_result by id', () => {
    const result = msg('result-t1', { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: JSON.stringify({ thread: 'abc' }) }] });
    expect(parseStartedTasks([use('t1'), result])).toEqual([{ key: 't1', threadId: 'abc', title: undefined }]);
  });
  it('reads a string tool_result content and structuredContent', () => {
    const result = msg('result-t1', { type: 'tool_result', tool_use_id: 't1', content: JSON.stringify({ thread: 'abc', title: 'Fix login' }) });
    expect(parseStartedTasks([use('t1'), result])[0]).toMatchObject({ threadId: 'abc', title: 'Fix login' });
  });
  it('reads a Codex mcpToolCall', () => {
    const call = msg('c1', { type: 'mcpToolCall', server: 'freddai', tool: 'freddai_start_task', arguments: {}, status: 'completed', result: mcp({ thread: 'xyz' }) });
    expect(parseStartedTasks([call])).toMatchObject([{ threadId: 'xyz' }]);
  });
  it('reads an ACP tool_call_update', () => {
    const update = msg('a1', { sessionUpdate: 'tool_call_update', toolCallId: 'k1', title: 'freddai: freddai_start_task', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: JSON.stringify({ thread: 'acp1' }) } }] });
    expect(parseStartedTasks([update])).toMatchObject([{ threadId: 'acp1' }]);
  });
  it('reports a held start without a thread', () => {
    const result = msg('result-t1', { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: JSON.stringify({ ok: true, held: true, proposal_id: 'p', message: 'held' }) }] });
    expect(parseStartedTasks([use('t1'), result])).toEqual([{ key: 't1', held: true }]);
  });
  it('reports errors', () => {
    const result = msg('result-t1', { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'No such project' }) }] });
    expect(parseStartedTasks([use('t1'), result])).toEqual([{ key: 't1', error: 'No such project' }]);
    const plain = msg('result-t2', { type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'boom' });
    expect(parseStartedTasks([use('t2'), plain])).toEqual([{ key: 't2', error: 'boom' }]);
  });
  it('ignores calls with no result, other tools, elided and plain text records', () => {
    const other = msg('o', { type: 'tool_use', id: 'o', name: 'Bash', input: {} });
    const elided = { ...msg('e', { type: 'mcpToolCall', tool: 'freddai_start_task' }), toolTextBytes: 9000 };
    expect(parseStartedTasks([use('t1'), other, elided, { id: 'p', role: 'tool', text: 'ls -la' }])).toEqual([]);
  });
});
