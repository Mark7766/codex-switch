/**
 * anthropic-relay.test.ts — Anthropic Messages → Chat Completions tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

const mockWrite = vi.fn();
const mockEnd = vi.fn();
let mockUpstreamHandler: ((res: unknown) => void) | null = null;
let mockErrorHandler: ((e: Error) => void) | null = null;

vi.mock('node:https', () => ({
  default: {
    request: vi.fn((_opts: unknown, cb: (res: unknown) => void) => {
      mockUpstreamHandler = cb;
      return {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'error') mockErrorHandler = handler as (e: Error) => void;
        }),
        write: mockWrite,
        end: mockEnd,
      };
    }),
    Agent: vi.fn(),
  },
}));

import { handleAnthropicMessages } from '../../electron/proxy/anthropic-relay';

function mockReq(body: unknown): IncomingMessage {
  const bodyStr = JSON.stringify(body);
  return {
    method: 'POST',
    url: '/anthropic/v1/messages',
    headers: { 'content-type': 'application/json' },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'data') cb(Buffer.from(bodyStr));
      if (event === 'end') setImmediate(() => cb());
    }),
  } as unknown as IncomingMessage;
}

function mockReqRaw(raw: string): IncomingMessage {
  return {
    method: 'POST',
    url: '/anthropic/v1/messages',
    headers: {},
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'data') cb(Buffer.from(raw));
      if (event === 'end') setImmediate(() => cb());
    }),
  } as unknown as IncomingMessage;
}

function mockRes(): ServerResponse & { status: number; body: string } {
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
  return res as unknown as ServerResponse & { status: number; body: string };
}

function respondUpstream(statusCode: number, body: string): void {
  if (!mockUpstreamHandler) throw new Error('upstream not called');
  mockUpstreamHandler({
    statusCode,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'data') cb(Buffer.from(body));
      if (event === 'end') setImmediate(() => cb());
    }),
  });
}

function failUpstream(msg: string): void {
  if (!mockErrorHandler) throw new Error('upstream error handler not set');
  mockErrorHandler(new Error(msg));
}

describe('handleAnthropicMessages', () => {
  let deps: {
    apiKey: string;
    upstreamBase: string;
    defaultModel: string;
    agent: unknown;
    log: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpstreamHandler = null;
    mockErrorHandler = null;
    deps = {
      apiKey: 'sk-test-key',
      upstreamBase: 'apihub.agnes-ai.com',
      defaultModel: 'agnes-2.0-flash',
      agent: {},
      log: vi.fn(),
    };
  });

  describe('basic translation', () => {
    it('translates a simple user message', async () => {
      const req = mockReq({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      });
      const res = mockRes();

      handleAnthropicMessages(req, res as unknown as ServerResponse, deps);
      await new Promise((r) => setTimeout(r, 5));
      respondUpstream(
        200,
        JSON.stringify({
          choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        }),
      );
      await new Promise((r) => setTimeout(r, 5));

      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.content[0].text).toBe('Hello!');
      expect(body.role).toBe('assistant');
      expect(body.stop_reason).toBe('end_turn');
    });

    it('uses defaultModel for actual API call', async () => {
      const req = mockReq({
        model: 'claude-opus-4-7',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      });
      const res = mockRes();

      handleAnthropicMessages(req, res as unknown as ServerResponse, deps);
      await new Promise((r) => setTimeout(r, 5));
      respondUpstream(
        200,
        JSON.stringify({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
      await new Promise((r) => setTimeout(r, 5));

      const sentData = JSON.parse(mockWrite.mock.calls[0]?.[0] ?? '{}');
      expect(sentData.model).toBe('agnes-2.0-flash');
    });
  });

  describe('system prompt', () => {
    it('prepends system message', async () => {
      const req = mockReq({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        system: 'You are helpful.',
        max_tokens: 100,
      });
      const res = mockRes();

      handleAnthropicMessages(req, res as unknown as ServerResponse, deps);
      await new Promise((r) => setTimeout(r, 5));
      respondUpstream(
        200,
        JSON.stringify({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
      await new Promise((r) => setTimeout(r, 5));

      const sentData = JSON.parse(mockWrite.mock.calls[0]?.[0] ?? '{}');
      expect(sentData.messages[0].role).toBe('system');
      expect(sentData.messages[0].content).toBe('You are helpful.');
    });
  });

  describe('content extraction', () => {
    it('extracts text from content blocks', async () => {
      const req = mockReq({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hello from block' }] }],
        max_tokens: 100,
      });
      const res = mockRes();

      handleAnthropicMessages(req, res as unknown as ServerResponse, deps);
      await new Promise((r) => setTimeout(r, 5));
      respondUpstream(
        200,
        JSON.stringify({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
      await new Promise((r) => setTimeout(r, 5));

      const sentData = JSON.parse(mockWrite.mock.calls[0]?.[0] ?? '{}');
      expect(sentData.messages[0].content).toBe('hello from block');
    });
  });

  describe('default max_tokens', () => {
    it('defaults to 4096 when not specified', async () => {
      const req = mockReq({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
      });
      const res = mockRes();

      handleAnthropicMessages(req, res as unknown as ServerResponse, deps);
      await new Promise((r) => setTimeout(r, 5));
      respondUpstream(
        200,
        JSON.stringify({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
      await new Promise((r) => setTimeout(r, 5));

      const sentData = JSON.parse(mockWrite.mock.calls[0]?.[0] ?? '{}');
      expect(sentData.max_tokens).toBe(4096);
    });
  });

  describe('error handling', () => {
    it('returns 400 for invalid JSON', async () => {
      const req = mockReqRaw('not json');
      const res = mockRes();

      handleAnthropicMessages(req, res as unknown as ServerResponse, deps);
      await new Promise((r) => setTimeout(r, 20));

      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).type).toBe('error');
    });

    it('returns upstream status on non-200', async () => {
      const req = mockReq({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
      });
      const res = mockRes();

      handleAnthropicMessages(req, res as unknown as ServerResponse, deps);
      await new Promise((r) => setTimeout(r, 5));
      respondUpstream(503, '{"error":"unavailable"}');
      await new Promise((r) => setTimeout(r, 5));

      expect(res.status).toBe(503);
      expect(deps.log).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'claude',
          phase: 'error',
          statusCode: 503,
        }),
      );
    });

    it('returns 502 on network error', async () => {
      const req = mockReq({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
      });
      const res = mockRes();

      handleAnthropicMessages(req, res as unknown as ServerResponse, deps);
      await new Promise((r) => setTimeout(r, 5));
      failUpstream('ECONNREFUSED');
      await new Promise((r) => setTimeout(r, 5));

      expect(res.status).toBe(502);
      expect(JSON.parse(res.body).type).toBe('error');
    });

    it('returns 502 on unparseable upstream response', async () => {
      const req = mockReq({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
      });
      const res = mockRes();

      handleAnthropicMessages(req, res as unknown as ServerResponse, deps);
      await new Promise((r) => setTimeout(r, 5));
      respondUpstream(200, 'not json');
      await new Promise((r) => setTimeout(r, 5));

      expect(res.status).toBe(502);
    });
  });

  describe('logging', () => {
    it('logs start with claude source', async () => {
      const req = mockReq({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'hi' }],
      });
      const res = mockRes();

      handleAnthropicMessages(req, res as unknown as ServerResponse, deps);
      await new Promise((r) => setTimeout(r, 5));
      respondUpstream(
        200,
        JSON.stringify({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
      await new Promise((r) => setTimeout(r, 5));

      expect(deps.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          source: 'claude',
          phase: 'start',
          message: expect.stringContaining('claude-haiku-4-5→agnes-2.0-flash'),
        }),
      );
    });

    it('includes duration and tokens in success log', async () => {
      const req = mockReq({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
      });
      const res = mockRes();

      handleAnthropicMessages(req, res as unknown as ServerResponse, deps);
      await new Promise((r) => setTimeout(r, 5));
      respondUpstream(
        200,
        JSON.stringify({
          choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      );
      await new Promise((r) => setTimeout(r, 5));

      expect(deps.log).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'success',
          message: expect.stringContaining('↑10↓5'),
        }),
      );
    });
  });

  describe('GLM provider', () => {
    it('uses defaultModel for GLM upstream', async () => {
      const glmDeps = { ...deps, upstreamBase: 'open.bigmodel.cn', defaultModel: 'glm-4.7' };
      const req = mockReq({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 100,
      });
      const res = mockRes();

      handleAnthropicMessages(req, res as unknown as ServerResponse, glmDeps);
      await new Promise((r) => setTimeout(r, 5));
      respondUpstream(
        200,
        JSON.stringify({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
      await new Promise((r) => setTimeout(r, 5));

      const sentData = JSON.parse(mockWrite.mock.calls[0]?.[0] ?? '{}');
      expect(sentData.model).toBe('glm-4.7');
    });
  });
});
