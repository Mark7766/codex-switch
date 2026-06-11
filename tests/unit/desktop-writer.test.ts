import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs/promises using factory functions — no captured variables to avoid hoisting errors.
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    readdir: vi.fn(),
    chmod: vi.fn(),
    stat: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock paths helpers
vi.mock('../../electron/claude/paths', () => ({
  claudeDesktopConfigPath: vi.fn(() => '/home/user/.config/Claude/claude_desktop_config.json'),
  claudeDesktop3pConfigPath: vi.fn(() => '/home/user/.config/Claude-3p/claude_desktop_config.json'),
  claudeDesktopConfigLibraryDir: vi.fn(() => '/home/user/.config/Claude-3p/configLibrary'),
  claudeDesktopProfilePath: vi.fn(
    (id: string) => `/home/user/.config/Claude-3p/configLibrary/${id}.json`,
  ),
  claudeDesktopMetaPath: vi.fn(() => '/home/user/.config/Claude-3p/configLibrary/_meta.json'),
  backupPath: vi.fn((p: string) => `${p}.bak.20250101000000`),
}));

import fs from 'node:fs/promises';

import {
  writeClaudeDesktopConfig,
  removeClaudeDesktopConfig,
  listClaudeDesktopBackups,
  PROFILE_ID,
} from '../../electron/claude/desktop-writer';

const CS_MARKER_KEY = '__codexSwitch';
const CS_MARKER_VALUE = 'managed';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  vi.mocked(fs.rename).mockResolvedValue(undefined);
  vi.mocked(fs.chmod).mockResolvedValue(undefined);
  vi.mocked(fs.unlink).mockResolvedValue(undefined);
  vi.mocked(fs.readdir).mockResolvedValue([] as never);
  vi.mocked(fs.mkdir).mockResolvedValue(undefined);
});

describe('writeClaudeDesktopConfig', () => {
  it('writes deploymentMode=3p to both 1p and 3p config files and a gateway profile', async () => {
    // No existing files
    vi.mocked(fs.readFile).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    await writeClaudeDesktopConfig('sk-test-api-key');

    const calls = vi.mocked(fs.writeFile).mock.calls;

    // Check 1p config got deploymentMode=3p
    const oneP = calls.find(
      ([p]) =>
        typeof p === 'string' &&
        p.endsWith('Claude/claude_desktop_config.json') &&
        !p.includes('.bak.'),
    ) as [string, string, unknown] | undefined;
    expect(oneP).toBeTruthy();
    expect(JSON.parse(oneP![1])).toMatchObject({ deploymentMode: '3p' });

    // Check 3p config got deploymentMode=3p
    const threeP = calls.find(
      ([p]) =>
        typeof p === 'string' &&
        p.endsWith('Claude-3p/claude_desktop_config.json') &&
        !p.includes('.bak.'),
    ) as [string, string, unknown] | undefined;
    expect(threeP).toBeTruthy();
    expect(JSON.parse(threeP![1])).toMatchObject({ deploymentMode: '3p' });

    // Check profile JSON has the gateway fields (v1.6.0: direct DeepSeek)
    const profile = calls.find(
      ([p]) => typeof p === 'string' && p.endsWith(`${PROFILE_ID}.json`) && !p.includes('.bak.'),
    ) as [string, string, unknown] | undefined;
    expect(profile).toBeTruthy();
    const parsed = JSON.parse(profile![1]) as Record<string, unknown>;
    expect(parsed['inferenceProvider']).toBe('gateway');
    expect(parsed['inferenceGatewayBaseUrl']).toBe('https://api.deepseek.com/anthropic');
    expect(parsed['inferenceGatewayApiKey']).toBe('sk-test-api-key');
    expect(parsed['inferenceGatewayAuthScheme']).toBe('bearer');
    expect(parsed[CS_MARKER_KEY]).toBe(CS_MARKER_VALUE);
    expect(Array.isArray(parsed['inferenceModels'])).toBe(true);
    const models = parsed['inferenceModels'] as unknown[];
    expect(models.length).toBe(3);
    expect(models[0]).toEqual({ labelOverride: 'deepseek-v4-pro', name: 'claude-opus-4-7' });
    expect(models[1]).toEqual({ labelOverride: 'deepseek-v4-flash', name: 'claude-sonnet-4-6' });
    expect(models[2]).toEqual({ labelOverride: 'deepseek-v4-flash', name: 'claude-haiku-4-5' });

    // Check _meta.json registers our profile and sets appliedId
    const meta = calls.find(
      ([p]) => typeof p === 'string' && p.endsWith('_meta.json') && !p.includes('.bak.'),
    ) as [string, string, unknown] | undefined;
    expect(meta).toBeTruthy();
    const metaParsed = JSON.parse(meta![1]) as { appliedId: string; entries: { id: string }[] };
    expect(metaParsed.appliedId).toBe(PROFILE_ID);
    expect(metaParsed.entries.some((e) => e.id === PROFILE_ID)).toBe(true);
  });

  it('preserves existing user fields (e.g. mcpServers) in claude_desktop_config.json', async () => {
    vi.mocked(fs.readFile).mockImplementation(((p: string) => {
      if (p.endsWith('Claude/claude_desktop_config.json')) {
        return Promise.resolve(JSON.stringify({ mcpServers: { foo: { command: 'bar' } } }));
      }
      const err = new Error('ENOENT');
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      return Promise.reject(err);
    }) as never);

    await writeClaudeDesktopConfig('sk-test-api-key');

    const calls = vi.mocked(fs.writeFile).mock.calls;
    const oneP = calls.find(
      ([p]) =>
        typeof p === 'string' &&
        p.endsWith('Claude/claude_desktop_config.json') &&
        !p.includes('.bak.'),
    ) as [string, string, unknown] | undefined;
    expect(oneP).toBeTruthy();
    const parsed = JSON.parse(oneP![1]) as Record<string, unknown>;
    expect(parsed['mcpServers']).toEqual({ foo: { command: 'bar' } });
    expect(parsed['deploymentMode']).toBe('3p');
  });

  it('backs up existing files before modifying them', async () => {
    vi.mocked(fs.readFile).mockImplementation(((p: string) => {
      if (p.endsWith('Claude/claude_desktop_config.json')) {
        return Promise.resolve('{"existingKey":"value"}');
      }
      const err = new Error('ENOENT');
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      return Promise.reject(err);
    }) as never);

    await writeClaudeDesktopConfig('sk-test-api-key');

    const calls = vi.mocked(fs.writeFile).mock.calls;
    const bakCall = calls.find(([p]) => typeof p === 'string' && p.includes('.bak.'));
    expect(bakCall).toBeTruthy();
  });
});

describe('removeClaudeDesktopConfig', () => {
  it('switches both configs back to 1p and deletes profile when our marker is present', async () => {
    vi.mocked(fs.readFile).mockImplementation(((p: string) => {
      if (p.endsWith(`${PROFILE_ID}.json`)) {
        return Promise.resolve(JSON.stringify({ [CS_MARKER_KEY]: CS_MARKER_VALUE }));
      }
      return Promise.resolve('{"deploymentMode":"3p"}');
    }) as never);

    await removeClaudeDesktopConfig();

    expect(vi.mocked(fs.unlink)).toHaveBeenCalled();
    const unlinkPaths = vi.mocked(fs.unlink).mock.calls.map(([p]) => p as string);
    expect(unlinkPaths.some((p) => p.endsWith(`${PROFILE_ID}.json`))).toBe(true);

    const writeCalls = vi.mocked(fs.writeFile).mock.calls;
    const oneP = writeCalls.find(
      ([p]) =>
        typeof p === 'string' &&
        p.endsWith('Claude/claude_desktop_config.json') &&
        !p.includes('.bak.'),
    ) as [string, string, unknown] | undefined;
    expect(oneP).toBeTruthy();
    expect(JSON.parse(oneP![1])).toMatchObject({ deploymentMode: '1p' });
  });

  it('does NOT touch anything when profile lacks our marker', async () => {
    vi.mocked(fs.readFile).mockImplementation(((p: string) => {
      if (p.endsWith(`${PROFILE_ID}.json`)) {
        return Promise.resolve(JSON.stringify({ inferenceGatewayApiKey: 'sk-ant-real-user-key' }));
      }
      return Promise.resolve('{"deploymentMode":"3p"}');
    }) as never);

    await removeClaudeDesktopConfig();

    expect(vi.mocked(fs.unlink)).not.toHaveBeenCalled();
    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
  });

  it('does nothing when profile file does not exist', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    await expect(removeClaudeDesktopConfig()).resolves.not.toThrow();
    expect(vi.mocked(fs.unlink)).not.toHaveBeenCalled();
    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled();
  });
});

describe('listClaudeDesktopBackups', () => {
  it('returns sorted backup file paths from across config dirs', async () => {
    vi.mocked(fs.readdir).mockImplementation(((dir: string) => {
      if (dir.endsWith('Claude')) {
        return Promise.resolve([
          'claude_desktop_config.json',
          'claude_desktop_config.json.bak.20250101000001',
        ] as never);
      }
      if (dir.endsWith('Claude-3p')) {
        return Promise.resolve(['claude_desktop_config.json.bak.20250101000002'] as never);
      }
      return Promise.resolve([] as never);
    }) as never);

    const backups = await listClaudeDesktopBackups();

    expect(backups.length).toBeGreaterThanOrEqual(2);
    // Newest first
    expect(backups[0]).toContain('20250101000002');
  });
});
