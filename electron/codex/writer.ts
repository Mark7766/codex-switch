import fs from 'node:fs/promises';
import path from 'node:path';
import { authJsonPath, backupPath, codexDir, configTomlPath } from './paths';

export interface WriteCodexConfigInput {
  proxyPort: number;
  model: string; // 'deepseek-v4-flash' | 'deepseek-v4-pro'
  apiKey: string;
}

export interface WriteCodexConfigResult {
  configBackup: string | null;
  authBackup: string | null;
  configPath: string;
  authPath: string;
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

export async function writeCodexConfig(
  input: WriteCodexConfigInput,
): Promise<WriteCodexConfigResult> {
  await fs.mkdir(codexDir(), { recursive: true });
  const configPath = configTomlPath();
  const authPath = authJsonPath();

  const configBackup = await backupIfExists(configPath);
  const authBackup = await backupIfExists(authPath);

  await fs.writeFile(configPath, TEMPLATE(input.proxyPort, input.model), 'utf8');
  await fs.writeFile(authPath, AUTH_TEMPLATE(input.apiKey), 'utf8');
  // auth.json 必须 0o600
  try {
    await fs.chmod(authPath, 0o600);
  } catch {
    // Windows 上 chmod 不生效，忽略
  }

  return { configBackup, authBackup, configPath, authPath };
}

export async function restoreCodexConfig(backupPathArg: string): Promise<string> {
  const original = backupPathArg.replace(/\.bak\.\d+$/, '');
  await fs.copyFile(backupPathArg, original);
  return original;
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
