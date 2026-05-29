export const IPC = {
  // 状态
  proxyStatus: 'proxy:status',
  proxyStart: 'proxy:start',
  proxyStop: 'proxy:stop',
  proxyInfo: 'proxy:info',
  proxyLog: 'proxy:log',
  proxyOnStatus: 'proxy:on-status',
  proxyOnLog: 'proxy:on-log',
  // 偏好
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  // 密钥
  keyGet: 'key:get',
  keySet: 'key:set',
  keyClear: 'key:clear',
  // Codex 配置
  codexWrite: 'codex:write',
  codexBackups: 'codex:backups',
  codexRestore: 'codex:restore',
  // 应用信息
  appGetVersion: 'app:get-version',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
