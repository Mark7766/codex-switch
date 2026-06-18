import fs from 'node:fs/promises';
import path from 'node:path';
import { authJsonPath, backupPath, codexDir, configTomlPath } from './paths';

export interface WriteCodexConfigInput {
  proxyPort: number;
  model: string; // 'deepseek-v4-flash' | 'deepseek-v4-pro'
  apiKey: string;
  /** 每个文件保留的最大备份份数。默认 5。 */
  maxBackupsPerFile?: number;
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
}

export interface WriteOpts {
  maxBackupsPerFile?: number;
}

const TEMPLATE = (
  port: number,
  model: string,
): string => `# Codex CLI 配置（由 Codex Switch 自动生成）
# 完整配置参考: https://github.com/openai/codex

model_provider = "custom"
model = "${model}"
model_reasoning_effort = "xhigh"
# v1.5.5: 注释掉 disable_response_storage。
# 该行导致 Codex Desktop 切到客户端压缩模式，
# 压缩阈值从 ~200K token 骤降到 ~10K，正常对话频繁触发 compaction。
# compact 502 的真正修复是 wire_api + requires_openai_auth；此行非必要。
# disable_response_storage = true

# v1.13.0: 与 cc-switch 策略一致 —— 设 1M 窗口避免 Codex 触发 compact。
# compact 端点需要 OpenAI 专有 encrypted_content，DeepSeek 不支持，
# 经非 OpenAI 代理会 404。禁用后 Codex 不再发 compact 请求。
model_context_window = 1000000
model_auto_compact_token_limit = 900000

[model_providers.custom]
name = "Codex Switch"
base_url = "http://127.0.0.1:${port}/v1"
wire_api = "responses"
requires_openai_auth = true

# 如果你使用 DeepSeek 等非 OpenAI 服务，且 Codex 需要执行命令，可按需开启：
# sandbox = "none"
# approval = "auto-edit"

[features]
enable_request_compression = false
remote_compaction_v2 = false
`;

const AUTH_TEMPLATE = (apiKey: string): string =>
  JSON.stringify({ OPENAI_API_KEY: apiKey }, null, 2) + '\n';

async function readFileOrNull(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

async function backupIfExists(filePath: string, suffix?: string): Promise<string | null> {
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }
  const target = suffix ? `${filePath}.bak.${suffix}` : backupPath(filePath);
  await fs.copyFile(filePath, target);
  return target;
}

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

/** v1.13.0: 还原为 OpenAI 官方配置——仅移除 base_url，保留 custom provider 结构。 */
export async function restoreOriginalConfig(): Promise<void> {
  const configPath = configTomlPath();

  // 先备份当前配置
  await backupIfExists(configPath);

  const content = await fs.readFile(configPath, 'utf8');
  const lines = content.split('\n');
  const result: string[] = [];
  let inCustomProvider = false;

  for (const line of lines) {
    // 跳过 model_catalog_json
    if (/^\s*model_catalog_json\s*=/.test(line)) continue;

    // 在 [model_providers.custom] section 内
    if (/^\s*\[model_providers\.custom\]/.test(line)) {
      inCustomProvider = true;
      result.push(line);
      continue;
    }
    if (inCustomProvider) {
      // 遇到新的 section → 退出
      if (/^\s*\[/.test(line) && !line.includes('custom')) {
        inCustomProvider = false;
        result.push(line);
      }
      // 跳过 base_url 行
      else if (/^\s*base_url\s*=/.test(line)) {
        continue;
      }
      // 保留其他行（name, wire_api, requires_openai_auth）
      else {
        result.push(line);
      }
      continue;
    }

    result.push(line);
  }

  await fs.writeFile(configPath, result.join('\n'), 'utf8');
}

/** 列出某文件所有备份（按时间倒序，最新在前）。 */
export async function listBackupsFor(filePath: string): Promise<string[]> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const prefix = `${base}.bak.`;
  return entries
    .filter((n) => n.startsWith(prefix) && !n.endsWith('.install-original'))
    .map((n) => path.join(dir, n))
    .sort()
    .reverse();
}

/** 滚动保留最近 keep 份；超出的删除并返回被删路径。 */
export async function pruneBackups(filePath: string, keep: number): Promise<string[]> {
  if (keep < 0) return [];
  const all = await listBackupsFor(filePath);
  const toDelete = all.slice(keep);
  for (const p of toDelete) {
    try {
      await fs.unlink(p);
    } catch {
      // ignore
    }
  }
  return toDelete;
}

/**
 * 写一个文件 + 备份 + 滚动清理；若内容相同则跳过整个流程。
 * 返回: { backup, skipped, pruned }
 */
async function writeWithBackup(
  filePath: string,
  content: string,
  keep: number,
): Promise<{ backup: string | null; skipped: boolean; pruned: string[] }> {
  const existing = await readFileOrNull(filePath);
  if (existing !== null && existing === content) {
    return { backup: null, skipped: true, pruned: [] };
  }
  const backup = await backupIfExists(filePath);
  await fs.writeFile(filePath, content, 'utf8');
  const pruned = backup ? await pruneBackups(filePath, keep) : [];
  return { backup, skipped: false, pruned };
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

  const cfg = await writeWithBackup(configPath, TEMPLATE(input.proxyPort, input.model), keep);
  const auth = await writeWithBackup(authPath, AUTH_TEMPLATE(input.apiKey), keep);

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
