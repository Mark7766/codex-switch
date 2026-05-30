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

const TEMPLATE = (port: number, model: string): string => `# Codex CLI 配置（由 Codex Switch 自动生成）
# 完整配置参考: https://github.com/openai/codex

model = "${model}"
openai_base_url = "http://127.0.0.1:${port}/v1"

# 如果你使用 DeepSeek 等非 OpenAI 服务，且 Codex 需要执行命令，可按需开启：
# sandbox = "none"
# approval = "auto-edit"
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

async function backupIfExists(filePath: string): Promise<string | null> {
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }
  const target = backupPath(filePath);
  await fs.copyFile(filePath, target);
  return target;
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
    .filter((n) => n.startsWith(prefix))
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
  const original = backupPathArg.replace(/\.bak\.\d+$/, '');
  // 还原前再备份当前文件，防误操作
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
  if (!/\.bak\.\d+$/.test(backupPathArg)) {
    throw new Error('refuse to delete non-backup file');
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
    if (/\.bak\.\d+$/.test(n)) {
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
    .filter((n) => n.startsWith('config.toml.bak.'))
    .map((n) => path.join(dir, n))
    .sort()
    .reverse();
  const auth = entries
    .filter((n) => n.startsWith('auth.json.bak.'))
    .map((n) => path.join(dir, n))
    .sort()
    .reverse();
  return { config, auth };
}
