import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs/promises using factory functions — no captured variables to avoid hoisting errors.
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    chmod: vi.fn(),
    stat: vi.fn(),
    readdir: vi.fn().mockResolvedValue([]),
    unlink: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock paths helpers
vi.mock('../../electron/claude/paths', () => ({
  shellProfilePaths: vi.fn(() => ['/home/user/.zshrc']),
  backupPath: vi.fn((p: string) => `${p}.bak.20250101000000`),
  claudeCliSettingsPath: vi.fn(() => '/home/user/.claude/settings.json'),
  claudeCliConfigJsonPath: vi.fn(() => '/home/user/.claude/config.json'),
  claudeCliDir: vi.fn(() => '/home/user/.claude'),
}));

import fs from 'node:fs/promises';

import {
  writeClaudeCliConfig,
  removeClaudeCliConfig,
  DEFAULT_ENV_VARS,
  BLOCK_START,
  BLOCK_END,
} from '../../electron/claude/env-writer';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  vi.mocked(fs.chmod).mockResolvedValue(undefined);
  vi.mocked(fs.rename).mockResolvedValue(undefined);
  vi.mocked(fs.mkdir).mockResolvedValue(undefined);
  // Default: non-empty profile (triggers backup write as call 0, then profile write as call 1)
  vi.mocked(fs.readFile).mockResolvedValue('# existing content\n' as never);
});

describe('writeClaudeCliConfig', () => {
  it('writes env var block to shell profile', async () => {
    await writeClaudeCliConfig('sk-test-key', DEFAULT_ENV_VARS);

    // Shell profile is identifiable by `.zshrc`
    const calls = vi.mocked(fs.writeFile).mock.calls;
    const profileCall = calls.find(
      ([p]) => typeof p === 'string' && p.endsWith('.zshrc') && !p.includes('.bak.'),
    ) as [string, string, unknown] | undefined;
    expect(profileCall).toBeTruthy();
    expect(profileCall![1]).toContain(BLOCK_START);
    expect(profileCall![1]).toContain(BLOCK_END);
    expect(profileCall![1]).toContain('ANTHROPIC_AUTH_TOKEN="sk-test-key"');
  });

  it('also writes ~/.claude/settings.json with env vars (no terminal restart needed)', async () => {
    await writeClaudeCliConfig('sk-test-key', DEFAULT_ENV_VARS);

    const calls = vi.mocked(fs.writeFile).mock.calls;
    const settingsCall = calls.find(
      ([p]) => typeof p === 'string' && p.endsWith('settings.json') && !p.includes('.bak.'),
    ) as [string, string, unknown] | undefined;
    expect(settingsCall).toBeTruthy();
    const parsed = JSON.parse(settingsCall![1]) as {
      env: Record<string, string>;
    };
    expect(parsed.env['ANTHROPIC_AUTH_TOKEN']).toBe('sk-test-key');
    expect(parsed.env['ANTHROPIC_BASE_URL']).toBe('https://api.deepseek.com/anthropic');
  });

  it('removes existing block before re-writing', async () => {
    const existingBlock = `# existing\n${BLOCK_START}\nexport ANTHROPIC_AUTH_TOKEN=old\n${BLOCK_END}\n# end`;
    vi.mocked(fs.readFile).mockImplementation(((p: string) => {
      if (p.endsWith('.zshrc')) return Promise.resolve(existingBlock);
      return Promise.resolve('# existing content\n');
    }) as never);

    await writeClaudeCliConfig('sk-new-key', DEFAULT_ENV_VARS);

    const calls = vi.mocked(fs.writeFile).mock.calls;
    const profileCall = calls.find(
      ([p]) => typeof p === 'string' && p.endsWith('.zshrc') && !p.includes('.bak.'),
    ) as [string, string, unknown] | undefined;
    expect(profileCall).toBeTruthy();
    expect(profileCall![1]).toContain(BLOCK_START);
    expect(profileCall![1]).toContain('sk-new-key');
  });
});

describe('removeClaudeCliConfig', () => {
  it('removes the block from shell profile', async () => {
    const withBlock = `# before\n${BLOCK_START}\nexport X=1\n${BLOCK_END}\n# after\n`;
    vi.mocked(fs.readFile).mockImplementation(((p: string) => {
      if (p.endsWith('.zshrc')) return Promise.resolve(withBlock);
      // settings.json: signal "no managed marker" so removeSettingsJson returns early
      const err = new Error('ENOENT');
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      return Promise.reject(err);
    }) as never);

    await removeClaudeCliConfig();

    const calls = vi.mocked(fs.writeFile).mock.calls;
    const profileCall = calls.find(
      ([p]) => typeof p === 'string' && p.endsWith('.zshrc'),
    ) as [string, string, unknown] | undefined;
    expect(profileCall).toBeTruthy();
    const content = profileCall![1];
    expect(content).not.toContain(BLOCK_START);
    expect(content).toContain('# before');
    expect(content).toContain('# after');
  });

  it('does nothing to shell profile when no block present', async () => {
    vi.mocked(fs.readFile).mockImplementation(((p: string) => {
      if (p.endsWith('.zshrc')) return Promise.resolve('# no block here\n');
      const err = new Error('ENOENT');
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      return Promise.reject(err);
    }) as never);

    await removeClaudeCliConfig();

    const calls = vi.mocked(fs.writeFile).mock.calls;
    const profileCall = calls.find(
      ([p]) => typeof p === 'string' && p.endsWith('.zshrc'),
    );
    expect(profileCall).toBeUndefined();
  });
});
