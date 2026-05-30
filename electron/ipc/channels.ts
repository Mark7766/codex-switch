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
  appGetChangelog: 'app:get-changelog',
  // 帮助
  helpGetFaq: 'help:get-faq',
  helpGetOnboarding: 'help:get-onboarding',
  helpGetQaImage: 'help:get-qa-image',
  helpOpenLogsDir: 'help:open-logs-dir',
  helpOpenExternal: 'help:open-external',
  helpGetDiagnostics: 'help:get-diagnostics',
  // 更新
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  updateOnEvent: 'update:on-event',
  updateSetMirror: 'update:set-mirror',
  // 备份
  codexBackupClean: 'codex:backup-clean',
  codexBackupDelete: 'codex:backup-delete',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
