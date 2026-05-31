import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface PortHolder {
  pid: number;
  command: string;
  /** 仅 darwin/linux 可读到。 */
  user?: string;
}

const SYSTEM_BLACKLIST = new Set([
  'launchd',
  'kernel_task',
  'systemd',
  'init',
  'WindowServer',
  'svchost.exe',
  'System',
  'wininit.exe',
  'csrss.exe',
  'lsass.exe',
  'services.exe',
]);

/** 查询占用 127.0.0.1:port 的进程；返回 null 表示无进程或查询失败。 */
export async function lookupPortHolder(port: number): Promise<PortHolder | null> {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    return lookupUnix(port);
  }
  if (process.platform === 'win32') {
    return lookupWin(port);
  }
  return null;
}

async function lookupUnix(port: number): Promise<PortHolder | null> {
  try {
    const { stdout } = await exec('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-Fpcun']);
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    let pid = 0;
    let command = '';
    let user = '';
    for (const ln of lines) {
      const k = ln[0];
      const rest = ln.slice(1);
      if (k === 'p') pid = parseInt(rest, 10);
      else if (k === 'c') command = rest;
      else if (k === 'u') user = rest;
    }
    if (!pid) return null;
    return { pid, command, user };
  } catch {
    return null;
  }
}

async function lookupWin(port: number): Promise<PortHolder | null> {
  try {
    const { stdout } = await exec('netstat', ['-ano', '-p', 'TCP']);
    const lines = stdout.split(/\r?\n/);
    const re = new RegExp(`\\s127\\.0\\.0\\.1:${port}\\s.*LISTENING\\s+(\\d+)`);
    for (const ln of lines) {
      const m = re.exec(ln);
      if (m) {
        const pid = parseInt(m[1]!, 10);
        const command = await tasklistCommand(pid).catch(() => '');
        return { pid, command };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function tasklistCommand(pid: number): Promise<string> {
  const { stdout } = await exec('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
  const m = /^"([^"]+)"/.exec(stdout.trim());
  return m ? m[1]! : '';
}

export interface KillOutcome {
  ok: boolean;
  message: string;
}

/** 终止指定 PID。先 SIGTERM，5s 后仍存活则 SIGKILL（Windows 直接 taskkill /F）。 */
export async function killPid(pid: number, expectedCommand?: string): Promise<KillOutcome> {
  if (!Number.isInteger(pid) || pid <= 1) {
    return { ok: false, message: `非法的 PID：${pid}` };
  }
  if (pid === process.pid) {
    return { ok: false, message: '拒绝结束当前应用自身' };
  }
  // 黑名单防误杀关键系统进程
  if (expectedCommand && SYSTEM_BLACKLIST.has(expectedCommand)) {
    return { ok: false, message: `拒绝结束系统进程 ${expectedCommand}` };
  }
  if (process.platform === 'win32') {
    try {
      await exec('taskkill', ['/PID', String(pid), '/F']);
      return { ok: true, message: `已结束进程 ${pid}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }
  // POSIX: SIGTERM → 等待 5s → SIGKILL
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  for (let i = 0; i < 25; i += 1) {
    await sleep(200);
    if (!isAlive(pid)) return { ok: true, message: `已结束进程 ${pid}` };
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* maybe already exited */
  }
  await sleep(200);
  if (isAlive(pid)) {
    return { ok: false, message: `无法结束进程 ${pid}（权限不足？）` };
  }
  return { ok: true, message: `已强制结束进程 ${pid}` };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
