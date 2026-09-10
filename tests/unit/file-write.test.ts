import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  listBackupsFor,
  pruneBackups,
  writeJsonWithBackup,
  writeWithBackup,
} from '../../electron/config/file-write';

/** Windows 没有 POSIX 权限位，Node 会把 `st.mode` 合成为 0o666 —— 见下方「权限」用例。 */
const isWindows = process.platform === 'win32';

let dir = '';
let target = '';

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-filewrite-'));
  target = path.join(dir, 'config.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/**
 * v3.0.0 回归：这两个不变量原本只有 Codex 侧有，而 Claude 侧没有 —— 偏偏 Claude 配置
 * 每次启动都会重写，于是用户家目录里堆积了数百份 `~/.zshrc.bak.<ts>`
 * （实测 415 份 / 1.66 MB / 跨三个多月）。这组测试把不变量钉死。
 */
describe('writeWithBackup — 内容去重（防备份堆积的关键）', () => {
  it('内容与磁盘一致时既不备份也不写', async () => {
    const first = await writeWithBackup(target, 'hello\n', 5);
    expect(first.skipped).toBe(false);
    expect(first.backup).toBeNull(); // 首次写入时文件不存在，没有可备份的旧内容

    const second = await writeWithBackup(target, 'hello\n', 5);
    expect(second.skipped).toBe(true);
    expect(second.backup).toBeNull();
    expect(await listBackupsFor(target)).toHaveLength(0);
  });

  it('内容变化时备份并写入', async () => {
    await writeWithBackup(target, 'v1\n', 5);
    const r = await writeWithBackup(target, 'v2\n', 5);
    expect(r.skipped).toBe(false);
    expect(r.backup).not.toBeNull();
    expect(await fs.readFile(target, 'utf8')).toBe('v2\n');
    expect(await listBackupsFor(target)).toHaveLength(1);
  });

  it('反复写入相同内容不会新增任何备份（回归：此前每次调用都新增一份）', async () => {
    await writeWithBackup(target, 'same\n', 5);
    for (let i = 0; i < 10; i += 1) await writeWithBackup(target, 'same\n', 5);
    expect(await listBackupsFor(target)).toHaveLength(0);
  });
});

describe('writeWithBackup — 备份滚动修剪', () => {
  it('备份数量不超过上限', async () => {
    for (let i = 1; i <= 8; i += 1) {
      await writeWithBackup(target, `v${i}\n`, 3);
    }
    expect(await listBackupsFor(target)).toHaveLength(3);
  });

  it('修剪保留的是最新的几份', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await writeWithBackup(target, `v${i}\n`, 2);
      await new Promise((r) => setTimeout(r, 2)); // 时间戳需要不同
    }
    const backups = await listBackupsFor(target);
    expect(backups).toHaveLength(2);
    // 最新那份备份应保存的是倒数第二次的内容（v4）
    expect(await fs.readFile(backups[0]!, 'utf8')).toBe('v4\n');
  });

  it('keep < 0 表示不修剪', async () => {
    // 备份文件名用 Date.now() 时间戳，同毫秒内会互相覆盖，故错开
    for (let i = 1; i <= 4; i += 1) {
      await writeWithBackup(target, `v${i}\n`, -1);
      await new Promise((r) => setTimeout(r, 2));
    }
    await expect(listBackupsFor(target)).resolves.toHaveLength(3);
  });
});

/**
 * Windows 上没有 POSIX 权限位：`fs.stat().mode` 是 Node 合成的 `0o666`，`chmod` 也只对
 * 「只读位」有意义。生产代码在 Windows 上同样是尽力而为（`writer.ts` 的 chmod 外包了
 * try/catch），因此这条不变量只在 POSIX 上成立、也只在该平台断言。
 * **跳过而不是放宽断言** —— 放宽后「除属主外无权限」这条真正的护栏就名存实亡了。
 */
describe('writeWithBackup — 权限', () => {
  it.skipIf(isWindows)('按 opts.mode 写盘（Claude 侧含 Key 的文件需要 0600）', async () => {
    await writeWithBackup(target, '{}\n', 5, { mode: 0o600 });
    const st = await fs.stat(target);
    // 与 umask 无关地断言「除属主外无权限」
    expect(st.mode & 0o077).toBe(0);
  });
});

describe('writeJsonWithBackup', () => {
  it('以 2 空格缩进 + 末尾换行写入，且同样去重', async () => {
    const obj = { a: 1, b: [2, 3] };
    await writeJsonWithBackup(target, obj, 5);
    expect(await fs.readFile(target, 'utf8')).toBe(JSON.stringify(obj, null, 2) + '\n');

    const again = await writeJsonWithBackup(target, obj, 5);
    expect(again.skipped).toBe(true);
  });

  it('会创建缺失的父目录', async () => {
    const nested = path.join(dir, 'a', 'b', 'c.json');
    await writeJsonWithBackup(nested, { x: 1 }, 5);
    await expect(fs.access(nested)).resolves.toBeUndefined();
  });
});

describe('pruneBackups', () => {
  it('文件不存在时安全返回空数组', async () => {
    await expect(pruneBackups(path.join(dir, 'nope.txt'), 3)).resolves.toEqual([]);
  });
});
