import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EOL } from 'node:os';
import type { ProxyLogEntry } from './server';

/**
 * ndjson 滚动日志：
 * - 单文件 ≤ MAX_FILE_BYTES（10 MB），到点即 rename 为 .1
 * - 历史 .1..N（默认 4 个），超出最旧者被删除
 * - 启动时 prune 总量超 MAX_TOTAL_BYTES（50 MB）的最旧文件
 */
export class PersistentLog {
  private readonly dir: string;
  private readonly file: string;
  private readonly maxFileBytes: number;
  private readonly maxFiles: number;
  private currentBytes = 0;
  private writing = Promise.resolve();
  private fh: fsp.FileHandle | null = null;
  private opened = false;

  constructor(opts: {
    dir: string;
    fileName?: string;
    maxFileBytes?: number;
    /** 历史文件数（不含当前正在写的）。默认 4。 */
    maxHistory?: number;
  }) {
    this.dir = opts.dir;
    this.file = path.join(this.dir, opts.fileName ?? 'proxy.ndjson');
    this.maxFileBytes = opts.maxFileBytes ?? 10 * 1024 * 1024;
    this.maxFiles = (opts.maxHistory ?? 4) + 1;
  }

  private async open(): Promise<void> {
    if (this.opened) return;
    await fsp.mkdir(this.dir, { recursive: true });
    try {
      const st = await fsp.stat(this.file);
      this.currentBytes = st.size;
    } catch {
      this.currentBytes = 0;
    }
    this.fh = await fsp.open(this.file, 'a');
    this.opened = true;
  }

  /** 追加一条；失败静默吞掉，不能阻塞代理。 */
  append(entry: ProxyLogEntry): void {
    this.writing = this.writing.then(() => this.appendInternal(entry)).catch(() => undefined);
  }

  private async appendInternal(entry: ProxyLogEntry): Promise<void> {
    await this.open();
    if (!this.fh) return;
    const line = JSON.stringify(entry) + EOL;
    const buf = Buffer.from(line, 'utf8');
    if (this.currentBytes + buf.byteLength > this.maxFileBytes) {
      await this.rotate();
    }
    if (!this.fh) await this.open();
    if (!this.fh) return;
    await this.fh.write(buf);
    this.currentBytes += buf.byteLength;
  }

  private async rotate(): Promise<void> {
    if (this.fh) {
      try {
        await this.fh.close();
      } catch {
        /* ignore */
      }
      this.fh = null;
    }
    // 把 file → file.1 → file.2 ... 滚动；最旧的删掉。
    for (let i = this.maxFiles - 1; i >= 1; i -= 1) {
      const src = i === 1 ? this.file : `${this.file}.${i - 1}`;
      const dst = `${this.file}.${i}`;
      try {
        await fsp.rename(src, dst);
      } catch {
        /* ignore */
      }
    }
    // 删除滚出窗口的最旧（rename 会覆盖，但保险删除）
    try {
      await fsp.unlink(`${this.file}.${this.maxFiles}`);
    } catch {
      /* ignore */
    }
    this.currentBytes = 0;
    this.fh = await fsp.open(this.file, 'a');
  }

  /** 启动时把超出总量的旧文件删掉，并丢弃损坏的当前文件。 */
  async prune(maxTotalBytes = 50 * 1024 * 1024): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
    const files: string[] = [];
    for (let i = this.maxFiles; i >= 1; i -= 1) {
      const p = i === 0 ? this.file : `${this.file}.${i}`;
      try {
        await fsp.access(p);
        files.push(p);
      } catch {
        /* not exist */
      }
    }
    try {
      await fsp.access(this.file);
      files.push(this.file);
    } catch {
      /* not exist */
    }
    let total = 0;
    for (const f of files) {
      try {
        const s = await fsp.stat(f);
        total += s.size;
      } catch {
        /* ignore */
      }
    }
    while (total > maxTotalBytes && files.length > 0) {
      const oldest = files.shift();
      if (!oldest) break;
      try {
        const s = await fsp.stat(oldest);
        await fsp.unlink(oldest);
        total -= s.size;
      } catch {
        /* ignore */
      }
    }
  }

  async close(): Promise<void> {
    await this.writing.catch(() => undefined);
    if (this.fh) {
      try {
        await this.fh.close();
      } catch {
        /* ignore */
      }
      this.fh = null;
    }
    this.opened = false;
  }

  /** 反向读取尾部 N 条；坏行 skip。 */
  async loadTail(n: number, maxBytes = 1024 * 1024): Promise<ProxyLogEntry[]> {
    const result: ProxyLogEntry[] = [];
    const all: string[] = [this.file];
    for (let i = 1; i < this.maxFiles; i += 1) all.push(`${this.file}.${i}`);
    for (const p of all) {
      if (result.length >= n) break;
      try {
        const lines = await readTailLines(p, maxBytes);
        for (let i = lines.length - 1; i >= 0 && result.length < n; i -= 1) {
          const line = lines[i]!;
          if (!line) continue;
          try {
            result.push(JSON.parse(line) as ProxyLogEntry);
          } catch {
            /* skip bad line */
          }
        }
      } catch {
        /* file missing */
      }
    }
    // 反转回时间正序
    return result.reverse();
  }

  /** 清空全部已持久化的日志。 */
  async clearAll(): Promise<void> {
    await this.close();
    for (let i = 1; i < this.maxFiles; i += 1) {
      try {
        await fsp.unlink(`${this.file}.${i}`);
      } catch {
        /* ignore */
      }
    }
    try {
      await fsp.unlink(this.file);
    } catch {
      /* ignore */
    }
    this.currentBytes = 0;
  }

  getFilePath(): string {
    return this.file;
  }

  async getStats(): Promise<{ files: number; totalBytes: number }> {
    let files = 0;
    let totalBytes = 0;
    const all = [this.file];
    for (let i = 1; i < this.maxFiles; i += 1) all.push(`${this.file}.${i}`);
    for (const p of all) {
      try {
        const s = await fsp.stat(p);
        files += 1;
        totalBytes += s.size;
      } catch {
        /* ignore */
      }
    }
    return { files, totalBytes };
  }
}

async function readTailLines(filePath: string, maxBytes: number): Promise<string[]> {
  const fd = await fsp.open(filePath, 'r');
  try {
    const stat = await fd.stat();
    const size = stat.size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    await fd.read(buf, 0, buf.byteLength, start);
    let text = buf.toString('utf8');
    // 若不是从行首开始，丢弃首个不完整行
    if (start > 0) {
      const idx = text.indexOf('\n');
      text = idx >= 0 ? text.slice(idx + 1) : '';
    }
    return text.split(/\r?\n/);
  } finally {
    await fd.close();
  }
}

/** 测试辅助：纯函数版的 ndjson append（同步），仅供单元测试用。 */
export function appendSyncForTest(filePath: string, entry: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(entry) + EOL, 'utf8');
}
