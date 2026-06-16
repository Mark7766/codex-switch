/**
 * PluginManager — offline plugin pack downloader.
 *
 * v1.10.0: Downloads the curated 173-plugin offline pack from
 * codex-switch-server, streams to local disk with progress,
 * and generates the human-language install command for Codex.
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import type { ClientRequest } from 'node:http';

import type { PluginPackInfo, ServerPackResponse, DownloadProgress } from './types';
import { ALL_CLAUDE_PLUGINS, getRecommendedPlugins } from './claude-plugins';

// ── constants ───────────────────────────────────────────────────────────────

const PROGRESS_INTERVAL_MS = 500;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000; // 5 min for 36MB
const STALL_TIMEOUT_MS = 30_000; // 30s no data → abort
const SERVER_TIMEOUT_MS = 15_000; // pack info / initial request

// ── helpers ─────────────────────────────────────────────────────────────────

function parseTarget(rawUrl: string): {
  hostname: string;
  port: number;
  path: string;
  isHttps: boolean;
} {
  const u = new URL(rawUrl);
  return {
    hostname: u.hostname,
    port: u.port ? parseInt(u.port, 10) : u.protocol === 'https:' ? 443 : 80,
    path: u.pathname + u.search,
    isHttps: u.protocol === 'https:',
  };
}

function defaultSavePath(type: 'codex' | 'claude' = 'codex'): string {
  const filename =
    type === 'claude' ? 'claude-offline-plugins.tar.gz' : 'codex-offline-pack.tar.gz';
  return path.join(app.getPath('downloads'), filename);
}

// ── PluginManager ───────────────────────────────────────────────────────────

export class PluginManager {
  private serverBaseUrl: string;
  private abortController: AbortController | null = null;
  private downloadReq: ClientRequest | null = null;

  constructor(serverBaseUrl: string) {
    this.serverBaseUrl = serverBaseUrl.replace(/\/$/, '');
  }

  /** Update server URL (when user changes server preference). */
  setServerUrl(url: string): void {
    this.serverBaseUrl = url.replace(/\/$/, '');
  }

  // ── public API ──────────────────────────────────────────────────────────

  /** Fetch plugin pack metadata from server. */
  async getPackInfo(type: 'codex' | 'claude' = 'codex'): Promise<PluginPackInfo> {
    const url = `${this.serverBaseUrl}/plugins/pack?type=${type}`;
    const { hostname, port, path: reqPath, isHttps } = parseTarget(url);

    return new Promise((resolve, reject) => {
      const req = (isHttps ? https : http).get(
        {
          hostname,
          port,
          path: reqPath,
          timeout: SERVER_TIMEOUT_MS,
          rejectUnauthorized: isHttps,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            try {
              const parsed = JSON.parse(raw) as ServerPackResponse;
              if (parsed.code !== 0 || !parsed.data) {
                reject(new Error(`Server error: ${raw.slice(0, 200)}`));
                return;
              }
              resolve(parsed.data);
            } catch (e) {
              reject(new Error(`Failed to parse pack info: ${(e as Error).message}`));
            }
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('获取插件信息超时'));
      });
    });
  }

  /**
   * Download the plugin pack to disk with progress callbacks.
   *
   * Handles 302 redirect from server → COS automatically.
   * Progress is reported via `onProgress` every ~500ms.
   */
  async downloadPack(
    savePath: string,
    onProgress: (p: DownloadProgress) => void,
    type: 'codex' | 'claude' = 'codex',
  ): Promise<string> {
    const effectivePath = savePath || defaultSavePath(type);
    const dir = path.dirname(effectivePath);

    // ── pre-flight checks ──────────────────────────────────────────────
    // Disk space: need >= 100MB
    const available = this.checkDiskSpace(effectivePath);
    if (available < 100 * 1024 * 1024) {
      throw new Error(
        `磁盘空间不足（可用约 ${Math.round(available / 1_048_576)} MB），` +
          '需要至少 100 MB。请清理后重试。',
      );
    }

    // Ensure download directory exists
    try {
      await fs.promises.mkdir(dir, { recursive: true });
    } catch {
      /* dir likely exists */
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Step 1: request server download endpoint, get 302 → COS URL
    const cosUrl = await this.resolveDownloadRedirect(signal, type);
    if (signal.aborted) throw new Error('下载已取消');

    // Step 2: stream COS → file with progress
    await this.streamDownload(cosUrl, effectivePath, onProgress, signal);

    return effectivePath;
  }

  /**
   * Check if a valid plugin pack already exists at the given path.
   * Returns the path if valid, null otherwise.
   */
  checkExistingFile(savePath?: string, type: 'codex' | 'claude' = 'codex'): string | null {
    const p = savePath || defaultSavePath(type);
    try {
      const stat = fs.statSync(p);
      // Codex: 36MB tar.gz ±10% / Claude: 165MB tar.gz ±10%
      const minSize = type === 'claude' ? 140_000_000 : 30_000_000;
      const maxSize = type === 'claude' ? 190_000_000 : 45_000_000;
      if (stat.isFile() && stat.size > minSize && stat.size < maxSize) {
        return p;
      }
    } catch {
      /* file doesn't exist or can't be read */
    }
    return null;
  }

  /**
   * Check available disk space on the volume containing savePath.
   * Returns available bytes. Falls back to a write-test if statfs unavailable.
   */
  checkDiskSpace(savePath?: string): number {
    const dir = path.dirname(savePath || defaultSavePath());
    try {
      // statfs/statvfs available on Node 18.15+ / macOS, Linux
      const statfsFn = (
        fs as unknown as { statfsSync?: (p: string) => { bavail: bigint; bsize: bigint } }
      ).statfsSync;
      if (statfsFn) {
        const s = statfsFn(dir);
        return Number(s.bavail * s.bsize);
      }
    } catch {
      /* fall through to write-test */
    }
    // Fallback: verify directory is writable
    try {
      const testPath = path.join(dir, '.codex-switch-disk-check');
      fs.writeFileSync(testPath, 'x');
      fs.unlinkSync(testPath);
      return 100 * 1024 * 1024; // assume ample space if writable
    } catch {
      return 0;
    }
  }

  /** Cancel an in-progress download. */
  cancelDownload(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.downloadReq) {
      this.downloadReq.destroy();
      this.downloadReq = null;
    }
  }

  /**
   * Generate install command for the downloaded pack.
   * @param filePath Absolute path to the downloaded tar.gz
   * @param type 'codex' | 'claude'
   * @param selectedPlugins Plugin names to install (Claude only, defaults to recommended 20)
   * @param target 'cowork' (default) | 'code' — only applies to Claude
   */
  getInstallCommand(
    filePath: string,
    type: 'codex' | 'claude' = 'codex',
    selectedPlugins?: string[],
    target: 'cowork' | 'code' = 'cowork',
  ): string {
    if (type === 'codex') {
      return `你帮安装一下离线插件安装包 ${filePath} ，我要把这些插件都加载到codex里。

安装完成后，请帮我注册所有 Codex 插件中的技能到活跃技能列表。找到 ~/.codex/plugins/cache/ 下的 openai-primary-runtime/ 的 4 个核心技能和 openai-curated/ 下所有插件的 skills 子目录，创建 symlink 到 ~/.codex/skills/，命名用 插件名__技能名 防重名。过滤掉需要外部账号的 SaaS 插件（Notion、Slack、Jira、Linear 等），只保留通用开发类。完成后告诉我注册了多少个。`;
    }
    if (target === 'code') return this.getClaudeCodeCommand(filePath, selectedPlugins);
    return this.getClaudeCoworkCommand(filePath, selectedPlugins);
  }

  private getClaudeCoworkCommand(filePath: string, selectedPlugins?: string[]): string {
    const names =
      selectedPlugins && selectedPlugins.length > 0
        ? selectedPlugins
        : getRecommendedPlugins().map((p) => p.name);
    const count = names.length;
    const list = this.formatPluginList(names);
    return `我刚上传了 ${filePath}，请帮我把里面精选的 ${count} 个 skill 装到 Cowork。

步骤：
1. ls /sessions/*/mnt/uploads/*.tar.gz 找到文件
2. tar tzf <找到的文件> | grep "SKILL.md" 列出所有 skill
3. 只装以下 ${count} 个：

${list}

4. 对每个 skill：tar xzf <文件> -O <路径>/SKILL.md 读取 → 去掉 YAML frontmatter → mcp__cowork__save_skill 保存`;
  }

  private getClaudeCodeCommand(filePath: string, _selectedPlugins?: string[]): string {
    // Claude Code installs ALL plugins (not just recommended 20)
    const allCount = ALL_CLAUDE_PLUGINS.length;
    return `我刚下载了 ${filePath}，帮我把里面的全部 skill 装到 Claude Code 里。

里面有 ${allCount} 个 skill，来自官方 marketplace 和 Superpowers 社区。

步骤：
1. tar xzf ${filePath} -C /tmp/claude-plugins/
2. 扫描所有 SKILL.md 并安装：把每个 skill 目录复制到 ~/.claude/skills/<name>/
3. 安装完成后验证：ls ~/.claude/skills/ | wc -l

SKILL.md 开头的 YAML frontmatter（--- ... ---）需要去掉，只保留正文。`;
  }

  private formatPluginList(names: string[]): string {
    const spNames = getRecommendedPlugins()
      .slice(0, 14)
      .map((p) => p.name);
    const allSpSelected = spNames.every((n) => names.includes(n));
    const otherNames = names.filter((n) => !spNames.includes(n));

    let result = '';
    if (allSpSelected) {
      result += `Superpowers（14 个）：
   brainstorming, writing-plans, executing-plans,
   test-driven-development, systematic-debugging,
   subagent-driven-development, verification-before-completion,
   requesting-code-review, receiving-code-review,
   finishing-a-development-branch, using-git-worktrees,
   dispatching-parallel-agents, writing-skills, using-superpowers\n`;
    }
    if (otherNames.length > 0) {
      const entries = ALL_CLAUDE_PLUGINS.filter((p) => otherNames.includes(p.name));
      result += `\n精品扩展（${otherNames.length} 个）：
   ${entries.map((e) => e.name).join(', ')}\n`;
      result += `\n路径：
${entries.map((e) => `   ${e.name} → ${e.path}/SKILL.md`).join('\n')}\n`;
    }
    return result || names.join(', ');
  }

  // ── private helpers ─────────────────────────────────────────────────────

  /**
   * GET /api/v1/plugins/pack/download → follow 302 → return COS URL.
   * Throws if server doesn't return a 302.
   */
  private resolveDownloadRedirect(
    signal: AbortSignal,
    type: 'codex' | 'claude' = 'codex',
  ): Promise<string> {
    const url = `${this.serverBaseUrl}/plugins/pack/download?type=${type}`;
    const { hostname, port, path: reqPath, isHttps } = parseTarget(url);

    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('下载已取消'));
        return;
      }

      const req = (isHttps ? https : http).get(
        {
          hostname,
          port,
          path: reqPath,
          timeout: SERVER_TIMEOUT_MS,
          rejectUnauthorized: isHttps,
        },
        (res) => {
          const loc = res.headers.location;
          // Consume body to free the socket
          res.resume();

          if ((res.statusCode === 302 || res.statusCode === 301 || res.statusCode === 307) && loc) {
            resolve(loc);
          } else if (res.statusCode === 200) {
            // Local fallback: server sends file directly via X-Accel-Redirect
            // Not a redirect, but we can still download — use the original URL
            resolve(url);
          } else {
            reject(new Error(`Server returned ${res.statusCode}: 下载通道异常`));
          }
        },
      );
      req.on('error', (e) => reject(new Error(`无法连接服务器：${e.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('连接服务器超时，请检查网络'));
      });

      const onAbort = (): void => {
        req.destroy();
        reject(new Error('下载已取消'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      req.once('close', () => signal.removeEventListener('abort', onAbort));
    });
  }

  /**
   * Stream a URL to the given file path with progress reporting.
   */
  private streamDownload(
    url: string,
    savePath: string,
    onProgress: (p: DownloadProgress) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const { hostname, port, path: reqPath, isHttps } = parseTarget(url);
    const totalBytes = 37748736; // known pack size; fallback if no Content-Length

    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('下载已取消'));
        return;
      }

      const fileStream = fs.createWriteStream(savePath, { flags: 'w' });
      let lastBytes = 0;
      let lastTime = Date.now();
      let receivedBytes = 0;

      const req = (isHttps ? https : http).get(
        {
          hostname,
          port,
          path: reqPath,
          timeout: DOWNLOAD_TIMEOUT_MS,
          rejectUnauthorized: isHttps,
        },
        (res) => {
          // Handle redirect from COS (belt-and-suspenders)
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            fileStream.close();
            // Recurse to follow the redirect
            this.streamDownload(res.headers.location, savePath, onProgress, signal).then(
              resolve,
              reject,
            );
            return;
          }

          if (res.statusCode !== 200) {
            fileStream.close();
            reject(new Error(`下载失败 (${res.statusCode})：服务器返回异常`));
            return;
          }

          const contentLen = res.headers['content-length'];
          const expectedBytes = contentLen ? parseInt(contentLen, 10) : totalBytes;

          let stallTimer: ReturnType<typeof setTimeout> | null = null;
          const resetStall = (): void => {
            if (stallTimer) clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
              req.destroy();
              fileStream.close();
              reject(new Error('下载中断：网络不稳定，请重试'));
            }, STALL_TIMEOUT_MS);
          };
          resetStall();

          // Progress reporter
          const progressInterval = setInterval(() => {
            const now = Date.now();
            const elapsed = (now - lastTime) / 1000;
            const deltaBytes = receivedBytes - lastBytes;
            const speed = elapsed > 0 ? deltaBytes / elapsed : 0;
            const remaining = speed > 0 ? Math.round((expectedBytes - receivedBytes) / speed) : 999;

            onProgress({
              bytesDownloaded: receivedBytes,
              totalBytes: expectedBytes,
              percent: Math.round((receivedBytes / expectedBytes) * 100),
              speedBytesPerSec: Math.round(speed),
              remainingSeconds: remaining,
            });

            lastBytes = receivedBytes;
            lastTime = now;
          }, PROGRESS_INTERVAL_MS);

          res.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
            resetStall();
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            clearInterval(progressInterval);
            if (stallTimer) clearTimeout(stallTimer);

            // Final progress: 100%
            onProgress({
              bytesDownloaded: receivedBytes,
              totalBytes: expectedBytes,
              percent: 100,
              speedBytesPerSec: 0,
              remainingSeconds: 0,
            });

            resolve();
          });

          fileStream.on('error', (e) => {
            clearInterval(progressInterval);
            if (stallTimer) clearTimeout(stallTimer);
            reject(new Error(`文件写入失败：${e.message}`));
          });
        },
      );

      this.downloadReq = req;

      req.on('error', (e) => {
        fileStream.close();
        reject(new Error(`下载失败：${e.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        fileStream.close();
        reject(new Error('下载超时，请检查网络后重试'));
      });

      const onAbort = (): void => {
        req.destroy();
        fileStream.close();
        // Remove partial file
        try {
          fs.unlinkSync(savePath);
        } catch {
          /* best effort */
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
      req.once('close', () => {
        signal.removeEventListener('abort', onAbort);
        this.downloadReq = null;
      });
    });
  }
}
