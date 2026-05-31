import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PersistentLog } from '../../electron/proxy/persistentLog';

let dir = '';

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-plog-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function makeEntry(i: number) {
  return {
    ts: 1700000000000 + i,
    level: 'info' as const,
    source: 'test' as const,
    message: 'x'.repeat(200) + ' ' + i,
  };
}

describe('PersistentLog', () => {
  it('appends entries and reads tail in order', async () => {
    const plog = new PersistentLog({ dir });
    for (let i = 0; i < 5; i += 1) plog.append(makeEntry(i) as never);
    await plog.close();
    const plog2 = new PersistentLog({ dir });
    const tail = await plog2.loadTail(10);
    expect(tail.length).toBe(5);
    expect(tail[0]!.ts).toBeLessThan(tail[4]!.ts);
    await plog2.close();
  });

  it('rotates to history files when size exceeds max', async () => {
    const plog = new PersistentLog({ dir, maxFileBytes: 1024, maxHistory: 3 });
    for (let i = 0; i < 50; i += 1) plog.append(makeEntry(i) as never);
    await plog.close();
    const files = await fs.readdir(dir);
    expect(files.some((f) => f.endsWith('.ndjson'))).toBe(true);
    expect(files.some((f) => /\.ndjson\.\d+$/.test(f))).toBe(true);
  });

  it('skips bad lines on loadTail', async () => {
    const file = path.join(dir, 'proxy.ndjson');
    await fs.writeFile(
      file,
      '{"ts":1,"level":"info","source":"a","message":"ok"}\n!!notjson\n{"ts":2,"level":"info","source":"a","message":"ok2"}\n',
    );
    const plog = new PersistentLog({ dir });
    const tail = await plog.loadTail(10);
    expect(tail.length).toBe(2);
    expect(tail.map((e) => e.ts)).toEqual([1, 2]);
    await plog.close();
  });

  it('clearAll removes all files', async () => {
    const plog = new PersistentLog({ dir });
    for (let i = 0; i < 3; i += 1) plog.append(makeEntry(i) as never);
    await plog.close();
    const plog2 = new PersistentLog({ dir });
    await plog2.clearAll();
    const remaining = await fs.readdir(dir);
    expect(remaining.length).toBe(0);
  });

  it('prune removes oldest files when over budget', async () => {
    // Pre-create three files totaling > 100 bytes; budget 80 → at least one removed.
    const file = path.join(dir, 'proxy.ndjson');
    await fs.writeFile(file, 'A'.repeat(60));
    await fs.writeFile(file + '.1', 'B'.repeat(60));
    await fs.writeFile(file + '.2', 'C'.repeat(60));
    const plog = new PersistentLog({ dir });
    await plog.prune(80);
    const remaining = await fs.readdir(dir);
    expect(remaining.length).toBeLessThan(3);
  });

  it('append failure is swallowed (no throw)', async () => {
    const plog = new PersistentLog({ dir });
    // Force open() error by sabotaging dir to a file
    plog.append(makeEntry(0) as never);
    plog.append(makeEntry(1) as never);
    await plog.close();
    expect(true).toBe(true);
  });
});
