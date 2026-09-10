import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sanitizeManagedConfig } from '../../electron/codex/config-restore';

const TMP_ROOT = path.join(os.tmpdir(), 'codex-switch-config-merge-test');

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

import { restoreOriginalConfig, writeCodexConfig } from '../../electron/codex/writer';

const CONFIG = () => path.join(TMP_ROOT, 'config.toml');
const read = () => fs.readFile(CONFIG(), 'utf8');

/** 一份「真实用户」的 config.toml：我方的 deepseek 块 + 用户/Codex 自有内容 + 用户自建 provider。 */
const REALISTIC_CONFIG = [
  'model = "deepseek-flash"',
  'model_provider = "deepseek"',
  'model_reasoning_effort = "high"',
  'notify = ["/usr/bin/foo"]',
  '',
  '[model_providers.deepseek]',
  'name = "deepseek"',
  'base_url = "https://api.deepseek.com/"',
  'wire_api = "responses"',
  'experimental_bearer_token = "sk-old-deepseek"',
  '',
  '[desktop]',
  'followUpQueueMode = "queue"',
  '',
  '[mcp_servers.node_repl]',
  'command = "/usr/bin/node"',
  'args = []',
  '',
  '[mcp_servers.node_repl.env]',
  'X = "1"',
  '',
  '[projects."/tmp/x"]',
  'trust_level = "trusted"',
  '',
  '[model_providers.mine]',
  'name = "mine"',
  'base_url = "https://mine.example/"',
  '',
].join('\n');

beforeEach(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
  await fs.mkdir(TMP_ROOT, { recursive: true });
  await fs.writeFile(CONFIG(), REALISTIC_CONFIG, 'utf8');
});

afterEach(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

/**
 * v3.0.0 回归：**Codex 是按对话记住 `model_provider` 的**（会话文件 `payload.model_provider`）。
 * 旧实现切供应商时整份覆盖 config.toml，把上一家的 provider 块删掉 —— 于是那家供应商的
 * 历史对话再打开就报 `Model provider <旧供应商> not found`。
 *
 * 本文件锁定「合并写」：只更新当前供应商的块，其余一律保留。
 */
describe('config.toml 合并写 — 供应商块连续性', () => {
  it('切到 GLM 后仍保留 [model_providers.deepseek]（旧对话要靠它解析）', async () => {
    await writeCodexConfig({ model: 'glm-5.3', apiKey: 'glm-key', provider: 'glm' });
    const cfg = await read();

    expect(cfg).toContain('[model_providers.deepseek]');
    // 且保留的是**原有那份**（旧 token 仍在），我们不去合成它
    expect(cfg).toContain('experimental_bearer_token = "sk-old-deepseek"');
    // 当前供应商的块也写好了
    expect(cfg).toContain('[model_providers.ZAI]');
    expect(cfg).toContain('model_provider = "ZAI"');
  });

  it('切回 DeepSeek 后仍保留 [model_providers.ZAI]', async () => {
    await writeCodexConfig({ model: 'glm-5.3', apiKey: 'glm-key', provider: 'glm' });
    await writeCodexConfig({ model: 'deepseek-flash', apiKey: 'sk-new', provider: 'deepseek' });
    const cfg = await read();

    expect(cfg).toContain('[model_providers.ZAI]');
    expect(cfg).toContain('[model_providers.deepseek]');
    // 当前供应商的块被**更新**（新 token）
    expect(cfg).toContain('experimental_bearer_token = "sk-new"');
    expect(cfg).not.toContain('sk-old-deepseek');
  });

  it('当前供应商的块只出现一次（是「更新」不是「追加」）', async () => {
    await writeCodexConfig({ model: 'deepseek-flash', apiKey: 'sk-a', provider: 'deepseek' });
    await writeCodexConfig({ model: 'deepseek-v4-pro', apiKey: 'sk-b', provider: 'deepseek' });
    const cfg = await read();

    expect(cfg.match(/\[model_providers\.deepseek\]/g)).toHaveLength(1);
    // 顶层受管键也不重复
    expect(cfg.match(/^model = /gm)).toHaveLength(1);
    expect(cfg.match(/^model_provider = /gm)).toHaveLength(1);
  });
});

describe('config.toml 合并写 — 保留用户自有内容', () => {
  it('用户/Codex 自有的顶层键与所有段逐字保留', async () => {
    await writeCodexConfig({ model: 'glm-5.3', apiKey: 'glm-key', provider: 'glm' });
    const cfg = await read();

    expect(cfg).toContain('notify = ["/usr/bin/foo"]');
    expect(cfg).toContain('[desktop]');
    expect(cfg).toContain('followUpQueueMode = "queue"');
    expect(cfg).toContain('[mcp_servers.node_repl]');
    expect(cfg).toContain('[mcp_servers.node_repl.env]');
    expect(cfg).toContain('[projects."/tmp/x"]');
    expect(cfg).toContain('trust_level = "trusted"');
    // 用户自建的 provider 段不能被当成受管的删掉
    expect(cfg).toContain('[model_providers.mine]');
    expect(cfg).toContain('base_url = "https://mine.example/"');
  });

  it('所有顶层键都排在第一个表头之前（否则 TOML 会把它们吞进上一张表）', async () => {
    await writeCodexConfig({ model: 'glm-5.3', apiKey: 'glm-key', provider: 'glm' });
    const lines = (await read()).split('\n');
    const firstTable = lines.findIndex((l) => /^\s*\[/.test(l));
    expect(firstTable).toBeGreaterThan(-1);

    // 只看「已知是顶层」的键：表内的 `name =`、`base_url =` 等不在此列
    for (const key of ['model', 'model_provider', 'model_reasoning_effort', 'notify']) {
      const idx = lines.findIndex((l) => new RegExp(`^${key}\\s*=`).test(l));
      expect(idx, `顶层键 ${key} 缺失`).toBeGreaterThan(-1);
      expect(idx, `顶层键 ${key} 出现在第一个表头之后，会被 TOML 吞进上一张表`).toBeLessThan(
        firstTable,
      );
    }
  });
});

describe('config.toml 合并写 — 幂等性（保住内容去重与备份修剪）', () => {
  it('连续两次相同写入，第二次不产生备份也不改文件', async () => {
    const first = await writeCodexConfig({
      model: 'glm-5.3',
      apiKey: 'glm-key',
      provider: 'glm',
    });
    expect(first.configSkipped).toBe(false);

    const second = await writeCodexConfig({
      model: 'glm-5.3',
      apiKey: 'glm-key',
      provider: 'glm',
    });
    expect(second.configSkipped, '合并写必须幂等，否则每次保存都会新增备份').toBe(true);
    expect(second.configBackup).toBeNull();
  });
});

describe('sanitizeManagedConfig 的剥离粒度', () => {
  it('默认（不传）一块都不剥 —— 安全默认，「切换到 OpenAI 官方」走的正是这条', () => {
    const out = sanitizeManagedConfig(REALISTIC_CONFIG);
    expect(out).toContain('[model_providers.deepseek]');
    // 顶层受管键仍然被清掉（这才是「切回官方」的实质）
    // 注意：不能断言 not.toContain('model_provider') —— `[model_providers.mine]` 里含该子串
    expect(out).not.toMatch(/^model_provider\s*=/m);
    expect(out).not.toMatch(/^model\s*=/m);
    // 用户自建段不受影响
    expect(out).toContain('[model_providers.mine]');
    expect(out).toContain('[mcp_servers.node_repl.env]');
  });

  it('传数组时只剥指定的那家，其它受管供应商块保留', () => {
    const out = sanitizeManagedConfig(REALISTIC_CONFIG, {
      stripProviderBlocks: ['deepseek'],
    });
    expect(out).not.toContain('[model_providers.deepseek]');
    // 用户自建段不受影响
    expect(out).toContain('[model_providers.mine]');
  });

  it('剥离粒度为数组时，未出现在数组里的受管供应商块被保留', () => {
    const withBoth = `${REALISTIC_CONFIG}\n[model_providers.ZAI]\nname = "ZAI"\nbase_url = "https://open.bigmodel.cn/api/v1"\n`;
    const out = sanitizeManagedConfig(withBoth, { stripProviderBlocks: ['deepseek'] });
    expect(out).not.toContain('[model_providers.deepseek]');
    expect(out).toContain('[model_providers.ZAI]');
  });
});

/**
 * 与上面「切换供应商」是**同一个根因的第二条入口**：`restoreOriginalConfig()` 原先走
 * `sanitizeManagedConfig` 的默认值 `'all'`，把 `[model_providers.deepseek]` /
 * `[model_providers.ZAI]` 整段删光 → 会话文件里记着这两家的历史对话全部报
 * `Model provider X not found`。
 *
 * 切回官方只需清掉顶层 `model_provider`（BUG-007 的要害）；**未被选中的块是惰性的**，
 * 保留它不影响任何路由，却是历史对话能打开的前提。
 */
describe('restoreOriginalConfig — 切回 OpenAI 官方也要保住历史对话', () => {
  it('两家供应商的块都保留，只清掉顶层受管键', async () => {
    await writeCodexConfig({ model: 'deepseek-flash', apiKey: 'sk-ds', provider: 'deepseek' });
    await writeCodexConfig({ model: 'glm-5.3', apiKey: 'glm-key', provider: 'glm' });

    await restoreOriginalConfig();
    const cfg = await read();

    // ① 真的切回官方了：顶层 model_provider / model 都不在
    expect(cfg).not.toMatch(/^model_provider\s*=/m);
    expect(cfg).not.toMatch(/^model\s*=/m);
    expect(cfg).not.toContain('model_catalog_json');
    expect(cfg).not.toContain('preferred_auth_method');

    // ② 两家供应商的块都还在 —— 历史对话靠它解析
    expect(cfg).toContain('[model_providers.deepseek]');
    expect(cfg).toContain('[model_providers.ZAI]');
  });

  it('用户自有内容逐字保留', async () => {
    await writeCodexConfig({ model: 'glm-5.3', apiKey: 'glm-key', provider: 'glm' });
    await restoreOriginalConfig();
    const cfg = await read();

    expect(cfg).toContain('notify = ["/usr/bin/foo"]');
    expect(cfg).toContain('[desktop]');
    expect(cfg).toContain('[mcp_servers.node_repl]');
    expect(cfg).toContain('[projects."/tmp/x"]');
    expect(cfg).toContain('[model_providers.mine]');
  });

  it('受管 [features] 键仍被清掉，但自定义供应商的块保留', async () => {
    await writeCodexConfig({
      model: 'gpt-5.4',
      apiKey: 'sk-custom',
      provider: 'custom',
      customCodexBaseUrl: 'https://api.example.com/v1',
    });
    await restoreOriginalConfig();
    const cfg = await read();

    expect(cfg).not.toContain('enable_request_compression');
    expect(cfg).not.toContain('remote_compaction_v2');
    // custom 的块保留 —— 当初用 custom 的旧对话同样要能打开
    expect(cfg).toContain('[model_providers.custom]');
  });
});
