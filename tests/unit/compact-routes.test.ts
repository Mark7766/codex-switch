/**
 * Compact routes tests — compactAndStore and HTTP compact handler.
 * Mocks compactHistory to avoid real API calls.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { compactAndStore, handleCompactHttp } from '../../electron/proxy/compact-routes';
import type { CompactRouteDeps } from '../../electron/proxy/compact-routes';
import type { ConversationStore } from '../../electron/proxy/conversation-store';

vi.mock('../../electron/proxy/compact', () => ({
  compactHistory: vi.fn().mockResolvedValue({
    compacted: true,
    method: 'clone',
    compactedId: '',
    compactedMessages: [{ role: 'system', content: 'summary' }],
    originalMessageCount: 5,
    compactedMessageCount: 5,
  }),
}));

function makeDeps(): CompactRouteDeps {
  const store = new Map() as unknown as ConversationStore;
  (store as Record<string, unknown>).get = vi.fn().mockReturnValue(null);
  (store as Record<string, unknown>).set = vi.fn();
  (store as Record<string, unknown>).forceFlush = vi.fn().mockResolvedValue(undefined);
  return {
    apiKey: 'sk-test',
    defaultModel: 'deepseek-v4-flash',
    conversationStore: store,
    compactCache: new Map(),
    activeCompactions: new Set(),
    log: vi.fn(),
  };
}

describe('compactAndStore', () => {
  it('generates compactId and stores result', async () => {
    const deps = makeDeps();
    const result = await compactAndStore('prev123', deps);
    expect(result.compactedId).toMatch(/^resp_compact_/);
    expect(result.compacted).toBe(true);
    expect(result.method).toBe('clone');
    expect(deps.conversationStore.set).toHaveBeenCalled();
  });

  it('returns cached result for duplicate request', async () => {
    const deps = makeDeps();
    const first = await compactAndStore('prev123', deps);
    const second = await compactAndStore('prev123', deps);
    expect(second.compactedId).toBe(first.compactedId);
  });

  it('works with empty prevRespId', async () => {
    const deps = makeDeps();
    const result = await compactAndStore(undefined, deps);
    expect(result.compactedId).toMatch(/^resp_compact_/);
  });
});

describe('handleCompactHttp', () => {
  it('rejects oversized body', () => {
    const res = {
      writeHead: vi.fn().mockReturnThis(),
      end: vi.fn(),
    } as unknown as ServerResponse;
    const req = {
      headers: { 'content-length': '2000000' },
      setTimeout: vi.fn(),
      on: vi.fn(),
    } as unknown as IncomingMessage;
    handleCompactHttp(req, res, makeDeps());
    expect(res.writeHead).toHaveBeenCalledWith(413, expect.any(Object));
  });
});

import { processWsCompact } from '../../electron/proxy/compact-routes';

describe('processWsCompact', () => {
  it('skips duplicate compaction for same prevRespId', async () => {
    const deps = makeDeps();
    const ws = { readyState: 1, send: vi.fn() } as unknown as Parameters<
      typeof processWsCompact
    >[0];
    processWsCompact(ws, 'prev123', deps);
    // Second call with same ID should be skipped (already in activeCompactions)
    processWsCompact(ws, 'prev123', deps);
    // Wait for async compactAndStore to complete
    await new Promise((r) => setTimeout(r, 10));
    expect(deps.conversationStore.forceFlush).toHaveBeenCalledTimes(1);
  });
});
