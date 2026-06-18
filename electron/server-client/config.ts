/**
 * codex-switch-server 客户端配置。
 *
 * Server URL 解析优先级：
 *   1. 环境变量 CODEX_SWITCH_SERVER_URL（显式覆盖）
 *   2. 用户偏好 prefs.serverUrl（electron-store 持久化）
 *   3. 应用默认值（!app.isPackaged → DEV_SERVER_URL, 否则 → PROD_SERVER_URL）
 */
import { randomBytes } from 'node:crypto';
import { app } from 'electron';

import type { UserPreferences } from '../config/store';

/** 生产环境默认服务器地址 */
export const PROD_SERVER_URL = 'https://www.codex-switch.cloud/api/v1';

/** 本地开发默认服务器地址 */
export const DEV_SERVER_URL = 'http://localhost:8000/api/v1';

/** 环境变量名，用于覆盖 Server URL。 */
export const ENV_SERVER_URL = 'CODEX_SWITCH_SERVER_URL';

/**
 * 解析实际使用的 Server URL，按优先级。
 * 返回值尾部 '/' 已去除。
 */
export function resolveServerUrl(prefs?: { serverUrl?: string }): string {
  // 1. 环境变量显式覆盖（最高优先级）
  const envUrl = process.env[ENV_SERVER_URL];
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/$/, '');
  }

  // 2. 用户偏好（Settings 中持久化）
  if (prefs?.serverUrl && prefs.serverUrl.trim()) {
    return prefs.serverUrl.trim().replace(/\/$/, '');
  }

  // 3. 应用默认值
  return app.isPackaged ? PROD_SERVER_URL : DEV_SERVER_URL;
}

/** Server 连接配置（合并三级优先级后的最终视图）。 */
export interface ServerConfig {
  baseUrl: string;
  telemetryEnabled: boolean;
  clientId: string;
}

/** 从 UserPreferences 构建 ServerConfig。 */
export function getServerConfig(prefs: UserPreferences): ServerConfig {
  return {
    baseUrl: resolveServerUrl(prefs),
    telemetryEnabled: prefs.telemetryEnabled ?? true,
    clientId: prefs.clientId || '',
  };
}

/** 拼接 baseUrl + path。baseUrl 不应带尾部 '/'。 */
export function buildUrl(baseUrl: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${p}`;
}

/** 生成新的 clientId：16 位十六进制字符串。 */
export function generateClientId(): string {
  return randomBytes(8).toString('hex');
}
