import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:child_process before importing portInfo
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// Capture the mocked execFile so we can program responses per test.
import { execFile as _execFile } from 'node:child_process';
const execFileMock = _execFile as unknown as ReturnType<typeof vi.fn>;

/**
 * portInfo 内部用 promisify(execFile)，promisify 调 execFile(args..., callback)。
 * 用一个工厂函数把 stdout/error 包成回调风格，注入到 mock 里。
 */
function programNext(stdout: string | null, errMsg?: string): void {
  execFileMock.mockImplementationOnce(((..._args: unknown[]) => {
    const cb = _args[_args.length - 1] as (
      err: Error | null,
      out?: { stdout: string },
    ) => void;
    if (errMsg) cb(new Error(errMsg));
    else cb(null, { stdout: stdout ?? '' });
  }) as unknown as typeof _execFile);
}

describe('portInfo.lookupPortHolder', () => {
  const origPlatform = process.platform;

  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform });
  });

  it('parses lsof -Fpcun output on darwin', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    programNext('p4242\ncnode\nuusername\n');
    const { lookupPortHolder } = await import('../../electron/proxy/portInfo');
    const r = await lookupPortHolder(11435);
    expect(r).toEqual({ pid: 4242, command: 'node', user: 'username' });
  });

  it('returns null when lsof outputs empty', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    programNext('');
    const { lookupPortHolder } = await import('../../electron/proxy/portInfo');
    const r = await lookupPortHolder(11435);
    expect(r).toBeNull();
  });

  it('returns null when lsof fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    programNext(null, 'lsof not found');
    const { lookupPortHolder } = await import('../../electron/proxy/portInfo');
    const r = await lookupPortHolder(99999);
    expect(r).toBeNull();
  });

  it('parses netstat + tasklist on win32', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const netstatOut =
      '\r\n  TCP    127.0.0.1:11435    0.0.0.0:0    LISTENING       9999\r\n';
    programNext(netstatOut); // netstat
    programNext('"node.exe","9999","Console","1","12,345 K"\r\n'); // tasklist
    const { lookupPortHolder } = await import('../../electron/proxy/portInfo');
    const r = await lookupPortHolder(11435);
    expect(r).toEqual({ pid: 9999, command: 'node.exe' });
  });
});

describe('portInfo.killPid', () => {
  it('refuses pid <= 1', async () => {
    const { killPid } = await import('../../electron/proxy/portInfo');
    expect((await killPid(0)).ok).toBe(false);
    expect((await killPid(1)).ok).toBe(false);
    expect((await killPid(-1)).ok).toBe(false);
  });

  it('refuses self pid', async () => {
    const { killPid } = await import('../../electron/proxy/portInfo');
    const r = await killPid(process.pid);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/自身/);
  });

  it('refuses system blacklist', async () => {
    const { killPid } = await import('../../electron/proxy/portInfo');
    const r = await killPid(99, 'launchd');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/launchd/);
  });
});
