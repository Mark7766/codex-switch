import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldCompact,
  compactHistory,
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
