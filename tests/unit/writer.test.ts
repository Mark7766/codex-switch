import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// 在 import writer 前先 mock paths.ts，让它指向临时目录
const TMP_ROOT = path.join(os.tmpdir(), 'codex-switch-writer-test');

vi.mock('../../electron/codex/paths', async () => {
  const actual = await vi.importActual<typeof import('../../electron/codex/paths')>(
    '../../electron/codex/paths',
  );
  return {
    ...actual,
    codexDir: () => TMP_ROOT,
    configTomlPath: () => path.join(TMP_ROOT, 'config.toml'),
    authJsonPath: () => path.join(TMP_ROOT, 'auth.json'),
  };
});

import {
  writeCodexConfig,
  listBackups,
  listBackupsFor,
  deleteBackup,
  cleanAllBackups,
  restoreCodexConfig,
} from '../../electron/codex/writer';

beforeEach(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
  await fs.mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

describe('writeCodexConfig — content dedup', () => {
  it('skips backup+write when content unchanged', async () => {
    const input = { proxyPort: 11435, model: 'deepseek-v4-flash', apiKey: 'sk-x' };
    const r1 = await writeCodexConfig(input);
    expect(r1.configSkipped).toBe(false);
    expect(r1.authSkipped).toBe(false);

    // 第二次相同内容 → 应跳过
    const r2 = await writeCodexConfig(input);
    expect(r2.configSkipped).toBe(true);
    expect(r2.authSkipped).toBe(true);
    expect(r2.configBackup).toBeNull();
    expect(r2.authBackup).toBeNull();
  });

  it('creates new backup when content changes', async () => {
    await writeCodexConfig({ proxyPort: 11435, model: 'deepseek-v4-flash', apiKey: 'sk-x' });
    const r2 = await writeCodexConfig({
      proxyPort: 11436,
      model: 'deepseek-v4-flash',
      apiKey: 'sk-x',
    });
    expect(r2.configSkipped).toBe(false);
    expect(r2.configBackup).not.toBeNull();
  });
});

describe('writeCodexConfig — rolling retention', () => {
  it('keeps at most N backups when triggering changes', async () => {
    // 用不同内容写 7 次，每次内容不同 → 每次都备份
    for (let i = 1; i <= 7; i++) {
      await writeCodexConfig({
        proxyPort: 11435 + i,
        model: 'deepseek-v4-flash',
        apiKey: 'sk-x',
        maxBackupsPerFile: 5,
      });
      // 错开 timestamp（同一秒内 backupPath 会重名）
      await new Promise((r) => setTimeout(r, 5));
    }
    const backups = await listBackups();
    expect(backups.config.length).toBeLessThanOrEqual(5);
  });
});

describe('pruneBackups + listBackupsFor', () => {
  it('returns empty for non-existent file', async () => {
    const result = await listBackupsFor(path.join(TMP_ROOT, 'nope.txt'));
    expect(result).toEqual([]);
  });
});

describe('deleteBackup safety', () => {
  it('refuses non-backup paths', async () => {
    const original = path.join(TMP_ROOT, 'config.toml');
    await fs.writeFile(original, 'x');
    await expect(deleteBackup(original)).rejects.toThrow();
  });
});

describe('cleanAllBackups', () => {
  it('removes all .bak.* files in codex dir', async () => {
    await fs.writeFile(path.join(TMP_ROOT, 'config.toml.bak.1'), 'a');
    await fs.writeFile(path.join(TMP_ROOT, 'auth.json.bak.2'), 'b');
    await fs.writeFile(path.join(TMP_ROOT, 'config.toml'), 'live');
    const removed = await cleanAllBackups();
    expect(removed).toHaveLength(2);
    const after = await listBackups();
    expect(after.config).toEqual([]);
    expect(after.auth).toEqual([]);
  });
});

describe('restoreCodexConfig', () => {
  it('round-trip: backup then restore yields original content', async () => {
    const r1 = await writeCodexConfig({
      proxyPort: 11435,
      model: 'deepseek-v4-flash',
      apiKey: 'k1',
    });
    await new Promise((r) => setTimeout(r, 5));
    await writeCodexConfig({ proxyPort: 99999, model: 'deepseek-v4-pro', apiKey: 'k2' });
    const backups = await listBackups();
    expect(backups.config.length).toBeGreaterThan(0);
    await restoreCodexConfig(backups.config[0]!);
    const restored = await fs.readFile(r1.configPath, 'utf8');
    expect(restored).toContain('11435');
  });
});

// ─── v2.0.0 DeepSeek 官方直连 ─────────────────────────────────────────────
describe('writeCodexConfig — deepseek direct mode (v2.0.0)', () => {
  it('writes official direct template to config.toml', async () => {
    const r = await writeCodexConfig({
      proxyPort: 11435,
      model: 'deepseek-v4-flash',
      apiKey: 'sk-deepseek-key',
      provider: 'deepseek',
    });
    const config = await fs.readFile(r.configPath, 'utf8');
    expect(config).toContain('model = "deepseek-v4-flash"');
    expect(config).toContain('model_provider = "deepseek"');
    expect(config).toContain('preferred_auth_method = "apikey"');
    expect(config).toContain('forced_login_method = "api"');
    expect(config).toContain('model_reasoning_effort = "high"');
    expect(config).toContain('model_catalog_json = "~/.codex/models.json"');
    expect(config).toContain('base_url = "https://api.deepseek.com/"');
    expect(config).toContain('wire_api = "responses"');
    expect(config).toContain('experimental_bearer_token = "sk-deepseek-key"');
    expect(config).not.toContain('127.0.0.1');
  });

  it('still writes auth.json mirroring the DeepSeek key', async () => {
    const r = await writeCodexConfig({
      proxyPort: 11435,
      model: 'deepseek-v4-flash',
      apiKey: 'sk-deepseek-key',
      provider: 'deepseek',
    });
    const auth = await fs.readFile(r.authPath, 'utf8');
    expect(auth).toContain('sk-deepseek-key');
  });

  it('writes models.json once, then skips on identical content', async () => {
    const input = {
      proxyPort: 11435,
      model: 'deepseek-v4-flash',
      apiKey: 'sk-x',
      provider: 'deepseek' as const,
    };
    const r1 = await writeCodexConfig(input);
    expect(r1.modelsSkipped).toBe(false);
    const modelsJson = path.join(TMP_ROOT, 'models.json');
    const first = await fs.readFile(modelsJson, 'utf8');
    expect(first).toContain('"slug": "deepseek-v4-flash"');
    expect(first).toContain('"slug": "deepseek-v4-pro"');

    const r2 = await writeCodexConfig(input);
    expect(r2.modelsSkipped).toBe(true);
    expect(r2.modelsBackup).toBeNull();
  });

  it('does NOT write models.json for agnes (still proxy template)', async () => {
    const r = await writeCodexConfig({
      proxyPort: 11435,
      model: 'deepseek-v4-flash',
      apiKey: 'sk-agnes',
      provider: 'agnes',
    });
    const config = await fs.readFile(r.configPath, 'utf8');
    expect(config).toContain('127.0.0.1');
    expect(config).toContain('model_provider = "custom"');
    expect(r.modelsBackup).toBeNull();
    await expect(fs.access(path.join(TMP_ROOT, 'models.json'))).rejects.toThrow();
  });
});
