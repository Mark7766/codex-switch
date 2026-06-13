/**
 * HTTP handler tests — non-streaming path and error handling.
 * Mocks the DeepSeek API calls to avoid real network I/O.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleResponses } from '../../electron/proxy/http-handler';
import type { HttpHandlerDeps } from '../../electron/proxy/http-handler';

// Mock stream.ts
vi.mock('../../electron/proxy/stream', () => ({
  callDeepSeekSync: vi.fn(),
  streamDeepSeek: vi.fn(),
}));

import { callDeepSeekSync } from '../../electron/proxy/stream';

function mockReq(body: unknown): IncomingMessage {
  const bodyStr = JSON.stringify(body);
  return {
    method: 'POST',
    url: '/v1/responses',
    headers: {},
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'data') cb(Buffer.from(bodyStr));
      if (event === 'end') cb();
    }),
  } as unknown as IncomingMessage;
}

function mockRes(): ServerResponse & { body: string; status: number } {
  const res = {
    status: 200,
    body: '',
    writeHead: vi.fn(function (this: typeof res, s: number) {
      this.status = s;
      return this;
    }),
    end: vi.fn(function (this: typeof res, data?: string) {
      if (data) this.body = data;
    }),
  };
  return res as unknown as ServerResponse & { body: string; status: number };
}

function makeDeps(overrides?: Partial<HttpHandlerDeps>): HttpHandlerDeps {
  return {
    apiKey: 'sk-test-key',
    modelMapping: {},
    defaultModel: 'deepseek-v4-flash',
    agent: {} as never,
    conversationStore: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      markDirty: vi.fn(),
    } as unknown as HttpHandlerDeps['conversationStore'],
    reasoning: { asMap: vi.fn().mockReturnValue({}) } as unknown as HttpHandlerDeps['reasoning'],
    stats: { total: 0, pendingDelta: 0, pendingInputTokensDelta: 0, pendingOutputTokensDelta: 0 },
    log: vi.fn(),
    recordSuccess: vi.fn(),
    recordError: vi.fn(),
    resolveAndWarn: vi.fn((m) => m ?? 'deepseek-v4-pro'),
    emit: vi.fn(),
    newReqId: () => 'req_test',
    ...overrides,
  };
}

describe('handleResponses non-streaming', () => {
  it('handles JSON parse error', async () => {
    const res = mockRes();
    const req = {
      method: 'POST',
      url: '/v1/responses',
      headers: {},
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'data') cb(Buffer.from('not json'));
        if (event === 'end') setImmediate(() => cb());
      }),
    } as unknown as IncomingMessage;
    const deps = makeDeps();
    handleResponses(req, res as unknown as ServerResponse, deps);
    // Wait for async end handler
    await new Promise((r) => setTimeout(r, 10));
    expect(res.status).toBe(400);
    expect(deps.recordError).toHaveBeenCalled();
  });

  it('resolves model and calls DeepSeek for sync request', async () => {
    const mockCallDeepSeek = callDeepSeekSync as ReturnType<typeof vi.fn>;
    mockCallDeepSeek.mockResolvedValueOnce({
      status: 200,
      body: {
        choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    });

    const req = mockReq({
      model: 'gpt-5-codex',
      stream: false,
      input: [{ role: 'user', content: 'hi' }],
    });
    const res = mockRes();
    const deps = makeDeps();

    handleResponses(req, res as unknown as ServerResponse, deps);
    // Flush microtask queue where .then() callbacks run
    await new Promise((r) => setTimeout(r, 0));

    // verify the handler ran successfully
    expect(mockCallDeepSeek).toHaveBeenCalled();
  });
});
