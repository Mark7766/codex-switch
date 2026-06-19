/**
 * Settings page smoke tests (C2).
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Settings } from '../../src/pages/Settings';

// Mock the IPC bridge
const mockApi = {
  getPreferences: vi.fn().mockResolvedValue({
    proxyPort: 11435,
    defaultModel: 'deepseek-v4-flash',
    autoStartProxy: true,
    hasCompletedSetup: true,
    modelMappingVersion: 3,
    maxBackupsPerFile: 5,
    lastSeenVersion: '1.7.0',
    autoCheckUpdate: true,
    updateMirror: 'server',
    customMirrorUrl: '',
    hasSeenOnboarding: true,
    lifetimeRequestCount: 0,
    lifetimeUptimeSec: 0,
    lifetimeFirstStartAt: '2026-06-13',
    lastErrorMessage: '',
    lastErrorAt: 0,
    blockBackgroundSuggestions: true,
    provider: 'deepseek',
    activeModelMapping: { 'codex-switch': { model: 'deepseek-v4-flash', provider: 'deepseek' } },
    telemetryEnabled: true,
    serverUrl: '',
  }),
  getApiKey: vi.fn().mockResolvedValue('sk-••••••••'),
  setApiKey: vi.fn().mockResolvedValue(true),
  clearApiKey: vi.fn().mockResolvedValue(true),
  getAgnesKey: vi.fn().mockResolvedValue(''),
  setAgnesKey: vi.fn().mockResolvedValue(true),
  clearAgnesKey: vi.fn().mockResolvedValue(true),
  codexBackups: vi.fn().mockResolvedValue({ config: [], auth: [] }),
  getVersion: vi.fn().mockResolvedValue('1.7.0'),
  applyPreferences: vi.fn().mockResolvedValue({
    prefs: {},
    codexWritten: true,
    restarted: false,
    portChanged: false,
  }),
  updateSetMirror: vi.fn().mockResolvedValue(undefined),
  updateCheck: vi.fn().mockResolvedValue(undefined),
  onUpdateEvent: vi.fn().mockReturnValue(() => {}),
  codexBackupDelete: vi.fn().mockResolvedValue({ deleted: true }),
  codexBackupClean: vi.fn().mockResolvedValue({ deleted: [] }),
  codexRestore: vi.fn().mockResolvedValue('/restored/path'),
  telemetrySetEnabled: vi.fn().mockResolvedValue(undefined),
  claudeDetect: vi.fn().mockResolvedValue({
    codexDesktop: { installed: true, configApplied: true },
    codexCli: { installed: true, configApplied: true },
    claudeCli: { installed: true, configApplied: true },
    claudeDesktop: { installed: true, configApplied: true },
  }),
  claudeApplyAll: vi.fn().mockResolvedValue({}),
  claudeUninstallAll: vi.fn().mockResolvedValue({}),
  claudeUninstallDesktop: vi.fn().mockResolvedValue({}),
  claudeDesktopBackups: vi.fn().mockResolvedValue([]),
  conversationCacheStats: vi.fn().mockResolvedValue({ count: 3, oldestTimestamp: Date.now() }),
  conversationCacheClear: vi.fn().mockResolvedValue(undefined),
  conversationCacheSetLimit: vi.fn().mockResolvedValue(undefined),
  codexHasOriginalBackup: vi.fn().mockResolvedValue(false),
};

beforeEach(() => {
  (window as unknown as { codexSwitch: typeof mockApi }).codexSwitch = mockApi;
  vi.clearAllMocks();
});

describe('Settings page', () => {
  it('renders the page title', async () => {
    render(<Settings />);
    expect(await screen.findByText('设置')).toBeDefined();
  });

  it('renders the provider settings section', async () => {
    render(<Settings />);
    expect(await screen.findByText('🔑 供应商设置')).toBeDefined();
  });

  it('renders the Codex access section', async () => {
    render(<Settings />);
    expect(await screen.findByText(/Codex 接入/)).toBeDefined();
    expect(await screen.findByText('本地端口')).toBeDefined();
  });

  it('renders the update section', async () => {
    render(<Settings />);
    expect(await screen.findByText('自动更新')).toBeDefined();
  });

  it('renders the about section', async () => {
    render(<Settings />);
    expect(await screen.findByText('关于')).toBeDefined();
  });

  it('renders telemetry opt-in checkbox', async () => {
    render(<Settings />);
    expect(await screen.findByText('参与体验优化计划')).toBeDefined();
  });
});
