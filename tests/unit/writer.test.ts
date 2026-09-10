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
  restoreOriginalConfig,
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
    const input = { model: 'deepseek-flash', apiKey: 'sk-x' };
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
    await writeCodexConfig({ model: 'deepseek-flash', apiKey: 'sk-x' });
    // v3.0.0: proxyPort 已从入参移除，改用模型名制造内容差异
    const r2 = await writeCodexConfig({ model: 'deepseek-v4-pro', apiKey: 'sk-x' });
    expect(r2.configSkipped).toBe(false);
    expect(r2.configBackup).not.toBeNull();
  });
});

describe('writeCodexConfig — rolling retention', () => {
  it('keeps at most N backups when triggering changes', async () => {
    // 用不同内容写 7 次，每次内容不同 → 每次都备份
    for (let i = 1; i <= 7; i++) {
      await writeCodexConfig({
        model: 'deepseek-flash',
        apiKey: `sk-x${i}`,
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
      model: 'deepseek-flash',
      apiKey: 'k1',
    });
    await new Promise((r) => setTimeout(r, 5));
    await writeCodexConfig({ model: 'deepseek-v4-pro', apiKey: 'k2' });
    const backups = await listBackups();
    expect(backups.config.length).toBeGreaterThan(0);
    await restoreCodexConfig(backups.config[0]!);
    const restored = await fs.readFile(r1.configPath, 'utf8');
    // v3.0.0: 配置里不再有端口，改用第一次写入的模型名验证已还原
    expect(restored).toContain('model = "deepseek-flash"');
  });
});

// ─── v2.0.0 DeepSeek 官方直连 ─────────────────────────────────────────────
describe('writeCodexConfig — deepseek direct mode (v2.0.0)', () => {
  it('writes official direct template to config.toml', async () => {
    const r = await writeCodexConfig({
      model: 'deepseek-flash',
      apiKey: 'sk-deepseek-key',
      provider: 'deepseek',
    });
    const config = await fs.readFile(r.configPath, 'utf8');
    expect(config).toContain('model = "deepseek-flash"');
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
      model: 'deepseek-flash',
      apiKey: 'sk-deepseek-key',
      provider: 'deepseek',
    });
    const auth = await fs.readFile(r.authPath, 'utf8');
    expect(auth).toContain('sk-deepseek-key');
  });

  it('writes models.json once, then skips on identical content', async () => {
    const input = {
      model: 'deepseek-flash',
      apiKey: 'sk-x',
      provider: 'deepseek' as const,
    };
    const r1 = await writeCodexConfig(input);
    expect(r1.modelsSkipped).toBe(false);
    const modelsJson = path.join(TMP_ROOT, 'models.json');
    const first = await fs.readFile(modelsJson, 'utf8');
    // v3.0.0: 官方目录恰好两个模型；旧 slug（deepseek-v4-flash*）已删除
    expect(first).toContain('"slug": "deepseek-flash"');
    expect(first).toContain('"slug": "deepseek-v4-pro"');
    expect(first).not.toContain('"slug": "deepseek-v4-flash"');
    expect(first).not.toContain('vision-exp');

    const r2 = await writeCodexConfig(input);
    expect(r2.modelsSkipped).toBe(true);
    expect(r2.modelsBackup).toBeNull();
  });

  it('does NOT write models.json for a provider without a catalog (custom)', async () => {
    const r = await writeCodexConfig({
      model: 'gpt-5.5',
      apiKey: 'sk-custom',
      provider: 'custom',
      customCodexBaseUrl: 'https://api.example.com/v1',
    });
    const config = await fs.readFile(r.configPath, 'utf8');
    expect(config).toContain('base_url = "https://api.example.com/v1"');
    expect(config).toContain('requires_openai_auth = true');
    // 自定义供应商用 auth.json 鉴权，不把 Key 写进 config.toml
    expect(config).not.toContain('sk-custom');
    expect(r.modelsBackup).toBeNull();
    await expect(fs.access(path.join(TMP_ROOT, 'models.json'))).rejects.toThrow();
  });
});

// ─── v3.0.0 智谱 GLM 直连 ─────────────────────────────────────────────────
describe('writeCodexConfig — GLM direct mode (v3.0.0)', () => {
  it('writes the official ZAI template given by 智谱 docs', async () => {
    const r = await writeCodexConfig({
      model: 'glm-5.3',
      apiKey: 'glm-key-123',
      provider: 'glm',
    });
    const config = await fs.readFile(r.configPath, 'utf8');
    expect(config).toContain('model_provider = "ZAI"');
    expect(config).toContain('[model_providers.ZAI]');
    expect(config).toContain('base_url = "https://open.bigmodel.cn/api/v1"');
    expect(config).toContain('wire_api = "responses"');
    expect(config).toContain('model_reasoning_effort = "max"');
    expect(config).toContain('model_catalog_json = "~/.codex/models.json"');
    expect(config).toContain('experimental_bearer_token = "glm-key-123"');
    // v3.0.0 起 GLM 不再经本地代理
    expect(config).not.toContain('127.0.0.1');
  });

  it('writes the GLM catalog to models.json', async () => {
    const r = await writeCodexConfig({ model: 'glm-5.3', apiKey: 'glm-key-123', provider: 'glm' });
    expect(r.modelsSkipped).toBe(false);
    const modelsJson = await fs.readFile(path.join(TMP_ROOT, 'models.json'), 'utf8');
    expect(modelsJson).toContain('"slug": "glm-5.3"');
    expect(modelsJson).toContain('"slug": "glm-5.3-flash"');
  });

  it('switching providers replaces the managed catalog entries', async () => {
    await writeCodexConfig({ model: 'glm-5.3', apiKey: 'glm-key-123', provider: 'glm' });
    await writeCodexConfig({
      model: 'deepseek-flash',
      apiKey: 'sk-deepseek',
      provider: 'deepseek',
    });
    const modelsJson = await fs.readFile(path.join(TMP_ROOT, 'models.json'), 'utf8');
    expect(modelsJson).toContain('"slug": "deepseek-flash"');
    expect(modelsJson).not.toContain('"slug": "glm-5.3"');
  });
});

// ─── restoreOriginalConfig — 切换到 OpenAI 官方 ───────────────────────────
//
// ⚠️ 切回官方**只清顶层受管键**，`[model_providers.*]` 块一律保留。
// 删块是多余的（未被选中的块是惰性的），也是有害的——Codex 按对话记住 `model_provider`，
// 删掉某家的块会让那家的历史对话报 `Model provider X not found`。详见 ADR-036。
describe('restoreOriginalConfig — switch to OpenAI official', () => {
  it('清掉顶层受管键，让 Codex 回落到内置 openai', async () => {
    const r = await writeCodexConfig({
      model: 'deepseek-flash',
      apiKey: 'sk-deepseek-key',
      provider: 'deepseek',
    });
    await restoreOriginalConfig();
    const config = await fs.readFile(r.configPath, 'utf8');
    expect(config).not.toMatch(/^model\s*=/m);
    expect(config).not.toMatch(/^model_provider\s*=/m);
    expect(config).not.toContain('preferred_auth_method');
    expect(config).not.toContain('forced_login_method');
    expect(config).not.toContain('model_reasoning_effort');
    expect(config).not.toContain('model_catalog_json');
  });

  it('保留 [model_providers.deepseek] 块（用 deepseek 的旧对话要靠它解析）', async () => {
    const r = await writeCodexConfig({
      model: 'deepseek-flash',
      apiKey: 'sk-deepseek-key',
      provider: 'deepseek',
    });
    await restoreOriginalConfig();
    const config = await fs.readFile(r.configPath, 'utf8');
    expect(config).toContain('[model_providers.deepseek]');
    expect(config).toContain('base_url = "https://api.deepseek.com/"');
    expect(config).toContain('wire_api = "responses"');
    expect(config).toContain('experimental_bearer_token = "sk-deepseek-key"');
  });

  it('preserves user-owned sections byte-for-byte', async () => {
    const r = await writeCodexConfig({
      model: 'deepseek-flash',
      apiKey: 'sk-deepseek-key',
      provider: 'deepseek',
    });
    const userBlock = [
      '[projects."/Users/mark/work/x"]',
      'trust_level = "trusted"',
      '',
      '[desktop]',
      'followUpQueueMode = "queue"',
    ].join('\n');
    await fs.appendFile(r.configPath, `\n${userBlock}\n`, 'utf8');

    await restoreOriginalConfig();
    const config = await fs.readFile(r.configPath, 'utf8');
    expect(config).toContain('[projects."/Users/mark/work/x"]');
    expect(config).toContain('trust_level = "trusted"');
    expect(config).toContain('[desktop]');
    expect(config).toContain('followUpQueueMode = "queue"');
  });

  it('清掉 [features] 受管键（整段随之消失），但保留 custom 块', async () => {
    // v3.0.0: Agnes 供应商已移除；当前唯一会写 [model_providers.custom] 与 [features] 的是 custom 供应商
    const r = await writeCodexConfig({
      model: 'gpt-5.4',
      apiKey: 'sk-custom',
      provider: 'custom',
      customCodexBaseUrl: 'https://api.example.com/v1',
    });
    await restoreOriginalConfig();
    const config = await fs.readFile(r.configPath, 'utf8');
    expect(config).not.toContain('enable_request_compression');
    expect(config).not.toContain('remote_compaction_v2');
    expect(config).not.toContain('[features]');
    expect(config).not.toMatch(/^model_provider\s*=/m);
    // custom 的块保留 —— 当初用 custom 的旧对话同样要能打开
    expect(config).toContain('[model_providers.custom]');
    expect(config).toContain('https://api.example.com/v1');
  });
});
