import fs from 'node:fs/promises';
import path from 'node:path';
import { backupPath, codexDir } from './paths';

/** v2.0.0: DeepSeek 官方模型目录文件（models.json）的目标路径。 */
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
 * 读取打包内附带的 DeepSeek 官方模型目录资产 deepseek-models.json。
 * 候选路径：packaged（resources/electron/codex）→ dev cwd → dev __dirname。
 */
export async function readModelsJsonAsset(): Promise<string> {
  const candidates: string[] = [];
  // packaged（Electron 设置 process.resourcesPath）；dev/test 下可能未定义
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'electron', 'codex', 'deepseek-models.json'));
  }
  candidates.push(path.join(process.cwd(), 'electron', 'codex', 'deepseek-models.json'));
  if (typeof __dirname === 'string') {
    candidates.push(path.join(__dirname, 'deepseek-models.json'));
  }
  for (const p of candidates) {
    try {
      return await fs.readFile(p, 'utf8');
    } catch {
      /* try next */
    }
  }
  throw new Error('未找到 DeepSeek 模型目录资产 deepseek-models.json');
}

/**
 * 将官方 models.json 写入 ~/.codex/models.json（内容相同则跳过）。
 * 资产是静态不变的，因此首次写入后通常不再产生备份。
 */
export async function writeModelsJson(): Promise<{ backup: string | null; skipped: boolean }> {
  const target = modelsJsonPath();
  const content = await readModelsJsonAsset();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const existing = await readFileOrNull(target);
  if (existing !== null && existing === content) {
    return { backup: null, skipped: true };
  }
  const backup = await backupIfExists(target);
  await fs.writeFile(target, content, 'utf8');
  return { backup, skipped: false };
}
