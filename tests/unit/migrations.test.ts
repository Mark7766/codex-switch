import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TMP_ROOT = path.join(os.tmpdir(), 'codex-switch-migrations-test');

vi.mock('../../electron/config/store', () => ({
  getPreferences: vi.fn(),
  setPreferences: vi.fn(),
}));
vi.mock('../../electron/config/secrets', () => ({
  getApiKey: vi.fn(),
  getAgnesKey: vi.fn(),
  getGlmKey: vi.fn(),
  getCustomKey: vi.fn(),
}));
vi.mock('../../electron/codex/writer', () => ({
  writeCodexConfig: vi.fn(),
}));
vi.mock('../../electron/codex/paths', () => ({
  codexDir: () => TMP_ROOT,
  configTomlPath: () => path.join(TMP_ROOT, 'config.toml'),
  authJsonPath: () => path.join(TMP_ROOT, 'auth.json'),
  backupPath: (p: string) => `${p}.bak.test`,
}));

import { getPreferences, setPreferences } from '../../electron/config/store';
import { getApiKey } from '../../electron/config/secrets';
import { writeCodexConfig } from '../../electron/codex/writer';
import { runV200DeepSeekDirectMigration } from '../../electron/config/migrations';

const getPrefs = getPreferences as ReturnType<typeof vi.fn>;
const setPrefs = setPreferences as ReturnType<typeof vi.fn>;
const getKey = getApiKey as ReturnType<typeof vi.fn>;
const writeCfg = writeCodexConfig as ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
  await fs.mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

describe('runV200DeepSeekDirectMigration', () => {
  it('returns false and rewrites nothing when flag already set', async () => {
    getPrefs.mockReturnValue({
      migrations: { v200_deepseekDirect: true },
      provider: 'deepseek',
      proxyPort: 11435,
      defaultModel: 'deepseek-v4-flash',
    });
    const ran = await runV200DeepSeekDirectMigration();
    expect(ran).toBe(false);
    expect(writeCfg).not.toHaveBeenCalled();
  });

  it('marks done without rewrite when provider is not deepseek', async () => {
    getPrefs.mockReturnValue({
      migrations: {},
      provider: 'agnes',
      proxyPort: 11435,
      defaultModel: 'deepseek-v4-flash',
    });
    const ran = await runV200DeepSeekDirectMigration();
    expect(ran).toBe(true);
    expect(writeCfg).not.toHaveBeenCalled();
    expect(setPrefs).toHaveBeenCalledWith({
      migrations: { v200_deepseekDirect: true },
    });
  });

  it('rewrites proxy-based config.toml to direct when provider is deepseek', async () => {
    getPrefs.mockReturnValue({
      migrations: {},
      provider: 'deepseek',
      proxyPort: 11435,
      defaultModel: 'deepseek-v4-flash',
    });
    getKey.mockResolvedValue('sk-test');
    await fs.writeFile(
      path.join(TMP_ROOT, 'config.toml'),
      'model_provider = "custom"\nbase_url = "http://127.0.0.1:11435/v1"\n',
    );
    const ran = await runV200DeepSeekDirectMigration();
    expect(ran).toBe(true);
    expect(writeCfg).toHaveBeenCalledWith({
      proxyPort: 11435,
      model: 'deepseek-v4-flash',
      apiKey: 'sk-test',
      provider: 'deepseek',
    });
    expect(setPrefs).toHaveBeenCalledWith({
      migrations: { v200_deepseekDirect: true },
    });
  });

  it('does not rewrite when config.toml already direct', async () => {
    getPrefs.mockReturnValue({
      migrations: {},
      provider: 'deepseek',
      proxyPort: 11435,
      defaultModel: 'deepseek-v4-flash',
    });
    getKey.mockResolvedValue('sk-test');
    await fs.writeFile(
      path.join(TMP_ROOT, 'config.toml'),
      'model_provider = "deepseek"\nbase_url = "https://api.deepseek.com/"\n',
    );
    const ran = await runV200DeepSeekDirectMigration();
    expect(ran).toBe(true);
    expect(writeCfg).not.toHaveBeenCalled();
  });
});
