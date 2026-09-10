/**
 * GitHub Release 镜像列表 —— 拼接 electron-updater 的 feed URL，sha512 校验保留。
 *
 * v3.0.0: 删掉了 `auto` 模式及配套的 HEAD 探测（probe / pickAuto，约 47 行）。
 * 理由：① `migrateIfNeeded` 早已把所有存量用户的 `auto` 强制改成 `server`，
 * 只有用户手动新选才可能出现；② 它的探测候选里 github.com 仓库页几乎恒可达，
 * 实际结果恒等于 `github`，等于一个绕远路的别名。保留 server / github / ghproxy / custom。
 */
export type MirrorMode = 'server' | 'github' | 'ghproxy' | 'custom';

const OWNER = 'Mark7766';
const REPO = 'codex-switch';

/**
 * 拼接 feed URL。
 *
 * @param mode       镜像模式
 * @param customPrefix  custom 模式的前缀或 server 模式的 baseUrl
 */
export function buildFeedUrl(
  mode: MirrorMode,
  customPrefix?: string,
  serverBaseUrl?: string,
): string {
  const ghBase = `https://github.com/${OWNER}/${REPO}/releases/latest/download`;
  switch (mode) {
    case 'server':
      if (serverBaseUrl && serverBaseUrl.trim()) {
        return `${serverBaseUrl.trim().replace(/\/$/, '')}/updates`;
      }
      return ghBase;
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
    default:
      return ghBase;
  }
}
