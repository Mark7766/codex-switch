/**
 * Settings page smoke tests (C2).
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Settings } from '../../src/pages/Settings';

/** 默认偏好；单测可就地覆盖某一字段（如 defaultModel）后用 mockResolvedValueOnce 注入。 */
const BASE_PREFS = {
  defaultModel: 'deepseek-flash',
  hasCompletedSetup: true,
  maxBackupsPerFile: 5,
  lastSeenVersion: '1.7.0',
  autoCheckUpdate: true,
  autoDownload: true,
  updateMirror: 'server',
  customMirrorUrl: '',
  serverUrl: '',
  telemetryEnabled: true,
  clientId: '',
  hasSeenOnboarding: true,
  hasSeenPlugins: true,
  lifetimeFirstStartAt: '2026-06-13',
  provider: 'deepseek',
  claudeDesktopProvider: 'deepseek',
  claudeCliProvider: 'deepseek',
  customProvider: { codexBaseUrl: '', claudeBaseUrl: '' },
};

/** 供应商描述符桩（形状与 electron/config/providers.ts 一致，经 providers:list 下发）。 */
const PROVIDER_STUBS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    codex: {
      providerId: 'deepseek',
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com/',
      reasoningEffort: 'high',
      preferredAuthMethod: 'apikey',
      forcedLoginMethod: 'api',
      bearerTokenInToml: true,
      requiresOpenAiAuth: false,
      contextWindowOverrides: false,
      featureFlags: false,
      models: ['deepseek-flash', 'deepseek-v4-pro'],
      defaultModel: 'deepseek-flash',
      catalogAsset: 'deepseek-models.json',
      retiredPrefixes: ['deepseek-v4-flash'],
    },
    claude: {
      baseUrl: 'https://api.deepseek.com/anthropic',
      models: ['deepseek-v4-pro', 'deepseek-flash'],
      slots: [
        { id: 'claude-opus-4-7', tier: 'opus', label: 'Claude Opus 4.7' },
        { id: 'claude-sonnet-4-6', tier: 'sonnet', label: 'Claude Sonnet 4.6' },
        { id: 'claude-haiku-4-5', tier: 'haiku', label: 'Claude Haiku 4.5' },
      ],
      roleDefaults: { opus: 'deepseek-v4-pro', sonnet: 'deepseek-flash', haiku: 'deepseek-flash' },
      includeHaiku: true,
      acceptedModelPrefixes: ['deepseek'],
    },
    key: {
      account: 'deepseek-api-key',
      fallbackField: 'apiKey',
      prefix: 'sk-',
      minLength: 10,
      placeholder: '新的 sk-...',
      hint: '在 platform.deepseek.com 获取 API Key',
    },
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    codex: {
      providerId: 'ZAI',
      name: 'ZAI',
      baseUrl: 'https://open.bigmodel.cn/api/v1',
      reasoningEffort: 'max',
      bearerTokenInToml: true,
      requiresOpenAiAuth: false,
      contextWindowOverrides: false,
      featureFlags: false,
      models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2'],
      defaultModel: 'glm-5.3',
      catalogAsset: 'glm-models.json',
    },
    claude: {
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2'],
      slots: [
        { id: 'claude-opus-4-7', tier: 'opus', label: 'Claude Opus 4.7' },
        { id: 'claude-sonnet-4-6', tier: 'sonnet', label: 'Claude Sonnet 4.6' },
        { id: 'claude-haiku-4-5', tier: 'haiku', label: 'Claude Haiku 4.5' },
      ],
      roleDefaults: { opus: 'glm-5.3', sonnet: 'glm-5.3-flash', haiku: 'glm-5.3-flash' },
      includeHaiku: true,
      acceptedModelPrefixes: ['glm'],
    },
    key: {
      account: 'glm-api-key',
      fallbackField: 'glmApiKey',
      minLength: 10,
      placeholder: '智谱 GLM API Key',
      hint: '在 open.bigmodel.cn 或 z.ai 获取 API Key',
    },
  },
];

// Mock the IPC bridge
const mockApi = {
  getPreferences: vi.fn().mockResolvedValue(BASE_PREFS),
  getProviders: vi.fn().mockResolvedValue(PROVIDER_STUBS),
  getKey: vi.fn().mockResolvedValue('sk-••••••••'),
  setKey: vi.fn().mockResolvedValue(true),
  clearKey: vi.fn().mockResolvedValue(true),
  codexBackups: vi.fn().mockResolvedValue({ config: [], auth: [] }),
  getVersion: vi.fn().mockResolvedValue('1.7.0'),
  applyPreferences: vi.fn().mockResolvedValue({ prefs: {}, codexWritten: true }),
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
    expect(await screen.findByText('默认模型')).toBeDefined();
  });

  it('no longer renders proxy-only settings (端口 / 自动启动代理 / 对话缓存)', async () => {
    render(<Settings />);
    await screen.findByText('默认模型');
    for (const gone of ['本地端口', '启动应用时自动启动代理', '对话缓存', '拦截 Codex Desktop']) {
      expect(screen.queryByText(new RegExp(gone)), gone).toBeNull();
    }
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

describe('Settings page — Codex 默认模型下拉（v3.0.0 阵容收敛）', () => {
  /** 「默认模型」下拉是页面上 options 含 deepseek-v4-pro 的那个（本页有多个 select）。 */
  function findModelSelect(): HTMLSelectElement {
    const el = screen
      .getAllByRole('combobox')
      .find((s) =>
        Array.from((s as HTMLSelectElement).options).some((o) => o.value === 'deepseek-v4-pro'),
      );
    expect(el).toBeTruthy();
    return el as HTMLSelectElement;
  }

  it('offers exactly the two bare model ids, with no explanatory text', async () => {
    render(<Settings />);
    await screen.findAllByRole('combobox');

    const sel = findModelSelect();
    expect(Array.from(sel.options).map((o) => o.value)).toEqual([
      'deepseek-flash',
      'deepseek-v4-pro',
    ]);
    // 选项文字就是模型名本身，「不写说明」
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual([
      'deepseek-flash',
      'deepseek-v4-pro',
    ]);
  });

  it('folds a retired model name to deepseek-flash instead of rendering blank', async () => {
    // 存量用户可能存着已被移除的选项（如 vision-exp）——必须折叠，否则 <select> 匹配不到 option。
    mockApi.getPreferences.mockResolvedValueOnce({
      ...BASE_PREFS,
      defaultModel: 'deepseek-v4-flash-vision-exp',
    });
    render(<Settings />);
    await screen.findAllByRole('combobox');

    const sel = findModelSelect();
    expect(sel.value).toBe('deepseek-flash');
    expect(Array.from(sel.options).map((o) => o.value)).not.toContain(
      'deepseek-v4-flash-vision-exp',
    );
  });

  it('keeps deepseek-v4-pro selected as-is', async () => {
    mockApi.getPreferences.mockResolvedValueOnce({
      ...BASE_PREFS,
      defaultModel: 'deepseek-v4-pro',
    });
    render(<Settings />);
    await screen.findAllByRole('combobox');

    expect(findModelSelect().value).toBe('deepseek-v4-pro');
  });
});
