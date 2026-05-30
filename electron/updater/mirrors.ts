/**
 * GitHub Release 镜像列表 + HEAD 探测，挑选可用镜像作为 electron-updater feed。
 * 目标：国内用户也能稳定下载 dmg/exe，sha512 校验保留。
 */
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

export type MirrorMode = 'auto' | 'github' | 'ghproxy' | 'custom';

const OWNER = 'Mark7766';
const REPO = 'codex-switch';

/** 拼接镜像前缀和 GitHub release base URL。 */
export function buildFeedUrl(mode: MirrorMode, customPrefix?: string): string {
  const ghBase = `https://github.com/${OWNER}/${REPO}/releases/latest/download`;
  switch (mode) {
    case 'github':
      return ghBase;
    case 'ghproxy':
      return `https://ghproxy.net/${ghBase}`;
    case 'custom':
      if (customPrefix && customPrefix.trim()) {
        const trimmed = customPrefix.trim().replace(/\/$/, '');
        return `${trimmed}/${ghBase}`;
      }
      return ghBase;
    case 'auto':
    default:
      return ghBase;
  }
}

const PROBE_TIMEOUT = 5000;

/** HEAD 一个 URL，返回是否在 5 秒内得到 2xx/3xx 响应。 */
export function probe(url: string, timeoutMs = PROBE_TIMEOUT): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      finish(false);
      return;
    }
    const lib = target.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        method: 'HEAD',
        host: target.host,
        path: target.pathname + target.search,
        timeout: timeoutMs,
      },
      (res) => {
        const code = res.statusCode ?? 0;
        finish(code >= 200 && code < 400);
      },
    );
    req.on('error', () => finish(false));
    req.on('timeout', () => {
      req.destroy();
      finish(false);
    });
    req.end();
  });
}

/** auto 模式：依次探测 [github, ghproxy]，挑第一个可用的。 */
export async function pickAuto(): Promise<MirrorMode> {
  const ghFast = await probe(`https://github.com/${OWNER}/${REPO}`);
  if (ghFast) return 'github';
  const ghproxyOk = await probe(`https://ghproxy.net/https://github.com/${OWNER}/${REPO}`);
  if (ghproxyOk) return 'ghproxy';
  return 'github';
}
