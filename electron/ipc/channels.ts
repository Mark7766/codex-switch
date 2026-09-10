export const IPC = {
  // v3.0.0 供应商注册表
  /**
   * 返回供应商描述符列表（纯数据）。渲染进程不能 import `electron/`，
   * 故设置页的供应商/模型/Key 元数据统一由此通道获取。
   */
  providersList: 'providers:list',
  // 偏好
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  /** §3 事务性应用偏好：写 store + 写 ~/.codex 配置文件。 */
  prefsApply: 'prefs:apply',
  // 密钥（v3.0.0 对供应商泛型化：三条通道 + providerId 参数）
  /** 读取某供应商的掩码 Key。 */
  keyGet: 'key:get',
  /** 写入某供应商的 Key（providerId, key）。 */
  keySet: 'key:set',
  /** 清除某供应商的 Key（providerId）。 */
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
  helpOpenLogsDir: 'help:open-logs-dir',
  helpOpenExternal: 'help:open-external',
  helpGetDiagnostics: 'help:get-diagnostics',
  // 更新
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateOnEvent: 'update:on-event',
  updateSetMirror: 'update:set-mirror',
  // 备份
  codexBackupClean: 'codex:backup-clean',
  codexBackupDelete: 'codex:backup-delete',
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
  /** 检查服务器连通性。 */
  serverPing: 'server:ping',
  // v1.9.0 对话记录来源切换
  codexHasOriginalBackup: 'codex:has-original-backup',
  codexRestoreOriginal: 'codex:restore-original',
  // v1.11.0 邀请好友
  /** 获取分享文案（已填入邀请码）。 */
  shareGetText: 'share:get-text',
  /** 获取社区活跃用户数。 */
  communityGetCount: 'community:get-count',
  /** 获取当前用户的邀请统计。 */
  communityGetProfile: 'community:get-profile',
} as const;
