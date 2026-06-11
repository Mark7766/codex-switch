import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldCompact,
  compactHistory,
  extractCompactionTriggers,
  extractCompactionInputItems,
  buildCompactionOutputItem,
  type CompactOptions,
} from '../../electron/proxy/compact';
import type { ChatMessage } from '../../electron/proxy/translate';

// ── mock callDeepSeekSync ────────────────────────────────────────────────────

const mockCallDeepSeekSync = vi.fn();

vi.mock('../../electron/proxy/stream', () => ({
  callDeepSeekSync: (...args: unknown[]) => mockCallDeepSeekSync(...args),
}));

// ── helpers ─────────────────────────────────────────────────────────────────

function makeMessages(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as string,
    content: `message number ${i}`,
  }));
}

function defaultOpts(overrides?: Partial<CompactOptions>): CompactOptions {
  return { apiKey: 'sk-test', ...overrides };
}

// Reset mock between tests
beforeEach(() => {
  vi.clearAllMocks();
});

// ── shouldCompact ────────────────────────────────────────────────────────────

describe('shouldCompact', () => {
  it('returns false for messages ≤ default threshold (20)', () => {
    expect(shouldCompact(makeMessages(0))).toBe(false);
    expect(shouldCompact(makeMessages(5))).toBe(false);
    expect(shouldCompact(makeMessages(20))).toBe(false);
  });

  it('returns true for messages > default threshold (20)', () => {
    expect(shouldCompact(makeMessages(21))).toBe(true);
    expect(shouldCompact(makeMessages(156))).toBe(true);
  });

  it('respects custom threshold', () => {
    expect(shouldCompact(makeMessages(5), 10)).toBe(false);
    expect(shouldCompact(makeMessages(11), 10)).toBe(true);
  });
});

// ── compactHistory ───────────────────────────────────────────────────────────

describe('compactHistory', () => {
  it('short conversation → clone, no LLM call', async () => {
    const msgs = makeMessages(10);
    const result = await compactHistory(msgs, defaultOpts());
    expect(result.compacted).toBe(false);
    expect(result.method).toBe('clone');
    expect(result.compactedMessages).toEqual(msgs);
    expect(result.originalMessageCount).toBe(10);
    expect(result.compactedMessageCount).toBe(10);
    expect(mockCallDeepSeekSync).not.toHaveBeenCalled();
  });

  it('long conversation → calls LLM summary', async () => {
    mockCallDeepSeekSync.mockResolvedValueOnce({
      status: 200,
      body: { choices: [{ message: { content: '摘要文本：用户讨论了一个功能需求' } }] },
    });

    const msgs = makeMessages(50);
    const result = await compactHistory(msgs, defaultOpts());

    expect(mockCallDeepSeekSync).toHaveBeenCalledTimes(1);
    expect(result.compacted).toBe(true);
    expect(result.method).toBe('llm_summary');
    expect(result.originalMessageCount).toBe(50);
    // 1 summary + 10 recent = 11
    expect(result.compactedMessageCount).toBe(11);
    // first message is the system summary
    expect(result.compactedMessages[0].role).toBe('system');
    expect(result.compactedMessages[0].content).toContain('摘要文本');
    // check the summary prompt was included
    const callArgs = mockCallDeepSeekSync.mock.calls[0][0];
    expect(callArgs.model).toBe('deepseek-chat');
    expect(callArgs.messages[0].role).toBe('system');
    expect(callArgs.messages[0].content).toContain('对话摘要助手');
    // last message should be the "请基于以上对话生成摘要" prompt
    expect(callArgs.messages[callArgs.messages.length - 1].content).toBe(
      '请基于以上对话生成摘要',
    );
  });

  it('LLM timeout → fallback truncation', async () => {
    mockCallDeepSeekSync.mockImplementationOnce(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 20000),
        ),
    );

    const msgs = makeMessages(100);
    const result = await compactHistory(
      msgs,
      defaultOpts({ summaryTimeoutMs: 50 }),
    );

    expect(result.compacted).toBe(true);
    expect(result.method).toBe('truncation');
    expect(result.compactedMessageCount).toBeLessThanOrEqual(30);
    expect(result.error).toBeDefined();
  });

  it('LLM non-200 status → fallback truncation', async () => {
    mockCallDeepSeekSync.mockResolvedValueOnce({
      status: 500,
      body: { error: 'internal error' },
    });

    const msgs = makeMessages(60);
    const result = await compactHistory(msgs, defaultOpts());

    expect(result.compacted).toBe(true);
    expect(result.method).toBe('truncation');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('500');
  });

  it('LLM empty content → fallback truncation', async () => {
    mockCallDeepSeekSync.mockResolvedValueOnce({
      status: 200,
      body: { choices: [{ message: { content: '' } }] },
    });

    const msgs = makeMessages(25);
    const result = await compactHistory(msgs, defaultOpts());

    expect(result.method).toBe('truncation');
    expect(result.error).toContain('empty');
  });

  it('0 messages → clone with empty result', async () => {
    const result = await compactHistory([], defaultOpts());
    expect(result.compacted).toBe(false);
    expect(result.method).toBe('clone');
    expect(result.compactedMessages).toEqual([]);
    expect(result.originalMessageCount).toBe(0);
  });

  it('truncation strips trailing assistant messages', async () => {
    mockCallDeepSeekSync.mockResolvedValueOnce({
      status: 500,
      body: { error: 'fail' },
    });

    // create messages ending with assistant
    const msgs: ChatMessage[] = [
      ...makeMessages(25),
      { role: 'assistant', content: 'trailing 1' },
      { role: 'assistant', content: 'trailing 2' },
    ];
    const result = await compactHistory(msgs, defaultOpts());
    expect(result.method).toBe('truncation');
    // last message should NOT be assistant
    const last = result.compactedMessages[result.compactedMessages.length - 1];
    expect(last.role).not.toBe('assistant');
  });

  it('respects custom recentKeep and fallbackKeep', async () => {
    mockCallDeepSeekSync.mockResolvedValueOnce({
      status: 500,
      body: { error: 'fail' },
    });

    const msgs = makeMessages(80);
    const result = await compactHistory(
      msgs,
      defaultOpts({ recentKeep: 5, fallbackKeep: 15 }),
    );

    expect(result.method).toBe('truncation');
    expect(result.compactedMessageCount).toBeLessThanOrEqual(15);
  });
});

// ── extractCompactionTriggers ──────────────────────────────────────────────────

describe('extractCompactionTriggers', () => {
  it('returns empty when no compaction_trigger items in input', () => {
    const input = [
      { type: 'message', role: 'user', content: 'hi' },
      { type: 'function_call', call_id: 'c1', name: 'run' },
    ];
    const result = extractCompactionTriggers(input);
    expect(result.compactionTriggers).toHaveLength(0);
    expect(result.filteredInput).toHaveLength(2);
    expect(result.filteredInput).toEqual(input);
  });

  it('extracts and removes compaction_trigger items', () => {
    const input = [
      { type: 'compaction_trigger' },
      { type: 'message', role: 'user', content: 'hello' },
      { type: 'compaction_trigger', id: 'ct_2' },
      { type: 'function_call', call_id: 'c1' },
    ];
    const result = extractCompactionTriggers(input);
    expect(result.compactionTriggers).toHaveLength(2);
    expect(result.compactionTriggers[0].type).toBe('compaction_trigger');
    expect(result.filteredInput).toHaveLength(2);
    expect((result.filteredInput[0] as Record<string, unknown>).type).toBe('message');
    expect((result.filteredInput[1] as Record<string, unknown>).type).toBe('function_call');
  });

  it('handles empty input array', () => {
    const result = extractCompactionTriggers([]);
    expect(result.compactionTriggers).toHaveLength(0);
    expect(result.filteredInput).toHaveLength(0);
  });

  it('handles non-array input gracefully', () => {
    const result = extractCompactionTriggers(null as unknown as unknown[]);
    expect(result.compactionTriggers).toHaveLength(0);
    expect(result.filteredInput).toHaveLength(0);
  });

  it('handles input with only compaction_trigger items', () => {
    const input = [
      { type: 'compaction_trigger' },
      { type: 'compaction_trigger' },
    ];
    const result = extractCompactionTriggers(input);
    expect(result.compactionTriggers).toHaveLength(2);
    expect(result.filteredInput).toHaveLength(0);
  });
});

// ── buildCompactionOutputItem ──────────────────────────────────────────────────

describe('buildCompactionOutputItem', () => {
  it('returns correctly shaped compaction output item', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: '[对话历史摘要] 用户讨论了功能需求' },
      { role: 'user', content: '最近的提问' },
    ];
    const compactResult = {
      compacted: true,
      method: 'llm_summary' as const,
      compactedId: 'resp_compact_abc123',
      compactedMessages: msgs,
      originalMessageCount: 50,
      compactedMessageCount: 2,
    };

    const item = buildCompactionOutputItem(compactResult);

    expect(item.type).toBe('compaction');
    expect(typeof item.id).toBe('string');
    expect((item.id as string).startsWith('comp_')).toBe(true);
    expect((item.id as string).length).toBeGreaterThan('comp_'.length);
    expect(typeof item.encrypted_content).toBe('string');

    // Verify round-trip decode
    const decoded = JSON.parse(
      Buffer.from(item.encrypted_content as string, 'base64').toString('utf-8'),
    );
    expect(decoded.compactedId).toBe('resp_compact_abc123');
    expect(decoded.messages).toEqual(msgs);
    expect(typeof decoded.timestamp).toBe('number');
  });

  it('generates unique IDs across multiple calls', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const compactResult = {
      compacted: true,
      method: 'clone' as const,
      compactedId: 'resp_compact_test',
      compactedMessages: msgs,
      originalMessageCount: 1,
      compactedMessageCount: 1,
    };

    const item1 = buildCompactionOutputItem(compactResult);
    const item2 = buildCompactionOutputItem(compactResult);
    expect(item1.id).not.toBe(item2.id);
  });
});

// ── extractCompactionInputItems ────────────────────────────────────────────────

describe('extractCompactionInputItems', () => {
  it('decodes valid compaction items and returns messages', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: '[摘要] 之前的对话' },
      { role: 'user', content: '旧消息' },
    ];
    const payload = Buffer.from(
      JSON.stringify({ compactedId: 'c1', messages: msgs, timestamp: Date.now() }),
    ).toString('base64');

    const input = [
      { type: 'compaction', id: 'comp_1', encrypted_content: payload },
      { type: 'message', role: 'user', content: 'next question' },
    ];

    const result = extractCompactionInputItems(input);
    expect(result.messages).toEqual(msgs);
    expect(result.filteredInput).toHaveLength(1);
    expect((result.filteredInput[0] as Record<string, unknown>).type).toBe('message');
  });

  it('returns null for corrupted base64 content', () => {
    const input = [
      { type: 'compaction', id: 'comp_1', encrypted_content: 'not-valid-base64!!!' },
      { type: 'message', role: 'user', content: 'hi' },
    ];
    const result = extractCompactionInputItems(input);
    expect(result.messages).toBeNull();
    expect(result.filteredInput).toHaveLength(1); // message still passed through
  });

  it('returns null for missing messages field in payload', () => {
    const payload = Buffer.from(
      JSON.stringify({ compactedId: 'c1', timestamp: Date.now() }),
    ).toString('base64');
    const input = [
      { type: 'compaction', id: 'comp_1', encrypted_content: payload },
    ];
    const result = extractCompactionInputItems(input);
    expect(result.messages).toBeNull();
  });

  it('returns null for empty messages array in payload', () => {
    const payload = Buffer.from(
      JSON.stringify({ compactedId: 'c1', messages: [], timestamp: Date.now() }),
    ).toString('base64');
    const input = [
      { type: 'compaction', id: 'comp_1', encrypted_content: payload },
    ];
    const result = extractCompactionInputItems(input);
    expect(result.messages).toBeNull();
  });

  it('handles empty input gracefully', () => {
    const result = extractCompactionInputItems([]);
    expect(result.messages).toBeNull();
    expect(result.filteredInput).toHaveLength(0);
  });

  it('handles non-array input gracefully', () => {
    const result = extractCompactionInputItems(null as unknown as unknown[]);
    expect(result.messages).toBeNull();
    expect(result.filteredInput).toHaveLength(0);
  });

  it('filters multiple compaction items, uses first valid one', () => {
    const msgs1: ChatMessage[] = [{ role: 'system', content: '[摘要1]' }];
    const msgs2: ChatMessage[] = [{ role: 'system', content: '[摘要2]' }];
    const payload1 = Buffer.from(
      JSON.stringify({ compactedId: 'c1', messages: msgs1, timestamp: Date.now() }),
    ).toString('base64');
    const payload2 = Buffer.from(
      JSON.stringify({ compactedId: 'c2', messages: msgs2, timestamp: Date.now() }),
    ).toString('base64');

    const input = [
      { type: 'compaction', id: 'comp_1', encrypted_content: payload1 },
      { type: 'compaction', id: 'comp_2', encrypted_content: payload2 },
      { type: 'message', role: 'user', content: 'next' },
    ];

    const result = extractCompactionInputItems(input);
    expect(result.messages).toEqual(msgs1); // first valid compaction wins
    expect(result.filteredInput).toHaveLength(1); // only the message remains
  });

  it('skips compaction items without encrypted_content', () => {
    const input = [
      { type: 'compaction', id: 'comp_1' }, // no encrypted_content
      { type: 'message', role: 'user', content: 'hi' },
    ];
    const result = extractCompactionInputItems(input);
    expect(result.messages).toBeNull();
    expect(result.filteredInput).toHaveLength(2); // both items passed through
  });
});
