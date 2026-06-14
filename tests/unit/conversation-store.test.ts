import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { ConversationStore, type StoreEntry } from '../../electron/proxy/conversation-store';

function tmpPath(): string {
  return join(tmpdir(), `cvs-test-${randomBytes(4).toString('hex')}.ndjson`);
}

function sampleMessages(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as string,
    content: `message ${i}`,
  }));
}

async function seedFile(path: string, entries: StoreEntry[]) {
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await writeFile(path, lines, 'utf-8');
}

describe('ConversationStore', () => {
  let store: ConversationStore;
  let filePath: string;

  beforeEach(() => {
    filePath = tmpPath();
    store = new ConversationStore({ filePath, maxEntries: 50 });
  });

  afterEach(async () => {
    vi.useRealTimers();
    try {
      await rm(filePath, { force: true });
      await rm(filePath + '.tmp', { force: true });
    } catch {
      /* cleanup */
    }
  });

  // ── 1. Roundtrip ────────────────────────────────────────────────────────

  it('set + get roundtrip preserves messages', () => {
    const msgs = sampleMessages(5);
    store.set('resp_001', msgs);
    const got = store.get('resp_001');
    expect(got).toEqual(msgs);
    expect(store.has('resp_001')).toBe(true);
    expect(store.size).toBe(1);
  });

  // ── 2. forceFlush writes ndjson ──────────────────────────────────────────

  it('forceFlush writes ndjson file', async () => {
    store.set('resp_a', sampleMessages(2), { compacted: true, compactedFrom: 'old' });
    await store.forceFlush();

    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(filePath, 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(lines[0]) as StoreEntry;
    expect(parsed.id).toBe('resp_a');
    expect(parsed.compacted).toBe(true);
    expect(parsed.compactedFrom).toBe('old');
    expect(parsed.messages).toHaveLength(2);
  });

  // ── 3. load recovers entries ────────────────────────────────────────────

  it('load recovers entries from ndjson', async () => {
    const now = Date.now();
    await seedFile(filePath, [
      {
        id: 'resp_1',
        messages: sampleMessages(3),
        createdAt: now,
        lastAccessAt: now,
        compacted: false,
        compactedFrom: null,
      },
      {
        id: 'resp_2',
        messages: sampleMessages(4),
        createdAt: now,
        lastAccessAt: now,
        compacted: true,
        compactedFrom: 'resp_1',
      },
    ]);

    const s = new ConversationStore({ filePath });
    const count = await s.load();
    expect(count).toBe(2);
    expect(s.get('resp_1')).toHaveLength(3);
    expect(s.get('resp_2')).toHaveLength(4);
    expect(s.has('resp_1')).toBe(true);
  });

  // ── 4. corrupt lines skipped ────────────────────────────────────────────

  it('load skips corrupt ndjson lines', async () => {
    const now = Date.now();
    const good1 = JSON.stringify({
      id: 'good1',
      messages: sampleMessages(1),
      createdAt: now,
      lastAccessAt: now,
      compacted: false,
      compactedFrom: null,
    });
    const good2 = JSON.stringify({
      id: 'good2',
      messages: sampleMessages(2),
      createdAt: now,
      lastAccessAt: now,
      compacted: false,
      compactedFrom: null,
    });
    const bad = '{not json at all';
    await writeFile(filePath, [good1, bad, '', good2].join('\n') + '\n', 'utf-8');

    const s = new ConversationStore({ filePath });
    const count = await s.load();
    expect(count).toBe(2);
    expect(s.has('good1')).toBe(true);
    expect(s.has('good2')).toBe(true);
  });

  // ── 5. prune expired entries ─────────────────────────────────────────────

  it('load prunes entries older than maxAgeMs', async () => {
    const fresh = Date.now();
    const stale = fresh - 25 * 60 * 60 * 1000; // 25 hours ago

    await seedFile(filePath, [
      {
        id: 'fresh',
        messages: sampleMessages(1),
        createdAt: fresh,
        lastAccessAt: fresh,
        compacted: false,
        compactedFrom: null,
      },
      {
        id: 'stale',
        messages: sampleMessages(1),
        createdAt: stale,
        lastAccessAt: stale,
        compacted: false,
        compactedFrom: null,
      },
    ]);

    // v1.9.0: default maxAgeMs is Infinity; pass explicit 24h for this test
    const s = new ConversationStore({ filePath, maxAgeMs: 24 * 60 * 60 * 1000 });
    const count = await s.load();
    expect(count).toBe(1);
    expect(s.has('fresh')).toBe(true);
    expect(s.has('stale')).toBe(false);
  });

  // ── 6. caps at maxEntries ───────────────────────────────────────────────

  it('load caps entries at maxEntries', async () => {
    const now = Date.now();
    const entries: StoreEntry[] = [];
    for (let i = 0; i < 60; i++) {
      entries.push({
        id: `resp_${i.toString().padStart(3, '0')}`,
        messages: sampleMessages(1),
        createdAt: now - i * 1000,
        lastAccessAt: now - i * 1000,
        compacted: false,
        compactedFrom: null,
      });
    }

    await seedFile(filePath, entries);

    const s = new ConversationStore({ filePath, maxEntries: 50 });
    const count = await s.load();
    expect(count).toBe(50);
    // newest entries (higher lastAccessAt) should survive
    expect(s.has('resp_000')).toBe(true); // newest
    expect(s.has('resp_059')).toBe(false); // oldest (lowest lastAccessAt)
  });

  // ── 7. has + delete ─────────────────────────────────────────────────────

  it('has returns false for missing, delete removes entry', () => {
    expect(store.has('nonexistent')).toBe(false);

    store.set('resp_007', sampleMessages(1));
    expect(store.has('resp_007')).toBe(true);

    const deleted = store.delete('resp_007');
    expect(deleted).toBe(true);
    expect(store.has('resp_007')).toBe(false);
    expect(store.delete('already_gone')).toBe(false);
  });

  // ── 8. set updates existing entry ───────────────────────────────────────

  it('set with existing id updates messages', () => {
    const msgs1 = sampleMessages(2);
    const msgs2 = sampleMessages(5);
    store.set('resp_x', msgs1);
    store.set('resp_x', msgs2);
    expect(store.get('resp_x')).toHaveLength(5);
    expect(store.size).toBe(1);
  });
});
