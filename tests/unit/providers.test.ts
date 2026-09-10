import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TMP_ROOT = path.join(os.tmpdir(), 'codex-switch-providers-test');

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

import { writeCodexConfig } from '../../electron/codex/writer';
import { readModelsJsonAsset } from '../../electron/codex/models-catalog';
import {
  normalizeProvider,
  getProvider,
  managedProviderBlockPattern,
  PROVIDER_LIST,
  PROVIDERS,
} from '../../electron/config/providers';

const CUSTOM_BASE = 'https://custom.example.com/v1';

beforeEach(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
  await fs.mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

/**
 * 渲染进程通过 IPC 通道 `providers:list` 拿到 PROVIDER_LIST。描述符里只要出现一个函数
 * 或 RegExp，JSON 序列化就会把它悄悄丢掉，设置页随之静默出错——所以这条断言是那个 IPC
 * 契约的守门人。
 */
describe('provider registry — IPC 契约', () => {
  it('描述符必须是纯数据（JSON 往返后深等）', () => {
    expect(JSON.parse(JSON.stringify(PROVIDER_LIST))).toEqual(PROVIDER_LIST);
  });

  it('供应商 id、Codex providerId、keytar account 均不重复', () => {
    const ids = PROVIDER_LIST.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);

    const tomProviders = PROVIDER_LIST.map((p) => p.codex.providerId);
    expect(new Set(tomProviders).size).toBe(tomProviders.length);

    const accounts = PROVIDER_LIST.map((p) => p.key.account);
    expect(new Set(accounts).size).toBe(accounts.length);
  });

  it('每个供应商都有非空模型列表，且 defaultModel 在列表内', () => {
    for (const p of PROVIDER_LIST) {
      expect(p.codex.models.length).toBeGreaterThan(0);
      expect(p.codex.models).toContain(p.codex.defaultModel);
      expect(p.claude.models.length).toBeGreaterThan(0);
    }
  });

  it('每个档位都有默认模型，且默认值在 Claude 模型列表内', () => {
    for (const p of PROVIDER_LIST) {
      for (const slot of p.claude.slots) {
        const def = p.claude.roleDefaults[slot.tier];
        expect(def, `${p.id}/${slot.tier}`).toBeTruthy();
        expect(p.claude.models).toContain(def);
      }
    }
  });

  it('声明的模型目录资产都存在且可解析', async () => {
    for (const p of PROVIDER_LIST) {
      if (!p.codex.catalogAsset) continue;
      const parsed = JSON.parse(await readModelsJsonAsset(p.codex.catalogAsset)) as {
        models: Array<{ slug: string }>;
      };
      expect(parsed.models.length).toBeGreaterThan(0);
    }
  });
});

describe('provider registry — normalizeProvider / getProvider', () => {
  it('把已移除的 agnes 与未知值归一化为默认供应商', () => {
    expect(normalizeProvider('agnes')).toBe('deepseek');
    expect(normalizeProvider(undefined)).toBe('deepseek');
    expect(normalizeProvider('')).toBe('deepseek');
    expect(normalizeProvider('nonsense')).toBe('deepseek');
  });

  it('已知供应商原样保留', () => {
    expect(normalizeProvider('deepseek')).toBe('deepseek');
    expect(normalizeProvider('glm')).toBe('glm');
    expect(normalizeProvider('custom')).toBe('custom');
  });

  it('getProvider 对 agnes 不返回 undefined（否则每次启动都会 TypeError）', () => {
    expect(getProvider('agnes').id).toBe('deepseek');
    expect(getProvider(undefined).id).toBe('deepseek');
  });

  it('PROVIDERS 与 PROVIDER_LIST 一致', () => {
    for (const p of PROVIDER_LIST) expect(PROVIDERS[p.id]).toBe(p);
  });
});

describe('provider registry — 受管 provider 段名', () => {
  it('正则覆盖每个供应商的 providerId', () => {
    const re = managedProviderBlockPattern();
    for (const p of PROVIDER_LIST) {
      expect(re.test(`model_providers.${p.codex.providerId}`)).toBe(true);
    }
  });

  it('不误伤用户自己的 provider 段', () => {
    const re = managedProviderBlockPattern();
    expect(re.test('model_providers.openai')).toBe(false);
    expect(re.test('model_providers.my_own')).toBe(false);
  });
});

// ─── 每个供应商都必须产出「Codex 读得懂」的直连配置 ─────────────────────────

describe('每个供应商产出的 config.toml', () => {
  async function write(providerId: 'deepseek' | 'glm' | 'custom'): Promise<string> {
    const descriptor = getProvider(providerId);
    const r = await writeCodexConfig({
      model: descriptor.codex.defaultModel,
      apiKey: 'test-key-123456',
      provider: providerId,
      customCodexBaseUrl: CUSTOM_BASE,
    });
    return fs.readFile(r.configPath, 'utf8');
  }

  it.each(['deepseek', 'glm', 'custom'] as const)(
    '%s：必需顶层键齐全且段名与 model_provider 一致',
    async (providerId) => {
      const descriptor = getProvider(providerId);
      const toml = await write(providerId);

      expect(toml).toContain(`model = "${descriptor.codex.defaultModel}"`);
      expect(toml).toContain(`model_provider = "${descriptor.codex.providerId}"`);
      expect(toml).toContain(`[model_providers.${descriptor.codex.providerId}]`);
      expect(toml).toContain(`name = "${descriptor.codex.name}"`);
      expect(toml).toContain('wire_api = "responses"');
      expect(toml).toContain(`model_reasoning_effort = "${descriptor.codex.reasoningEffort}"`);
    },
  );

  it.each(['deepseek', 'glm', 'custom'] as const)('%s：端点逐字节写入', async (providerId) => {
    const descriptor = getProvider(providerId);
    const expected = descriptor.codex.baseUrl === 'custom' ? CUSTOM_BASE : descriptor.codex.baseUrl;
    expect(await write(providerId)).toContain(`base_url = "${expected}"`);
  });

  it('DeepSeek 的尾斜杠不被「规范化」掉', async () => {
    expect(await write('deepseek')).toContain('base_url = "https://api.deepseek.com/"');
  });

  it('GLM 用官方给定的 /api/v1 端点', async () => {
    expect(await write('glm')).toContain('base_url = "https://open.bigmodel.cn/api/v1"');
  });

  it.each(['deepseek', 'glm', 'custom'] as const)(
    '%s：model_catalog_json 当且仅当有 catalogAsset 时出现',
    async (providerId) => {
      const descriptor = getProvider(providerId);
      const hasCatalog = Boolean(descriptor.codex.catalogAsset);
      expect((await write(providerId)).includes('model_catalog_json')).toBe(hasCatalog);
    },
  );

  it.each(['deepseek', 'glm', 'custom'] as const)(
    '%s：鉴权字段与其声明一致',
    async (providerId) => {
      const descriptor = getProvider(providerId);
      const toml = await write(providerId);

      if (descriptor.codex.bearerTokenInToml) {
        expect(toml).toContain('experimental_bearer_token = "test-key-123456"');
      } else {
        // 自定义供应商靠 auth.json 鉴权，Key 不得出现在 config.toml
        expect(toml).not.toContain('test-key-123456');
      }
      expect(toml.includes('requires_openai_auth = true')).toBe(
        descriptor.codex.requiresOpenAiAuth,
      );
      expect(toml.includes('preferred_auth_method')).toBe(
        Boolean(descriptor.codex.preferredAuthMethod),
      );
      expect(toml.includes('forced_login_method')).toBe(
        Boolean(descriptor.codex.forcedLoginMethod),
      );
    },
  );

  it.each(['deepseek', 'glm', 'custom'] as const)(
    '%s：绝不包含本地代理地址（v3.0.0 最重要的一条护栏）',
    async (providerId) => {
      const toml = await write(providerId);
      expect(toml).not.toContain('127.0.0.1');
      expect(toml).not.toContain('localhost');
      expect(toml).not.toMatch(/:\d{4,5}\b/);
    },
  );

  it.each(['deepseek', 'glm', 'custom'] as const)(
    '%s：sanitize 只清顶层受管键，自己的块必须留下（切换到 OpenAI 官方）',
    async (providerId) => {
      const { sanitizeManagedConfig } = await import('../../electron/codex/config-restore');
      const descriptor = getProvider(providerId);
      const toml = await write(providerId);
      const cleaned = sanitizeManagedConfig(toml);
      // 顶层受管键清干净 = 真的切回官方了（BUG-007 的要害就是 model_provider 残留）
      expect(cleaned).not.toMatch(/^model\s*=/m);
      expect(cleaned).not.toMatch(/^model_provider\s*=/m);
      expect(cleaned).not.toContain('model_reasoning_effort');
      expect(cleaned).not.toContain('model_catalog_json');
      expect(cleaned).not.toContain('model_context_window');
      expect(cleaned).not.toContain('model_auto_compact_token_limit');
      expect(cleaned).not.toContain('enable_request_compression');
      // 块必须留下 —— 用这家供应商的旧对话靠它解析，删了就报 Model provider X not found
      expect(cleaned).toContain(`[model_providers.${descriptor.codex.providerId}]`);
      expect(cleaned).toContain('wire_api = "responses"');
    },
  );
});
