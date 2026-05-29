import { describe, it, expect } from 'vitest';
import {
  itemsToMessages,
  normalizeRole,
  fixOrphanedToolResults,
  extractTools,
  mapModel,
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
  it('flattens content array', () => {
    const out = itemsToMessages([
      { role: 'user', content: [{ text: 'a' }, 'b', { text: 'c' }] },
    ]);
    expect(out).toEqual([{ role: 'user', content: 'a\nb\nc' }]);
  });
  it('returns empty for non-array', () => {
    expect(itemsToMessages(null)).toEqual([]);
  });
});

describe('fixOrphanedToolResults', () => {
  it('injects missing function_call before orphan output', () => {
    const lastToolCalls = [
      { type: 'function_call', call_id: 'c1', name: 'sh', arguments: '{}' },
    ];
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
  it('returns requested if unknown', () => {
    expect(mapModel('foo', mapping)).toBe('foo');
  });
  it('falls back when empty', () => {
    expect(mapModel(undefined, mapping)).toBe('deepseek-v4-flash');
  });
});
