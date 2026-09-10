import fs from 'node:fs/promises';
import path from 'node:path';
import { backupPath, codexDir } from './paths';
import { PROVIDER_LIST } from '../config/providers';

/** v2.0.0: Codex 模型目录文件（models.json）的目标路径。 */
export function modelsJsonPath(): string {
  return path.join(codexDir(), 'models.json');
}

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

/**
 * 读取打包内附带的模型目录资产（如 deepseek-models.json / glm-models.json）。
 * 候选路径：packaged（resources/electron/codex）→ dev cwd → dev __dirname。
 */
export async function readModelsJsonAsset(asset: string): Promise<string> {
  const candidates: string[] = [];
  // packaged（Electron 设置 process.resourcesPath）；dev/test 下可能未定义
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'electron', 'codex', asset));
  }
  candidates.push(path.join(process.cwd(), 'electron', 'codex', asset));
  if (typeof __dirname === 'string') {
    candidates.push(path.join(__dirname, asset));
  }
  for (const p of candidates) {
    try {
      return await fs.readFile(p, 'utf8');
    } catch {
      /* try next */
    }
  }
  throw new Error(`未找到模型目录资产 ${asset}`);
}

/** 解析资产里的 slug 列表。 */
async function assetSlugs(asset: string): Promise<string[]> {
  const parsed = JSON.parse(await readModelsJsonAsset(asset)) as {
    models?: Array<{ slug?: string }>;
  };
  return (parsed.models ?? []).map((m) => m.slug).filter((s): s is string => Boolean(s));
}

/**
 * 收集**所有**受管供应商目录里声明过的 slug。
 *
 * 用途：写目录时先把这些 slug 从现有文件里摘掉，再写入当前供应商的条目。否则切换供应商
 * 后旧条目会残留（Codex 找不到当前模型），或反向把当前条目覆盖掉。
 */
async function managedSlugs(): Promise<Set<string>> {
  const slugs = new Set<string>();
  for (const d of PROVIDER_LIST) {
    if (!d.codex.catalogAsset) continue;
    try {
      for (const s of await assetSlugs(d.codex.catalogAsset)) slugs.add(s);
    } catch {
      /* 资产缺失时跳过——不能因为另一个供应商的资产读不到就让本次写入失败 */
    }
  }
  return slugs;
}

/**
 * 把某供应商的模型目录写入 `~/.codex/models.json`（内容相同则跳过）。
 *
 * ⚠️ v3.0.0 起这是**合并写**，不是覆盖写：DeepSeek 与 GLM 的 `model_catalog_json` 都指向
 * 这同一个文件，直接覆盖会让另一家的条目消失。规则：
 *   1. 剔除所有受管 slug（保留用户自己加的条目，逐字节不动）
 *   2. 追加当前供应商的条目
 *   3. 用户没有自加条目时，直接逐字节照抄资产（保证与官方文件完全一致）
 */
export async function writeModelsJson(
  asset: string,
): Promise<{ backup: string | null; skipped: boolean }> {
  const target = modelsJsonPath();
  const incoming = JSON.parse(await readModelsJsonAsset(asset)) as { models?: unknown[] };
  await fs.mkdir(path.dirname(target), { recursive: true });

  const existing = await readFileOrNull(target);
  let userModels: unknown[] = [];
  if (existing !== null) {
    try {
      const parsed = JSON.parse(existing) as { models?: Array<{ slug?: string }> };
      const managed = await managedSlugs();
      userModels = (parsed.models ?? []).filter((m) => !m?.slug || !managed.has(m.slug));
    } catch {
      /* 现有文件损坏 → 视为无用户条目，本次整体重写（旧文件仍会备份） */
      userModels = [];
    }
  }

  const content =
    userModels.length === 0
      ? await readModelsJsonAsset(asset)
      : JSON.stringify({ models: [...userModels, ...(incoming.models ?? [])] }, null, 2) + '\n';

  if (existing !== null && existing === content) {
    return { backup: null, skipped: true };
  }
  const backup = await backupIfExists(target);
  await fs.writeFile(target, content, 'utf8');
  return { backup, skipped: false };
}
