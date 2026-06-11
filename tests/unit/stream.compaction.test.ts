import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Mock node:https before importing the module under test.
type FakeReq = {
  write: (b: string) => void;
  end: () => void;
  on: (ev: string, fn: (...a: unknown[]) => void) => FakeReq;
};
type Handler = (res: EventEmitter & { statusCode?: number }) => void;
const handlers: { handle?: Handler; res?: EventEmitter } = {};

vi.mock('node:https', () => {
  return {
    default: {
      request: (_opts: unknown, cb: Handler): FakeReq => {
        const res = Object.assign(new EventEmitter(), { statusCode: 200 });
        setImmediate(() => {
          cb(res);
          handlers.handle = (_r) => _r;
          (res as unknown as { __ready: true }).__ready = true;
          handlers.res = res;
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
  return new Promise<void>((resolve) => {
    const wait = () => {
      const res = handlers.res;
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

describe('streamDeepSeek with extra output items', () => {
  beforeEach(() => {
    delete handlers.res;
  });

  it('includes extra output items in response.completed output array', async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const onEvent = (type: string, payload: Record<string, unknown>) =>
      events.push({ type, payload });

    const compactionItem = {
      type: 'compaction',
      id: 'comp_abc123',
      encrypted_content: 'eyJjb21wYWN0ZWRJZCI6InRlc3QifQ==',
    };

    const promise = streamDeepSeek(
      { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] },
      'resp_test_extra_1',
      onEvent,
      { apiKey: 'k' },
      new ReasoningStore(),
      [compactionItem],
    );

    await emitChunks([
      sse({ choices: [{ index: 0, delta: { content: 'Hello' } }] }),
      sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ]);
    await promise;

    // Verify compaction item added event
    const addedEvents = events.filter((e) => e.type === 'response.output_item.added');
    const compactionAdded = addedEvents.find(
      (e) => (e.payload.item as Record<string, unknown>)?.type === 'compaction',
    );
    expect(compactionAdded).toBeDefined();
    const addedItem = compactionAdded!.payload.item as Record<string, unknown>;
    expect(addedItem.type).toBe('compaction');
    expect(addedItem.id).toBe('comp_abc123');
    expect(typeof compactionAdded!.payload.output_index).toBe('number');

    // Verify compaction item done event
    const doneEvents = events.filter((e) => e.type === 'response.output_item.done');
    const compactionDone = doneEvents.find(
      (e) => (e.payload.item as Record<string, unknown>)?.type === 'compaction',
    );
    expect(compactionDone).toBeDefined();
    const doneItem = compactionDone!.payload.item as Record<string, unknown>;
    expect(doneItem.status).toBe('completed');

    // Verify compaction item is in response.completed output
    const completed = events.find((e) => e.type === 'response.completed');
    expect(completed).toBeDefined();
    const resp = completed!.payload.response as Record<string, unknown>;
    const output = resp.output as Array<Record<string, unknown>>;
    const compactionInOutput = output.find((o) => o.type === 'compaction');
    expect(compactionInOutput).toBeDefined();
    expect(compactionInOutput!.id).toBe('comp_abc123');
  });

  it('does not include extra items when none are passed', async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const onEvent = (type: string, payload: Record<string, unknown>) =>
      events.push({ type, payload });

    const promise = streamDeepSeek(
      { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] },
      'resp_test_extra_2',
      onEvent,
      { apiKey: 'k' },
      new ReasoningStore(),
      // no extraOutputItems
    );

    await emitChunks([
      sse({ choices: [{ index: 0, delta: { content: 'Hello' } }] }),
      sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ]);
    await promise;

    // No compaction items in output
    const completed = events.find((e) => e.type === 'response.completed');
    const resp = completed!.payload.response as Record<string, unknown>;
    const output = resp.output as Array<Record<string, unknown>>;
    const compactionItems = output.filter((o) => o.type === 'compaction');
    expect(compactionItems).toHaveLength(0);

    // No compaction events emitted
    const addedEvents = events.filter((e) => e.type === 'response.output_item.added');
    const compactionAdded = addedEvents.find(
      (e) => (e.payload.item as Record<string, unknown>)?.type === 'compaction',
    );
    expect(compactionAdded).toBeUndefined();
  });

  it('handles multiple extra output items', async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const onEvent = (type: string, payload: Record<string, unknown>) =>
      events.push({ type, payload });

    const item1 = { type: 'compaction', id: 'comp_1', encrypted_content: 'e30=' };
    const item2 = { type: 'compaction', id: 'comp_2', encrypted_content: 'e30=' };

    const promise = streamDeepSeek(
      { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] },
      'resp_test_extra_3',
      onEvent,
      { apiKey: 'k' },
      new ReasoningStore(),
      [item1, item2],
    );

    await emitChunks([
      sse({ choices: [{ index: 0, delta: { content: 'Hello' } }] }),
      sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ]);
    await promise;

    const addedEvents = events.filter((e) => e.type === 'response.output_item.added');
    const compactionItems = addedEvents.filter(
      (e) => (e.payload.item as Record<string, unknown>)?.type === 'compaction',
    );
    expect(compactionItems).toHaveLength(2);

    // Both in response.completed output
    const completed = events.find((e) => e.type === 'response.completed');
    const resp = completed!.payload.response as Record<string, unknown>;
    const output = resp.output as Array<Record<string, unknown>>;
    const compactionInOutput = output.filter((o) => o.type === 'compaction');
    expect(compactionInOutput).toHaveLength(2);
    expect(compactionInOutput[0].id).toBe('comp_1');
    expect(compactionInOutput[1].id).toBe('comp_2');
  });
});
