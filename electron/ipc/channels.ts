export const IPC = {
  // 状态
  proxyStatus: 'proxy:status',
  proxyStart: 'proxy:start',
  proxyStop: 'proxy:stop',
  proxyInfo: 'proxy:info',
  proxyLog: 'proxy:log',
  proxyOnStatus: 'proxy:on-status',
  proxyOnLog: 'proxy:on-log',
  /** §7 主进程主动推送的代理错误（端口冲突 / 运行期 crash / 自动恢复失败）。 */
  proxyOnError: 'proxy:on-error',
  /** §2 查询占用某端口的进程。 */
  proxyLookupPort: 'proxy:lookup-port',
  /** §2 杀掉占用某端口的进程。 */
  proxyKillPort: 'proxy:kill-port',
  // 偏好
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  /** §3 事务性应用偏好：store + ~/.codex + 必要时重启代理。 */
  prefsApply: 'prefs:apply',
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
  /** §5 双击图标 / 第二实例提示主窗口聚焦的 toast。 */
  appOnSecondInstance: 'app:on-second-instance',
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
  // §4 持久化日志
  logsLoadPersisted: 'logs:load-persisted',
  logsClearPersisted: 'logs:clear-persisted',
  logsOpenDir: 'logs:open-dir',
  logsGetStats: 'logs:get-stats',
  // v1.3.0 Claude 接入
  /** 检测 4 个工具的安装 / 配置状态。 */
  claudeDetect: 'claude:detect',
  /** 对检测到的工具应用配置（需要已保存 API Key）。 */
  claudeApplyAll: 'claude:apply-all',
  /** 卸载 Claude Code CLI 的 profile 注释块。 */
  claudeUninstallCli: 'claude:uninstall-cli',
  /** 卸载 Claude Desktop 的 config.json（仅删除 Codex Switch 写入的那份）。 */
  claudeUninstallDesktop: 'claude:uninstall-desktop',
  /** 一键卸载所有 Codex Switch 写入的 Claude 配置。 */
  claudeUninstallAll: 'claude:uninstall-all',
  /** 列出 Claude Desktop config 的备份文件。 */
  claudeDesktopBackups: 'claude:desktop-backups',
  /** 还原 Claude Desktop config 某个备份。 */
  claudeDesktopRestore: 'claude:desktop-restore',
  // v1.7.0 Server 集成
  /** 设置遥测开关。 */
  telemetrySetEnabled: 'telemetry:set-enabled',
  /** 获取遥测在线状态。 */
  telemetryGetOnline: 'telemetry:get-online',
  /** 检查服务器连通性。 */
  serverPing: 'server:ping',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
