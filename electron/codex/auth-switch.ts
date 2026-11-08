import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { backupIfExists } from '../config/file-write';

interface AuthSession {
  managedHash: string;
  previous: string | null;
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const sessionPath = (authPath: string): string => `${authPath}.codex-switch-session`;

async function readOptional(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function readSession(authPath: string): Promise<AuthSession | null> {
  const raw = await readOptional(sessionPath(authPath));
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') throw new Error();
    const obj = value as Record<string, unknown>;
    if (typeof obj.managedHash !== 'string') throw new Error();
    if (typeof obj.previous !== 'string' && obj.previous !== null) throw new Error();
    return { managedHash: obj.managedHash, previous: obj.previous };
  } catch {
    throw new Error('无法读取保存的 Codex 登录状态，请检查配置目录');
  }
}

/** Remember the credential replaced by our provider key, across repeated provider switches. */
export async function rememberAuth(authPath: string, next: string): Promise<void> {
  const current = await readOptional(authPath);
  const session = await readSession(authPath);
  const previous =
    current !== null && session && hash(current) === session.managedHash
      ? session.previous
      : !session && current === next
        ? null
        : current;
  await fs.writeFile(sessionPath(authPath), JSON.stringify({ managedHash: hash(next), previous }), {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.chmod(sessionPath(authPath), 0o600).catch(() => {});
}

function isLegacyManagedAuth(current: string, keys: string[]): boolean {
  try {
    const value: unknown = JSON.parse(current);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>;
    return (
      Object.keys(obj).length === 1 &&
      typeof obj.OPENAI_API_KEY === 'string' &&
      keys.some((key) => key.length > 0 && key === obj.OPENAI_API_KEY)
    );
  } catch {
    return false;
  }
}

/** Restore only credentials we can prove were replaced by this app. */
export async function restoreAuth(authPath: string, legacyKeys: string[]): Promise<void> {
  const current = await readOptional(authPath);
  const session = await readSession(authPath);
  const managed = current !== null && session !== null && hash(current) === session.managedHash;
  const legacy = current !== null && !session && isLegacyManagedAuth(current, legacyKeys);
  if (managed || legacy) {
    await backupIfExists(authPath);
    if (managed && session.previous !== null) {
      await fs.writeFile(authPath, session.previous, { encoding: 'utf8', mode: 0o600 });
      await fs.chmod(authPath, 0o600).catch(() => {});
    } else {
      await fs.unlink(authPath);
    }
  }
  if (session) await fs.unlink(sessionPath(authPath));
}
