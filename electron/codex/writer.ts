import fs from 'node:fs/promises';
import path from 'node:path';
import { authJsonPath, codexDir, configTomlPath } from './paths';
import {
  backupIfExists,
  listBackupsFor,
  pruneBackups,
  readFileOrNull,
  writeWithBackup,
} from '../config/file-write';
import { writeModelsJson } from './models-catalog';
import { sanitizeManagedConfig } from './config-restore';
import { getProvider, type ProviderDescriptor, type ProviderId } from '../config/providers';

export interface WriteCodexConfigInput {
  model: string; // 供应商的模型 id，例如 'deepseek-flash' / 'glm-5.3'
  apiKey: string;
  /** 每个文件保留的最大备份份数。默认 5。 */
  maxBackupsPerFile?: number;
  /**
   * v3.0.0: AI 供应商。**所有供应商都是直连**（本地代理已移除），差异全部由
   * `electron/config/providers.ts` 的注册表描述。
   */
  provider?: ProviderId;
  /** v1.16.0: 自定义供应商 Codex Base URL（仅 provider='custom' 时使用）。 */
  customCodexBaseUrl?: string;
}

export interface WriteCodexConfigResult {
  configBackup: string | null;
  authBackup: string | null;
  configPath: string;
  authPath: string;
  /** true 表示内容未变化，已跳过备份+写入；false 表示已实际写入。 */
  configSkipped: boolean;
  authSkipped: boolean;
  /** 本次写入新备份后被滚动删除的旧备份路径列表。 */
  prunedBackups: string[];
  /** v2.0.0: deepseek 直连时写入的 models.json 备份路径（非 deepseek 为 null）。 */
  modelsBackup: string | null;
  /** v2.0.0: models.json 是否因内容相同而跳过写入。 */
  modelsSkipped: boolean;
}

/**
 * 生成 config.toml（v3.0.0）。
 *
 * 原先 deepseek / custom / 代理 各有硬编码模板，此处收敛为**一个由注册表驱动的**构造器——
 * 各家的差异（providerId、端点、推理强度、鉴权方式、是否写上下文窗口与 feature 开关）
 * 全部来自 `ProviderDescriptor`。新增供应商不再需要动这个文件。
 *
 * `baseUrl` 一律逐字节写入：DeepSeek 的 `https://api.deepseek.com/`（带尾斜杠）和
 * GLM 的 `https://open.bigmodel.cn/api/v1` 都是端点的一部分，不能做任何「规范化」。
 */
/**
 * 生成 config.toml 中**受管的三段内容**（可组合，供合并写使用）。
 *
 * 拆成三段是因为 TOML 对顺序有硬要求：表头之后的裸键属于那张表。合并写时必须让
 * 「所有顶层键」排在「所有表」之前，所以顶层键与表不能混在一个字符串里拼。
 */
function managedTopKeys(provider: ProviderDescriptor, model: string): string[] {
  const c = provider.codex;
  const lines: string[] = [`model = "${model}"`, `model_provider = "${c.providerId}"`];
  if (c.preferredAuthMethod) lines.push(`preferred_auth_method = "${c.preferredAuthMethod}"`);
  if (c.forcedLoginMethod) lines.push(`forced_login_method = "${c.forcedLoginMethod}"`);
  lines.push(`model_reasoning_effort = "${c.reasoningEffort}"`);
  if (c.catalogAsset) lines.push(`model_catalog_json = "~/.codex/models.json"`);
  if (c.contextWindowOverrides) {
    // 与 cc-switch 策略一致：设 1M 窗口避免 Codex 触发 compact。compact 端点需要 OpenAI
    // 专有 encrypted_content，非 OpenAI 服务不支持，会 404。
    lines.push(`model_context_window = 1000000`);
    lines.push(`model_auto_compact_token_limit = 900000`);
  }
  return lines;
}

/** 当前供应商的 `[model_providers.X]` 段。 */
function providerBlock(
  provider: ProviderDescriptor,
  apiKey: string,
  customBaseUrl: string,
): string[] {
  const c = provider.codex;
  const baseUrl = c.baseUrl === 'custom' ? customBaseUrl : c.baseUrl;
  const lines = [
    `[model_providers.${c.providerId}]`,
    `name = "${c.name}"`,
    `base_url = "${baseUrl}"`,
    `wire_api = "responses"`,
  ];
  if (c.bearerTokenInToml) lines.push(`experimental_bearer_token = "${apiKey}"`);
  if (c.requiresOpenAiAuth) lines.push(`requires_openai_auth = true`);
  return lines;
}

/** 需要时输出 `[features]` 段（目前只有自定义供应商需要）。 */
function featuresBlock(provider: ProviderDescriptor): string[] {
  if (!provider.codex.featureFlags) return [];
  return ['[features]', 'enable_request_compression = false', 'remote_compaction_v2 = false'];
}

/**
 * 把「保留内容」+「本次要写的受管内容」组装成完整的 config.toml。
 *
 * 顺序（TOML 硬要求，别调）：
 *   1. 我们的顶层键
 *   2. 保留内容里的**顶层键**（如用户的 `notify = [...]`）
 *   3. 保留内容里的**所有表**（`[desktop]` / `[mcp_servers.*]` / 其它供应商的块 …）
 *   4. 当前供应商的块（放最后 = 取代第 3 步里被剥掉的那份）
 *   5. `[features]`（如需要）
 *
 * 1 与 2 必须排在 3 之前，否则会被 TOML 当成上一张表里的键。
 */
function composeCodexToml(
  preserved: string,
  provider: ProviderDescriptor,
  model: string,
  apiKey: string,
  customBaseUrl: string,
): string {
  const lines = preserved.split('\n');
  const firstTable = lines.findIndex((l) => /^\s*\[[^\]\n]+\]/.test(l));
  const headKeys = (firstTable === -1 ? preserved : lines.slice(0, firstTable).join('\n')).trim();
  const tables = (firstTable === -1 ? '' : lines.slice(firstTable).join('\n')).trim();

  // 按「块」拼接：块与块之间空一行，块内的行用换行 —— 别再往每个键之间塞空行
  const blocks = [
    `# Codex CLI 配置（由 Codex Switch 自动生成 · ${provider.label} 直连）`,
    managedTopKeys(provider, model).join('\n'),
    headKeys,
    tables,
    providerBlock(provider, apiKey, customBaseUrl).join('\n'),
    featuresBlock(provider).join('\n'),
  ];
  return blocks.filter((b) => b.trim() !== '').join('\n\n') + '\n';
}

const AUTH_TEMPLATE = (apiKey: string): string =>
  JSON.stringify({ OPENAI_API_KEY: apiKey }, null, 2) + '\n';

/** v1.9.0: 首次安装时保存原始配置，标记为 install-original，永久保留。 */
export async function backupOriginalIfMissing(): Promise<void> {
  const configPath = configTomlPath();
  const authPath = authJsonPath();
  const configBak = `${configPath}.bak.install-original`;
  const authBak = `${authPath}.bak.install-original`;
  try {
    await fs.access(configBak);
  } catch {
    await backupIfExists(configPath, 'install-original');
  }
  try {
    await fs.access(authBak);
  } catch {
    await backupIfExists(authPath, 'install-original');
  }
}

/** v1.9.0: 检查是否存在首次安装时的原始配置备份。 */
export async function hasOriginalBackup(): Promise<boolean> {
  try {
    await fs.access(`${configTomlPath()}.bak.install-original`);
    return true;
  } catch {
    return false;
  }
}

/**
 * 还原为 OpenAI 官方配置——让 Codex 回落到内置的 `openai`。
 *
 * 做法：清掉顶层受管键（`model` / `model_provider` / `model_reasoning_effort` /
 * `model_catalog_json` / 上下文窗口 / 鉴权方式）与 `[features]` 受管键。
 * v2.3.0 的 BUG-007（切回官方后 Codex 仍连着 DeepSeek，报 `but you passed gpt-6-astra`）
 * 就是**顶层 `model_provider` 残留**造成的——清掉它就已经切回官方了。
 *
 * ⚠️ **`[model_providers.*]` 块一律保留，不传 `stripProviderBlocks`。** 删块是多余的
 * （未被选中的块是惰性的），也是**有害的**——Codex 按对话记住 `model_provider`，
 * 删掉某家的块会让那家的历史对话报 `Model provider X not found`。详见 ADR-034 / ADR-036。
 */
export async function restoreOriginalConfig(): Promise<void> {
  const configPath = configTomlPath();
  // 先备份当前配置再改写
  await backupIfExists(configPath);
  const content = await fs.readFile(configPath, 'utf8');
  await fs.writeFile(configPath, sanitizeManagedConfig(content), 'utf8');
}

export async function writeCodexConfig(
  input: WriteCodexConfigInput,
): Promise<WriteCodexConfigResult> {
  await fs.mkdir(codexDir(), { recursive: true });
  // v1.9.0: 首次写入前备份原始配置（标记为 install-original）
  await backupOriginalIfMissing();
  const configPath = configTomlPath();
  const authPath = authJsonPath();
  const keep = Math.max(0, input.maxBackupsPerFile ?? 5);

  // v3.0.0: 所有供应商都是直连，模板由注册表描述驱动
  const provider = getProvider(input.provider);
  // v3.0.0: **合并写**，不再整份覆盖。读出现有配置，只剥掉「我们的顶层键 + 当前供应商的块 +
  // [features] 受管键」，其余一律原样保留。两个原因：
  //   1. **Codex 按对话记住 model_provider**（会话文件 payload.model_provider）。若把上一家
  //      的块删掉，那些历史对话再打开就报 `Model provider <旧供应商> not found`。
  //   2. 整份覆盖会连用户/Codex 自己写的段（notify / [desktop] / [mcp_servers.*] /
  //      [projects.*] / 自建 [model_providers.foo]）一起抹掉 —— 此前只是靠 Codex 自己重写
  //      才没出事。详见 ADR-034。
  const existing = await readFileOrNull(configPath);
  const preserved = existing
    ? sanitizeManagedConfig(existing, { stripProviderBlocks: [provider.codex.providerId] })
    : '';
  const configContent = composeCodexToml(
    preserved,
    provider,
    input.model,
    input.apiKey,
    input.customCodexBaseUrl ?? '',
  );
  const cfg = await writeWithBackup(configPath, configContent, keep);
  const auth = await writeWithBackup(authPath, AUTH_TEMPLATE(input.apiKey), keep);

  // v3.0.0: 声明了模型目录资产的供应商需合并写入 ~/.codex/models.json
  const models = provider.codex.catalogAsset
    ? await writeModelsJson(provider.codex.catalogAsset)
    : null;

  // auth.json 必须 0o600
  try {
    await fs.chmod(authPath, 0o600);
  } catch {
    // Windows 上 chmod 不生效，忽略
  }

  return {
    configBackup: cfg.backup,
    authBackup: auth.backup,
    configPath,
    authPath,
    configSkipped: cfg.skipped,
    authSkipped: auth.skipped,
    prunedBackups: [...cfg.pruned, ...auth.pruned],
    modelsBackup: models?.backup ?? null,
    modelsSkipped: models?.skipped ?? false,
  };
}

export async function restoreCodexConfig(backupPathArg: string): Promise<string> {
  // H1: path traversal prevention — validate backup is within codexDir
  const resolvedBackup = path.resolve(backupPathArg);
  const allowedDir = path.resolve(codexDir()) + path.sep;
  if (!resolvedBackup.startsWith(allowedDir)) {
    throw new Error(`拒绝访问 codex 目录外的备份文件：${backupPathArg}`);
  }
  if (!/\.bak\.\d+$/.test(backupPathArg)) {
    throw new Error('非法的备份文件名格式');
  }
  const original = path.resolve(backupPathArg.replace(/\.bak\.\d+$/, ''));
  if (!original.startsWith(allowedDir)) {
    throw new Error('拒绝还原到 codex 目录外的文件');
  }
  await backupIfExists(original);
  await fs.copyFile(backupPathArg, original);
  if (path.basename(original) === 'auth.json') {
    try {
      await fs.chmod(original, 0o600);
    } catch {
      // ignore
    }
  }
  return original;
}

// v3.0.0: 抽到 config/file-write.ts 后在此转发，保持对外 API 不变（测试与 main.ts 直接引用）
export { listBackupsFor, pruneBackups };

export async function deleteBackup(backupPathArg: string): Promise<void> {
  // H1: path traversal prevention
  const resolvedPath = path.resolve(backupPathArg);
  const allowedDir = path.resolve(codexDir()) + path.sep;
  if (!resolvedPath.startsWith(allowedDir)) {
    throw new Error(`拒绝删除 codex 目录外的文件：${backupPathArg}`);
  }
  if (!/\.bak\.\d+$/.test(backupPathArg)) {
    throw new Error('非法的备份文件名格式');
  }
  await fs.unlink(backupPathArg);
}

export async function cleanAllBackups(): Promise<string[]> {
  const dir = codexDir();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const n of entries) {
    if (/\.bak\.\d+$/.test(n) && !n.endsWith('.install-original')) {
      const full = path.join(dir, n);
      try {
        await fs.unlink(full);
        removed.push(full);
      } catch {
        // ignore
      }
    }
  }
  return removed;
}

export async function listBackups(): Promise<{ config: string[]; auth: string[] }> {
  const dir = codexDir();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { config: [], auth: [] };
  }
  const config = entries
    .filter((n) => n.startsWith('config.toml.bak.') && !n.endsWith('.install-original'))
    .map((n) => path.join(dir, n))
    .sort()
    .reverse();
  const auth = entries
    .filter((n) => n.startsWith('auth.json.bak.') && !n.endsWith('.install-original'))
    .map((n) => path.join(dir, n))
    .sort()
    .reverse();
  return { config, auth };
}
