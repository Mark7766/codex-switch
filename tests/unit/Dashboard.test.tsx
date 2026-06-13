/**
 * Dashboard page smoke test — verifies core UI renders.
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '../../src/lib/store';
import { Dashboard } from '../../src/pages/Dashboard';

beforeEach(() => {
  useAppStore.setState({
    proxyStatus: 'running',
    proxyPort: 11435,
    lifetime: {
      requestCount: 42,
      uptimeSec: 3600,
      firstStartAt: '2026-06-13',
      inputTokens: 5000,
      outputTokens: 2000,
    },
    logs: [],
    toasts: [],
    configApplied: true,
    justApplied: false,
    claudeDetect: {
      codexDesktop: { installed: true, configApplied: true },
      codexCli: { installed: true, configApplied: true },
      claudeCli: { installed: true, configApplied: true },
      claudeDesktop: { installed: true, configApplied: true },
    },
  });
  (window as unknown as { codexSwitch: Record<string, unknown> }).codexSwitch = {
    proxyInfo: vi.fn().mockResolvedValue({
      status: 'running',
      port: 11435,
      uptimeMs: 3600000,
      requestCount: 42,
      logs: [],
      recentStats: { total: 42, successRate: 1, avgDurationMs: 2500, lastError: null },
      lifetime: {
        requestCount: 42,
        uptimeSec: 3600,
        firstStartAt: '2026-06-13',
        inputTokens: 5000,
        outputTokens: 2000,
      },
      lastError: null,
    }),
    onProxyStatus: vi.fn().mockReturnValue(() => {}),
    onProxyLog: vi.fn().mockReturnValue(() => {}),
    onUpdateEvent: vi.fn().mockReturnValue(() => {}),
    claudeDetect: vi.fn().mockResolvedValue({}),
    claudeApplyAll: vi.fn().mockResolvedValue({}),
    getVersion: vi.fn().mockResolvedValue('1.8.0'),
    loadPersistedLogs: vi.fn().mockResolvedValue([]),
    getLogsStats: vi.fn().mockResolvedValue({ files: 1, totalBytes: 1024 }),
  };
});

describe('Dashboard page', () => {
  it('renders proxy running status', () => {
    render(<Dashboard />);
    expect(screen.getByText(/运行中/)).toBeDefined();
  });

  it('renders lifetime request count', () => {
    render(<Dashboard />);
    expect(screen.getByText(/42/)).toBeDefined();
  });
});
