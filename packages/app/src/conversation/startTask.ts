import type { Message } from '../desktop/types';

export type StartedTask = { key: string; threadId?: string; error?: string; held?: boolean; title?: string };

const TOOL = /(^|__)freddai_start_task$/;
const record = (v: unknown): Record<string, unknown> | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const parse = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };

/** Unwraps the Freddai MCP result from any provider envelope: structuredContent, content text blocks, ACP content wrappers or a bare payload. */
function payloadOf(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (depth > 4 || value == null) return undefined;
  if (typeof value === 'string') return payloadOf(parse(value), depth + 1);
  if (Array.isArray(value)) {
    for (const item of value) { const found = payloadOf(item, depth + 1); if (found) return found; }
    return undefined;
  }
  const obj = record(value)!;
  if (record(obj.structuredContent)) return record(obj.structuredContent);
  if ('thread' in obj || 'ok' in obj || 'held' in obj || 'error' in obj) return obj;
  for (const key of ['content', 'text', 'rawOutput', 'result', 'output']) { const found = payloadOf(obj[key], depth + 1); if (found) return found; }
  return undefined;
}

function outcome(key: string, raw: unknown, isError: boolean): StartedTask | undefined {
  const p = payloadOf(raw);
  if (p) {
    const thread = typeof p.thread === 'string' ? p.thread : typeof p.thread_id === 'string' ? p.thread_id : undefined;
    const title = typeof p.title === 'string' ? p.title : undefined;
    if (thread && p.ok !== false) return { key, threadId: thread, title };
    if (p.held === true) return { key, held: true };
    if (p.ok === false || p.error) return { key, error: typeof p.error === 'string' ? p.error : 'Task failed to start' };
  }
  if (isError) {
    const text = typeof raw === 'string' ? raw : record(Array.isArray(raw) ? raw[0] : raw)?.text;
    return { key, error: typeof text === 'string' && text ? text.slice(0, 200) : 'Task failed to start' };
  }
  return undefined;
}

/**
 * Finds `freddai_start_task` calls in a tool group and pairs each with its outcome.
 * Claude records the call and its result as separate messages (paired by tool_use id); Codex and ACP carry both in one.
 * Calls without a parseable result yet (still running, or elided output) produce nothing.
 */
export function parseStartedTasks(messages: readonly Message[]): StartedTask[] {
  const calls: string[] = [];
  const results = new Map<string, { content: unknown; isError: boolean }>();
  const done: StartedTask[] = [];
  for (const m of messages) {
    if (m.toolTextBytes != null) continue;
    if (!m.text.includes('freddai_start_task') && !m.text.includes('tool_result')) continue;
    const obj = record(parse(m.text));
    if (!obj) continue;
    if (obj.type === 'tool_use' && typeof obj.name === 'string' && TOOL.test(obj.name) && typeof obj.id === 'string') calls.push(obj.id);
    else if (obj.type === 'tool_result' && typeof obj.tool_use_id === 'string') results.set(obj.tool_use_id, { content: obj.content, isError: obj.is_error === true });
    else if (obj.type === 'mcpToolCall' && typeof obj.tool === 'string' && TOOL.test(obj.tool)) {
      const found = outcome(m.id, obj.result ?? obj.error, obj.status === 'failed' || (obj.result == null && obj.error != null));
      if (found) done.push(found);
    } else if (typeof obj.toolCallId === 'string' && [obj.title, obj.name, obj.kind].some(v => typeof v === 'string' && v.includes('freddai_start_task'))) {
      const found = outcome(obj.toolCallId, obj.rawOutput ?? obj.content, obj.status === 'failed');
      if (found) done.push(found);
    }
  }
  const claude = calls.flatMap(id => { const r = results.get(id); const found = r && outcome(id, r.content, r.isError); return found ? [found] : []; });
  return [...claude, ...done];
}
