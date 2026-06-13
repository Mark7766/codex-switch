/**
 * conversation-store.ts — conversationStore 持久化层（v1.5.0）
 *
 * 把对话历史以 ndjson 格式写入磁盘，支持：
 * - 启动恢复（load）
 * - debounce 刷盘（markDirty / forceFlush）
 * - 原子写入（.tmp → rename）
 * - 过期清理（> 24h 未访问）和超量清理（保留最近 50 条）
 */

import { writeFile, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage } from './translate';
import log from 'electron-log';

// ── types ───────────────────────────────────────────────────────────────────

export interface StoreEntry {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  lastAccessAt: number;
  compacted: boolean;
  compactedFrom: string | null;
}

// ── defaults ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const DEBOUNCE_MS = 5000;

// ── ConversationStore ────────────────────────────────────────────────────────

export class ConversationStore {
  private readonly map = new Map<string, StoreEntry>();
  private readonly dirty = new Set<string>();
  private readonly filePath: string;
  private readonly maxEntries: number;
  private readonly maxAgeMs: number;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;

  constructor(opts: { filePath?: string; maxEntries?: number; maxAgeMs?: number }) {
    this.filePath = opts.filePath ?? join(tmpdir(), 'conversation-store.ndjson');
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  }

  // ── public accessors ────────────────────────────────────────────────────

  get(id: string): ChatMessage[] | undefined {
    const entry = this.map.get(id);
    if (entry) {
      entry.lastAccessAt = Date.now();
      this.dirty.add(id);
      this.scheduleFlush();
    }
    return entry?.messages;
  }

  set(
    id: string,
    messages: ChatMessage[],
    opts?: { compacted?: boolean; compactedFrom?: string | null },
  ): void {
    const now = Date.now();
    const existing = this.map.get(id);
    this.map.set(id, {
      id,
      messages,
      createdAt: existing?.createdAt ?? now,
      lastAccessAt: now,
      compacted: opts?.compacted ?? false,
      compactedFrom: opts?.compactedFrom ?? null,
    });
    this.dirty.add(id);
    this.scheduleFlush();
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  delete(id: string): boolean {
    this.dirty.add(id); // will be removed during serialization
    const deleted = this.map.delete(id);
    if (deleted) this.scheduleFlush();
    return deleted;
  }

  get size(): number {
    return this.map.size;
  }

  /** Number of entries currently cached in memory (may include unflushed). */
  entryCount(): number {
    return this.map.size;
  }

  // ── persistence ─────────────────────────────────────────────────────────

  /** Debounced flush — safe to call after every mutation. */
  markDirty(): void {
    this.scheduleFlush();
  }

  /** Force immediate flush (call after compact to guarantee persistence). */
  async forceFlush(): Promise<void> {
    this.clearTimer();
    await this.flush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch((err) => {
        log.warn('[conversation-store] 定时刷盘失败：%s', (err as Error).message);
      });
    }, DEBOUNCE_MS);
  }

  private clearTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async flush(): Promise<void> {
    // write all entries (full rewrite for simplicity and correctness)
    const allLines: string[] = [];
    for (const entry of this.map.values()) {
      allLines.push(JSON.stringify(entry));
    }
    if (allLines.length === 0) return;

    const tmp = this.filePath + '.tmp';
    const content = allLines.join('\n') + '\n';
    try {
      await writeFile(tmp, content, 'utf-8');
      await rename(tmp, this.filePath);
      this.dirty.clear();
    } catch (e) {
      // best-effort persistence; don't crash the proxy
    }
  }

  // ── startup ─────────────────────────────────────────────────────────────

  /**
   * Load entries from ndjson, prune expired/overflow.
   * @returns number of recovered entries.
   */
  async load(): Promise<number> {
    const entries: StoreEntry[] = [];
    try {
      const stream = createReadStream(this.filePath, { encoding: 'utf-8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed) as StoreEntry;
          if (entry.id && Array.isArray(entry.messages)) {
            entries.push(entry);
          }
        } catch {
          // skip corrupt lines — don't crash recovery
        }
      }
    } catch {
      // file may not exist yet — empty store is fine
      return 0;
    }

    // prune expired
    const now = Date.now();
    const valid = entries.filter((e) => now - e.lastAccessAt < this.maxAgeMs);

    // cap by count (keep newest by lastAccessAt)
    valid.sort((a, b) => b.lastAccessAt - a.lastAccessAt);
    const capped = valid.slice(0, this.maxEntries);

    for (const entry of capped) {
      this.map.set(entry.id, entry);
    }

    // re-write if pruned
    if (capped.length !== entries.length) {
      this.markDirty();
      this.forceFlush().catch((err) => {
        log.warn('[conversation-store] 强制刷盘失败：%s', (err as Error).message);
      });
    }

    return capped.length;
  }

  /**
   * Scheduled cleanup — delete entries older than maxAgeMs.
   * @returns number of entries removed.
   */
  async prune(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const [id, entry] of this.map) {
      if (now - entry.lastAccessAt >= this.maxAgeMs) {
        this.map.delete(id);
        this.dirty.add(id);
        removed++;
      }
    }

    // cap by count
    if (this.map.size > this.maxEntries) {
      const sorted = [...this.map.values()].sort((a, b) => b.lastAccessAt - a.lastAccessAt);
      const toRemove = sorted.slice(this.maxEntries);
      for (const entry of toRemove) {
        this.map.delete(entry.id);
        this.dirty.add(entry.id);
        removed++;
      }
    }

    if (removed > 0) {
      await this.forceFlush();
    }
    return removed;
  }
}
