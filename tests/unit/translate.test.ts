import { describe, it, expect } from 'vitest';
import {
  itemsToMessages,
  normalizeRole,
  fixOrphanedToolResults,
  fixToolMessageOrder,
  extractTools,
  mapModel,
  resolveModel,
} from '../../electron/proxy/translate';

describe('normalizeRole', () => {
  it('maps developer → system', () => {
    expect(normalizeRole('developer')).toBe('system');
  });
  it('keeps valid roles', () => {
    expect(normalizeRole('assistant')).toBe('assistant');
    expect(normalizeRole('tool')).toBe('tool');
  });
  it('falls back to user for unknown', () => {
    expect(normalizeRole('robot')).toBe('user');
    expect(normalizeRole(undefined)).toBe('user');
  });
});

describe('itemsToMessages', () => {
  it('string item becomes user message', () => {
    expect(itemsToMessages(['hi'])).toEqual([{ role: 'user', content: 'hi' }]);
  });
  it('handles function_call_output', () => {
    const out = itemsToMessages([
      { type: 'function_call_output', call_id: 'c1', output: 'result' },
    ]);
    expect(out).toEqual([{ role: 'tool', tool_call_id: 'c1', content: 'result' }]);
  });
  it('handles function_call with reasoning replay', () => {
    const m = new Map([['c1', 'thinking...']]);
    const out = itemsToMessages(
      [{ type: 'function_call', call_id: 'c1', name: 'sh', arguments: '{"cmd":"ls"}' }],
      m,
    );
    expect(out[0]?.tool_calls?.[0]?.id).toBe('c1');
    expect(out[0]?.tool_calls?.[0]?.function.name).toBe('sh');
    expect(out[0]?.reasoning_content).toBe('thinking...');
    expect(out[0]?.content).toBeNull();
  });
  it('groups consecutive function_calls into ONE assistant message', () => {
    // DeepSeek requires all tool_calls in one turn to be in a single assistant message
    const out = itemsToMessages([
      { type: 'function_call', call_id: 'c1', name: 'sh', arguments: '{"cmd":"ls"}' },
      { type: 'function_call', call_id: 'c2', name: 'read', arguments: '{"path":"x"}' },
      { type: 'function_call', call_id: 'c3', name: 'write', arguments: '{"path":"y"}' },
      { type: 'function_call_output', call_id: 'c1', output: 'result1' },
      { type: 'function_call_output', call_id: 'c2', output: 'result2' },
      { type: 'function_call_output', call_id: 'c3', output: 'result3' },
    ]);
    // Must produce: 1 assistant message + 3 tool messages (not 3 assistant messages)
    expect(out).toHaveLength(4);
    expect(out[0]?.role).toBe('assistant');
    expect(out[0]?.tool_calls).toHaveLength(3);
    expect(out[0]?.tool_calls?.[0]?.id).toBe('c1');
    expect(out[0]?.tool_calls?.[1]?.id).toBe('c2');
    expect(out[0]?.tool_calls?.[2]?.id).toBe('c3');
    expect(out[1]?.role).toBe('tool');
    expect(out[2]?.role).toBe('tool');
    expect(out[3]?.role).toBe('tool');
  });
  it('handles multi-turn with separate function_call groups', () => {
    const out = itemsToMessages([
      { role: 'user', content: 'hello' },
      { type: 'function_call', call_id: 'a1', name: 'sh', arguments: '{}' },
      { type: 'function_call', call_id: 'a2', name: 'read', arguments: '{}' },
      { type: 'function_call_output', call_id: 'a1', output: 'r1' },
      { type: 'function_call_output', call_id: 'a2', output: 'r2' },
      { role: 'user', content: 'next' },
      { type: 'function_call', call_id: 'b1', name: 'write', arguments: '{}' },
      { type: 'function_call_output', call_id: 'b1', output: 'r3' },
    ]);
    // user + assistant(2 tools) + tool + tool + user + assistant(1 tool) + tool = 7
    expect(out).toHaveLength(7);
    // First group: 2 tool_calls in 1 assistant message
    expect(out[1]?.role).toBe('assistant');
    expect(out[1]?.tool_calls).toHaveLength(2);
    // Second group: 1 tool_call in 1 assistant message
    expect(out[5]?.role).toBe('assistant');
    expect(out[5]?.tool_calls).toHaveLength(1);
  });
  it('flattens content array', () => {
    const out = itemsToMessages([{ role: 'user', content: [{ text: 'a' }, 'b', { text: 'c' }] }]);
    expect(out).toEqual([{ role: 'user', content: 'a\nb\nc' }]);
  });
  it('returns empty for non-array', () => {
    expect(itemsToMessages(null)).toEqual([]);
  });
});

describe('fixOrphanedToolResults', () => {
  it('injects missing function_call before orphan output', () => {
    const lastToolCalls = [{ type: 'function_call', call_id: 'c1', name: 'sh', arguments: '{}' }];
    const input = [{ type: 'function_call_output', call_id: 'c1', output: 'ok' }];
    const out = fixOrphanedToolResults(input, lastToolCalls);
    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe('function_call');
    expect(out[1]?.type).toBe('function_call_output');
  });
  it('passes through when call_id matches existing function_call', () => {
    const input = [
      { type: 'function_call', call_id: 'c1', name: 'x' },
      { type: 'function_call_output', call_id: 'c1', output: 'r' },
    ];
    const out = fixOrphanedToolResults(input, [{ type: 'function_call', call_id: 'c1' }]);
    expect(out).toHaveLength(2);
  });
  it('uses fallback last tool call when id mismatch', () => {
    const out = fixOrphanedToolResults(
      [{ type: 'function_call_output', call_id: 'cX', output: 'r' }],
      [{ type: 'function_call', call_id: 'cY', name: 'sh' }],
    );
    expect(out[0]?.call_id).toBe('cX');
  });
});

describe('extractTools', () => {
  it('drops web_search variants', () => {
    expect(extractTools([{ type: 'web_search', name: 'web' }])).toBeUndefined();
  });
  it('extracts function with defaults', () => {
    const out = extractTools([{ type: 'function', name: 'sh' }]);
    expect(out).toEqual([
      {
        type: 'function',
        function: { name: 'sh', description: '', parameters: { type: 'object', properties: {} } },
      },
    ]);
  });
  it('respects nested function.* shape', () => {
    const out = extractTools([
      { type: 'function', function: { name: 'sh', description: 'shell', parameters: { x: 1 } } },
    ]);
    expect(out?.[0]?.function.description).toBe('shell');
  });
});

describe('mapModel', () => {
  const mapping = { 'gpt-5-codex': 'deepseek-v4-flash', o1: 'deepseek-v4-pro' };
  it('maps known model', () => {
    expect(mapModel('gpt-5-codex', mapping)).toBe('deepseek-v4-flash');
  });
  it('falls back to default for unknown unmapped name (not pass-through)', () => {
    expect(mapModel('foo-bar-unknown', {}, 'deepseek-v4-flash')).toBe('deepseek-v4-flash');
  });
  it('falls back when empty', () => {
    expect(mapModel(undefined, mapping)).toBe('deepseek-v4-flash');
  });
  it('passes through deepseek whitelist names', () => {
    expect(mapModel('deepseek-v4-pro', {}, 'deepseek-v4-flash')).toBe('deepseek-v4-pro');
    expect(mapModel('deepseek-reasoner', {}, 'deepseek-v4-flash')).toBe('deepseek-reasoner');
  });
  it('uses prefix rule for unknown gpt-* (e.g. gpt-5.4-mini)', () => {
    expect(mapModel('gpt-5.4-mini', {}, 'deepseek-v4-flash')).toBe('deepseek-v4-flash');
    expect(mapModel('gpt-99-future', {}, 'deepseek-v4-flash')).toBe('deepseek-v4-flash');
  });
  it('uses prefix rule for o1/o3 family', () => {
    expect(mapModel('o3', {}, 'deepseek-v4-flash')).toBe('deepseek-v4-pro');
    expect(mapModel('o3-mini', {}, 'deepseek-v4-flash')).toBe('deepseek-v4-flash');
  });
});

describe('resolveModel', () => {
  it('reports exact match when mapping hits', () => {
    expect(resolveModel('gpt-5-codex', { 'gpt-5-codex': 'deepseek-v4-pro' }).matched).toBe('exact');
  });
  it('reports whitelist match when DeepSeek native name passed', () => {
    expect(resolveModel('deepseek-v4-pro', {}).matched).toBe('whitelist');
  });
  it('reports prefix match when only prefix rule applies', () => {
    expect(resolveModel('gpt-5.4-mini', {}).matched).toBe('prefix');
  });
  it('reports fallback when nothing matches', () => {
    expect(resolveModel('totally-unknown-model', {}).matched).toBe('fallback');
  });
  it('reports fallback when requested is empty', () => {
    expect(resolveModel(undefined, {}).matched).toBe('fallback');
  });
});

describe('fixToolMessageOrder', () => {
  const makeAssistant = (ids: string[]) => ({
    role: 'assistant' as const,
    content: null,
    tool_calls: ids.map((id) => ({ id, type: 'function' as const, function: { name: 'sh', arguments: '{}' } })),
  });
  const makeTool = (id: string) => ({ role: 'tool' as const, content: 'ok', tool_call_id: id });
  const makeUser = (content: string) => ({ role: 'user' as const, content });

  it('no-ops when no assistant tool_calls present', () => {
    const msgs = [makeUser('hi'), { role: 'assistant' as const, content: 'hello' }];
    expect(fixToolMessageOrder(msgs)).toEqual(msgs);
  });

  it('no-ops when tool messages already follow immediately', () => {
    const msgs = [makeUser('run'), makeAssistant(['c1', 'c2']), makeTool('c1'), makeTool('c2')];
    expect(fixToolMessageOrder(msgs)).toEqual(msgs);
  });

  it('moves tool messages before interleaved regular messages', () => {
    // Simulates: assistant{tool_calls} + 3 approval msgs + 3 tool results
    const msgs = [
      makeUser('start'),
      makeAssistant(['c1', 'c2', 'c3']),
      makeUser('Approved command 1'),
      makeUser('Approved command 2'),
      makeUser('Approved command 3'),
      makeTool('c1'),
      makeTool('c2'),
      makeTool('c3'),
    ];
    const fixed = fixToolMessageOrder(msgs);
    // assistant must be immediately followed by 3 tool messages
    expect(fixed[2]?.role).toBe('tool');
    expect(fixed[3]?.role).toBe('tool');
    expect(fixed[4]?.role).toBe('tool');
    // approval messages are deferred to after tool block
    expect(fixed[5]?.role).toBe('user');
    expect(fixed[6]?.role).toBe('user');
    expect(fixed[7]?.role).toBe('user');
    expect(fixed).toHaveLength(msgs.length);
  });

  it('only reorders for the last assistant{tool_calls} block', () => {
    const msgs = [
      makeAssistant(['a1']),
      makeTool('a1'),
      makeUser('next turn'),
      makeAssistant(['b1', 'b2']),
      makeUser('approval'),
      makeTool('b1'),
      makeTool('b2'),
    ];
    const fixed = fixToolMessageOrder(msgs);
    // Second block: tool messages should come before the approval user message
    expect(fixed[4]?.role).toBe('tool');
    expect(fixed[5]?.role).toBe('tool');
    expect(fixed[6]?.role).toBe('user');
  });
});
