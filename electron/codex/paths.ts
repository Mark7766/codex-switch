import os from 'node:os';
import path from 'node:path';

export function codexDir(): string {
  return path.join(os.homedir(), '.codex');
}

export function configTomlPath(): string {
  return path.join(codexDir(), 'config.toml');
}

export function authJsonPath(): string {
  return path.join(codexDir(), 'auth.json');
}

export function backupPath(originalPath: string): string {
  return `${originalPath}.bak.${Date.now()}`;
}
