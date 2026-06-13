/**
 * WS handler tests — message parsing, suggestion blocking, compaction trigger.
 * Mocks streamDeepSeek to avoid real network I/O.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleWs } from '../../electron/proxy/ws-handler';
import type { WsHandlerDeps } from '../../electron/proxy/ws-handler';
import type { ConversationStore } from '../../electron/proxy/conversation-store';

vi.mock('../../electron/proxy/stream', () => ({
  streamDeepSeek: vi.fn().mockResolvedValue({
    outputItems: [],
    finishReason: 'stop',
    endTurn: true,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  }),
}));

function mockWs(): {
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  readyState: number;
  _triggerMessage: (data: unknown) => void;
} {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    send: vi.fn(),
    ping: vi.fn(),
    readyState: 1,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = cb;
    }),
    _triggerMessage(data: unknown) {
      const cb = handlers['message'];
      if (cb) cb(data);
    },
  };
}

function makeDeps(overrides?: Partial<WsHandlerDeps>): WsHandlerDeps {
  return {
    apiKey: 'sk-test',
    modelMapping: {},
    defaultModel: 'deepseek-v4-flash',
    blockBackgroundSuggestions: true,
    agent: {} as never,
    conversationStore: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      markDirty: vi.fn(),
    } as unknown as ConversationStore,
    reasoning: { asMap: vi.fn().mockReturnValue({}) } as unknown as WsHandlerDeps['reasoning'],
    stats: { total: 0, pendingDelta: 0, pendingInputTokensDelta: 0, pendingOutputTokensDelta: 0 },
    log: vi.fn(),
    recordSuccess: vi.fn(),
    recordError: vi.fn(),
    resolveAndWarn: vi.fn((m) => m ?? 'deepseek-v4-pro'),
    emit: vi.fn(),
    newReqId: () => 'ws_test',
    isSuggestionRequest: vi.fn().mockReturnValue(true),
    processWsCompact: vi.fn(),
    compactAndStore: vi.fn(),
    ...overrides,
  };
}

describe('handleWs', () => {
  it('handles JSON parse error gracefully', () => {
    const ws = mockWs();
    const deps = makeDeps();
    handleWs(ws as unknown as Parameters<typeof handleWs>[0], deps);
    ws._triggerMessage(Buffer.from('not json'));
    expect(deps.log).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('routes response.compact to processWsCompact', () => {
    const ws = mockWs();
    const deps = makeDeps();
    handleWs(ws as unknown as Parameters<typeof handleWs>[0], deps);
    ws._triggerMessage(
      Buffer.from(
        JSON.stringify({ type: 'response.compact', response: { previous_response_id: 'prev1' } }),
      ),
    );
    expect(deps.processWsCompact).toHaveBeenCalled();
  });

  it('blocks suggestion requests', () => {
    const ws = mockWs();
    const deps = makeDeps({ isSuggestionRequest: vi.fn().mockReturnValue(true) });
    handleWs(ws as unknown as Parameters<typeof handleWs>[0], deps);
    ws._triggerMessage(
      Buffer.from(
        JSON.stringify({
          type: 'response.create',
          model: 'gpt-5-codex',
          input: [{ type: 'message', role: 'user', content: 'suggestion prompt' }],
        }),
      ),
    );
    expect(ws.send).toHaveBeenCalled();
    const call = (deps.recordSuccess as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('ws_test');
    expect(call[5]).toBe(200);
    expect(call[6].finishReason).toBe('blocked-suggestion');
    expect(call[6].endTurn).toBe(true);
  });

  it('blocks empty warmup requests', () => {
    const ws = mockWs();
    const deps = makeDeps({ isSuggestionRequest: vi.fn().mockReturnValue(false) });
    handleWs(ws as unknown as Parameters<typeof handleWs>[0], deps);
    ws._triggerMessage(Buffer.from(JSON.stringify({ type: 'response.create', input: [] })));
    expect(ws.send).toHaveBeenCalled();
    expect(deps.recordSuccess).toHaveBeenCalledWith(
      'ws_test',
      'ws',
      expect.any(Number),
      undefined,
      'deepseek-v4-pro',
      200,
      expect.objectContaining({ finishReason: 'blocked-empty-input' }),
    );
  });

  it('logs warning for unknown message types', () => {
    const ws = mockWs();
    const deps = makeDeps();
    handleWs(ws as unknown as Parameters<typeof handleWs>[0], deps);
    ws._triggerMessage(Buffer.from(JSON.stringify({ type: 'unknown.event' })));
    expect(deps.log).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });

  it('sets up heartbeat and close handler', () => {
    const ws = mockWs();
    const deps = makeDeps();
    handleWs(ws as unknown as Parameters<typeof handleWs>[0], deps);
    expect(ws.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(ws.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(ws.on).toHaveBeenCalledWith('close', expect.any(Function));
  });

  it('tracks compaction trigger in log', async () => {
    const ws = mockWs();
    const deps = makeDeps({
      isSuggestionRequest: vi.fn().mockReturnValue(false),
      compactAndStore: vi.fn().mockResolvedValue({
        compactedId: 'comp123',
        compactedMessages: [],
        compacted: true,
        method: 'llm_summary',
        originalMessageCount: 30,
        compactedMessageCount: 15,
      }),
    });
    handleWs(ws as unknown as Parameters<typeof handleWs>[0], deps);
    ws._triggerMessage(
      Buffer.from(
        JSON.stringify({
          type: 'response.create',
          input: [{ type: 'compaction_trigger' }],
          previous_response_id: 'prev1',
        }),
      ),
    );
    // trigger is extracted, log should mention compaction
    await new Promise((r) => setTimeout(r, 10));
    expect(deps.log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('检测到'),
      }),
    );
  });
});
