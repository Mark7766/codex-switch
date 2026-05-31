import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock node:https before importing the module under test.
type FakeReq = {
  write: (b: string) => void;
  end: () => void;
  on: (ev: string, fn: (...a: unknown[]) => void) => FakeReq;
};
type Handler = (res: EventEmitter & { statusCode?: number }) => void;
const handlers: { handle?: Handler } = {};

vi.mock('node:https', () => {
  return {
    default: {
      request: (_opts: unknown, cb: Handler): FakeReq => {
        const res = Object.assign(new EventEmitter(), { statusCode: 200 });
        // 让调用方先注册完所有事件再触发响应。
        setImmediate(() => {
          cb(res);
          handlers.handle = (r) => r;
          // 由各测试通过 emitChunks 控制响应内容。
          (res as unknown as { __ready: true }).__ready = true;
          (handlers as { res?: typeof res }).res = res;
        });
        return {
          write() {},
          end() {},
          on() {
            return this as unknown as FakeReq;
          },
        };
      },
      Agent: class {},
    },
  };
});

import { streamDeepSeek } from '../../electron/proxy/stream';
import { ReasoningStore } from '../../electron/proxy/reasoning';

function emitChunks(chunks: string[]) {
  // 等到 https.request 回调把 res 暴露出来。
  return new Promise<void>((resolve) => {
    const wait = () => {
      const res = (handlers as { res?: EventEmitter }).res;
      if (res) {
        for (const c of chunks) res.emit('data', Buffer.from(c, 'utf-8'));
        res.emit('end');
        resolve();
      } else {
        setImmediate(wait);
      }
    };
    wait();
  });
}

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

describe('streamDeepSeek response.completed end_turn', () => {
  beforeEach(() => {
    delete (handlers as { res?: unknown }).res;
  });

  it('sets end_turn=true when response has only text', async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const onEvent = (type: string, payload: Record<string, unknown>) =>
      events.push({ type, payload });

    const promise = streamDeepSeek(
      { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] },
      'resp_test_1',
      onEvent,
      { apiKey: 'k' },
      new ReasoningStore(),
    );

    await emitChunks([
      sse({ choices: [{ index: 0, delta: { content: 'Hello' } }] }),
      sse({ choices: [{ index: 0, delta: { content: ' world' }, finish_reason: 'stop' }] }),
      sse({ usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }),
      'data: [DONE]\n\n',
    ]);
    await promise;

    const completed = events.find((e) => e.type === 'response.completed');
    expect(completed).toBeDefined();
    const resp = completed!.payload.response as Record<string, unknown>;
    expect(resp.end_turn).toBe(true);
    expect(resp.status).toBe('completed');
    expect(resp.usage).toMatchObject({ input_tokens: 3, output_tokens: 2, total_tokens: 5 });
  });

  it('sets end_turn=false when response contains a tool_call', async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const onEvent = (type: string, payload: Record<string, unknown>) =>
      events.push({ type, payload });

    const promise = streamDeepSeek(
      { model: 'deepseek-chat', messages: [{ role: 'user', content: 'do x' }] },
      'resp_test_2',
      onEvent,
      { apiKey: 'k' },
      new ReasoningStore(),
    );

    await emitChunks([
      sse({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_a',
                  function: { name: 'do_thing', arguments: '{"a":1}' },
                },
              ],
            },
          },
        ],
      }),
      sse({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]\n\n',
    ]);
    await promise;

    const completed = events.find((e) => e.type === 'response.completed');
    expect(completed).toBeDefined();
    const resp = completed!.payload.response as Record<string, unknown>;
    expect(resp.end_turn).toBe(false);
  });
});
