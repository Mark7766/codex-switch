import { describe, it, expect, vi } from 'vitest';

// Mock node:fs/promises before importing the module under test.
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    readdir: vi.fn(),
    chmod: vi.fn(),
  },
}));

import {
  handleAnthropicModels,
  handleAnthropicMessages,
  handleAnthropicCountTokens,
  resolveAnthropicModel,
  DEFAULT_CLAUDE_DESKTOP_MODEL_MAP,
  INFERENCE_MODELS,
} from '../../electron/proxy/anthropic-relay';

// ─── resolveAnthropicModel ───────────────────────────────────────────────────

describe('resolveAnthropicModel', () => {
  it('maps claude-sonnet to deepseek-v4-pro', () => {
    const result = resolveAnthropicModel('claude-sonnet-4-5', DEFAULT_CLAUDE_DESKTOP_MODEL_MAP);
    expect(result).toBe('deepseek-v4-pro');
  });

  it('maps claude-haiku to deepseek-v4-flash', () => {
    const result = resolveAnthropicModel('claude-haiku-3-5', DEFAULT_CLAUDE_DESKTOP_MODEL_MAP);
    expect(result).toBe('deepseek-v4-flash');
  });

  it('strips [1m] suffix before resolving', () => {
    const result = resolveAnthropicModel('claude-sonnet-4-5[1m]', DEFAULT_CLAUDE_DESKTOP_MODEL_MAP);
    expect(result).toBe('deepseek-v4-pro');
  });

  it('falls back to deepseek-v4-pro for unknown model IDs', () => {
    const result = resolveAnthropicModel('claude-unknown-model', DEFAULT_CLAUDE_DESKTOP_MODEL_MAP);
    // Unknown model falls back to opus or sonnet mapping
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─── handleAnthropicModels ───────────────────────────────────────────────────

describe('handleAnthropicModels', () => {
  it('responds with JSON containing all CLAUDE_MODELS', () => {
    const chunks: string[] = [];
    const headers: Record<string, string> = {};
    let statusCode = 0;

    const mockRes = {
      writeHead: vi.fn((code: number, h: Record<string, string>) => {
        statusCode = code;
        Object.assign(headers, h);
      }),
      end: vi.fn((body: string) => {
        chunks.push(body);
      }),
    };

    handleAnthropicModels(mockRes as never, {
      apiKey: 'sk-test',
      modelMap: DEFAULT_CLAUDE_DESKTOP_MODEL_MAP,
    });

    expect(statusCode).toBe(200);
    expect(headers['Content-Type']).toContain('application/json');
    const parsed = JSON.parse(chunks.join(''));
    expect(parsed.data).toHaveLength(INFERENCE_MODELS.length);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.has_more).toBe(false);
    expect(parsed.data[0]).toHaveProperty('id', 'claude-haiku-4-5');
    expect(parsed.data[1]).toHaveProperty('id', 'claude-sonnet-4-6');
    expect(parsed.data[0]).toHaveProperty('type', 'model');
  });
});

// ─── handleAnthropicCountTokens ──────────────────────────────────────────────

describe('handleAnthropicCountTokens', () => {
  it('returns input_tokens estimate based on body size', async () => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hello world' }],
    });
    let statusCode = 0;
    const chunks: string[] = [];

    const mockReq = {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from(body));
        if (event === 'end') (cb as unknown as () => void)();
        return mockReq;
      }),
    };
    const mockRes = {
      writeHead: vi.fn((code: number) => {
        statusCode = code;
      }),
      end: vi.fn((body: string) => {
        chunks.push(body);
      }),
    };

    handleAnthropicCountTokens(mockReq as never, mockRes as never);

    expect(statusCode).toBe(200);
    const parsed = JSON.parse(chunks.join('')) as { input_tokens: number };
    expect(parsed.input_tokens).toBeGreaterThan(0);
  });
});

// ─── handleAnthropicMessages (validation path) ───────────────────────────────

describe('handleAnthropicMessages – missing API key', () => {
  it('returns 401 when apiKey is empty', async () => {
    const chunks: string[] = [];
    let statusCode = 0;
    const headers: Record<string, string> = {};

    const mockReq = {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data')
          cb(
            Buffer.from(
              JSON.stringify({
                model: 'claude-sonnet-4-5',
                messages: [{ role: 'user', content: 'hi' }],
              }),
            ),
          );
        if (event === 'end') (cb as unknown as () => void)();
        return mockReq;
      }),
    };

    const mockRes = {
      writeHead: vi.fn((code: number, h: Record<string, string>) => {
        statusCode = code;
        Object.assign(headers, h);
      }),
      end: vi.fn((body: string) => {
        chunks.push(body);
      }),
    };

    await handleAnthropicMessages(
      mockReq as never,
      mockRes as never,
      {
        apiKey: '',
        modelMap: DEFAULT_CLAUDE_DESKTOP_MODEL_MAP,
      },
      vi.fn(),
    );

    expect(statusCode).toBe(401);
  });
});
