/**
 * Stats module tests — pure functions, no network dependencies.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  recordSuccess,
  recordError,
  getRecentStats,
  consumeLifetimeDelta,
  proxyLog,
} from '../../electron/proxy/stats';
import type { RequestStats } from '../../electron/proxy/types';

function makeStats(): RequestStats {
  return {
    total: 0,
    success: 0,
    error: 0,
    totalDurationMs: 0,
    lastError: null,
    lastErrorTs: 0,
    recent: [],
    pendingDelta: 0,
    pendingInputTokensDelta: 0,
    pendingOutputTokensDelta: 0,
  };
}

function noopLog(): void {
  /* noop */
}

describe('recordSuccess', () => {
  it('increments success counter', () => {
    const stats = makeStats();
    recordSuccess(
      stats,
      {},
      noopLog,
      'req1',
      'http',
      Date.now() - 100,
      undefined,
      'deepseek-chat',
      200,
    );
    expect(stats.success).toBe(1);
    expect(stats.totalDurationMs).toBeGreaterThan(0);
    expect(stats.recent).toHaveLength(1);
    expect(stats.recent[0]?.ok).toBe(true);
  });

  it('does not increment for blocked requests', () => {
    const stats = makeStats();
    recordSuccess(
      stats,
      {},
      noopLog,
      'req1',
      'ws',
      Date.now() - 100,
      undefined,
      'deepseek-chat',
      200,
      {
        finishReason: 'blocked-suggestion',
      },
    );
    expect(stats.success).toBe(0);
  });

  it('accumulates token deltas from usage', () => {
    const stats = makeStats();
    recordSuccess(
      stats,
      {},
      noopLog,
      'req1',
      'http',
      Date.now() - 100,
      undefined,
      'deepseek-chat',
      200,
      {
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      },
    );
    expect(stats.pendingInputTokensDelta).toBe(100);
    expect(stats.pendingOutputTokensDelta).toBe(50);
  });

  it('does not accumulate tokens for blocked requests', () => {
    const stats = makeStats();
    recordSuccess(
      stats,
      {},
      noopLog,
      'req1',
      'ws',
      Date.now() - 100,
      undefined,
      'deepseek-chat',
      200,
      {
        finishReason: 'blocked-empty-input',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      },
    );
    expect(stats.pendingInputTokensDelta).toBe(0);
  });

  it('calls onModelCall callback when not blocked', () => {
    const onModelCall = vi.fn();
    const opts = { onModelCall };
    const stats = makeStats();
    recordSuccess(
      stats,
      opts,
      noopLog,
      'req1',
      'http',
      Date.now() - 100,
      undefined,
      'deepseek-chat',
      200,
    );
    expect(onModelCall).toHaveBeenCalledTimes(1);
    expect(onModelCall).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'deepseek-chat', success: true }),
    );
  });
});

describe('recordError', () => {
  it('increments error counter', () => {
    const stats = makeStats();
    recordError(
      stats,
      {},
      noopLog,
      'req1',
      'http',
      Date.now() - 100,
      undefined,
      undefined,
      'timeout',
      'none',
      undefined,
    );
    expect(stats.error).toBe(1);
    expect(stats.lastError).toBe('timeout');
    expect(stats.recent[0]?.ok).toBe(false);
  });

  it('calls onModelCall with success=false', () => {
    const onModelCall = vi.fn();
    const stats = makeStats();
    recordError(
      stats,
      { onModelCall },
      noopLog,
      'req1',
      'http',
      Date.now() - 100,
      'gpt-5-codex',
      'deepseek-chat',
      'auth',
      'auth',
      401,
    );
    expect(onModelCall).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error_reason: 'auth' }),
    );
  });
});

describe('getRecentStats', () => {
  it('returns 100% success rate with no errors', () => {
    const stats = makeStats();
    stats.recent = [
      { ts: Date.now() - 1000, ok: true },
      { ts: Date.now() - 2000, ok: true },
    ];
    stats.total = 2;
    stats.totalDurationMs = 200;
    const result = getRecentStats(stats);
    expect(result.successRate).toBe(1);
    expect(result.avgDurationMs).toBe(100);
  });

  it('filters out old entries', () => {
    const stats = makeStats();
    stats.recent = [
      { ts: Date.now() - 1000, ok: true },
      { ts: Date.now() - 10 * 60 * 1000, ok: true }, // 10 min old, should be filtered
    ];
    stats.total = 1;
    stats.totalDurationMs = 100;
    const result = getRecentStats(stats, 5 * 60 * 1000);
    expect(result.total).toBe(1);
  });
});

describe('consumeLifetimeDelta', () => {
  it('resets deltas after consume', () => {
    const stats = makeStats();
    stats.pendingDelta = 5;
    stats.pendingInputTokensDelta = 1000;
    stats.pendingOutputTokensDelta = 500;
    const result = consumeLifetimeDelta(stats, 30000);
    expect(result.requestsDelta).toBe(5);
    expect(result.inputTokensDelta).toBe(1000);
    expect(result.uptimeMs).toBe(30000);
    // Deltas should be reset
    expect(stats.pendingDelta).toBe(0);
    expect(stats.pendingInputTokensDelta).toBe(0);
  });
});

describe('proxyLog', () => {
  it('emits log entry with redacted message', () => {
    const emitted: unknown[] = [];
    const emitLog = (e: unknown) => emitted.push(e);
    proxyLog(emitLog, { level: 'info', source: 'proxy', message: 'test sk-1234567890' });
    expect(emitted).toHaveLength(1);
    expect((emitted[0] as Record<string, unknown>).message).not.toContain('sk-1234567890');
  });
});
