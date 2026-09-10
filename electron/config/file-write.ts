/**
 * 带备份的安全文件写入（v3.0.0 从 `electron/codex/writer.ts` 抽出，Codex / Claude 两侧共用）。
 *
 * **为什么必须共用**：Codex 侧一直有这两条不变量 —— ① 内容相同则既不备份也不写；
 * ② 备份按份数滚动修剪。而 Claude 侧的两条写入路径都没有，偏偏 `startupApplyClaude()`
 * 每次启动都会重写配置 —— 结果用户家目录里堆积了数百份 `~/.zshrc.bak.<ts>`
 * （实测 415 份 / 1.66 MB / 跨三个多月）。把不变量收敛到一处，避免再次漂移。
 *
 * ⚠️ 任何绕过本模块直接 `fs.writeFile` 写用户配置文件的代码，都是在重新引入这个缺陷。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/** 备份文件名：`<原文件>.bak.<unix-ms>`。 */
export function backupPath(originalPath: string): string {
  return `${originalPath}.bak.${Date.now()}`;
}

/** 读文件；不存在或不可读返回 null（调用方据此判断「是新建」）。 */
export async function readFileOrNull(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 列出某个文件的全部备份，按**新 → 旧**排序。
 *
 * 依赖文件名里的 unix-ms 时间戳做字典序排序（13 位数字，字典序即时间序）。
 * `.install-original` 后缀是 Codex 侧的「首次安装前原始副本」，不算滚动备份。
 */
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

/** 只保留最新 `keep` 份备份，返回被删掉的路径。`keep < 0` 表示不修剪。 */
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

/** 把现有文件复制成一份带时间戳的备份；文件不存在则返回 null。 */
export async function backupIfExists(filePath: string, suffix?: string): Promise<string | null> {
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }
  const target = suffix ? `${filePath}.bak.${suffix}` : backupPath(filePath);
  await fs.copyFile(filePath, target);
  return target;
}

export interface WriteResult {
  /** 本次新建的备份路径；内容未变或原本不存在时为 null。 */
  backup: string | null;
  /** true = 内容与磁盘一致，已跳过备份与写入。 */
  skipped: boolean;
  /** 本次因滚动修剪而删除的旧备份。 */
  pruned: string[];
}

/**
 * 写入 `filePath`，写入前备份、写入后修剪。
 *
 * - 内容与磁盘完全一致 → **不备份也不写**（这是防备份堆积的关键）
 * - 是否已存在直接取自上面那次读取，**不再额外探测**（少一次 fs 调用，也让「有没有旧内容」
 *   这件事只有一个来源）
 * - `mode` 用于需要 0600 的文件（Claude 的 settings.json / profile 含 API Key）
 */
export async function writeWithBackup(
  filePath: string,
  content: string,
  keep: number,
  opts: { mode?: number } = {},
): Promise<WriteResult> {
  const existing = await readFileOrNull(filePath);
  if (existing !== null && existing === content) {
    return { backup: null, skipped: true, pruned: [] };
  }
  let backup: string | null = null;
  if (existing !== null) {
    backup = backupPath(filePath);
    try {
      await fs.copyFile(filePath, backup);
    } catch {
      backup = null;
    }
  }
  await fs.writeFile(filePath, content, opts.mode ? { encoding: 'utf8', mode: opts.mode } : 'utf8');
  const pruned = backup ? await pruneBackups(filePath, keep) : [];
  return { backup, skipped: false, pruned };
}

/** 写入 JSON 对象（2 空格缩进 + 末尾换行），同样带去重与备份修剪。 */
export async function writeJsonWithBackup(
  filePath: string,
  obj: unknown,
  keep: number,
  opts: { mode?: number } = {},
): Promise<WriteResult> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  return writeWithBackup(filePath, JSON.stringify(obj, null, 2) + '\n', keep, opts);
}
