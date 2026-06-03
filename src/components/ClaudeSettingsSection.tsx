import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';

const CLI_MODEL_OPTIONS = [
  { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro（Pro）' },
  { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash（Flash）' },
];

const DESKTOP_MODEL_OPTIONS = [
  { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro（Pro）' },
  { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash（Flash）' },
];

const ENV_VAR_ROWS: Array<{ key: string; label: string; envName: string }> = [
  { key: 'anthropicModel', label: '默认主模型', envName: 'ANTHROPIC_MODEL' },
  { key: 'anthropicDefaultOpusModel', label: 'Opus 角色', envName: 'ANTHROPIC_DEFAULT_OPUS_MODEL' },
  { key: 'anthropicDefaultSonnetModel', label: 'Sonnet 角色', envName: 'ANTHROPIC_DEFAULT_SONNET_MODEL' },
  { key: 'anthropicDefaultHaikuModel', label: 'Haiku 角色', envName: 'ANTHROPIC_DEFAULT_HAIKU_MODEL' },
  { key: 'claudeCodeSubagentModel', label: '子代理模型', envName: 'CLAUDE_CODE_SUBAGENT_MODEL' },
];

const DESKTOP_ROLES = ['sonnet', 'opus', 'haiku'] as const;
type DesktopRole = (typeof DESKTOP_ROLES)[number];

const ROLE_LABEL: Record<DesktopRole, string> = { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku' };

interface RoleEntry {
  model: string;
  supports1m: boolean;
}

/** Claude 接入设置分区（Claude Code CLI + Claude Desktop）。 */
export function ClaudeSettingsSection(): JSX.Element {
  const pushToast = useAppStore((s) => s.pushToast);

  const [cliEnabled, setCliEnabled] = useState(true);
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [profilePaths, setProfilePaths] = useState<string[]>([]);

  const [desktopEnabled, setDesktopEnabled] = useState(true);
  const [roleMap, setRoleMap] = useState<Record<DesktopRole, RoleEntry>>({
    sonnet: { model: 'deepseek-v4-pro', supports1m: true },
    opus: { model: 'deepseek-v4-pro', supports1m: true },
    haiku: { model: 'deepseek-v4-flash', supports1m: false },
  });
  const [desktopConfigPath, setDesktopConfigPath] = useState('');
  const [desktopBackups, setDesktopBackups] = useState<string[]>([]);

  const [savingCli, setSavingCli] = useState(false);
  const [savingDesktop, setSavingDesktop] = useState(false);

  useEffect(() => {
    (async () => {
      const [prefs, detect, backups] = await Promise.all([
        window.codexSwitch.getPreferences(),
        window.codexSwitch.claudeDetect(),
        window.codexSwitch.claudeDesktopBackups(),
      ]);

      const cli = prefs.claudeCli as { enabled: boolean; envVars: Record<string, string> } | undefined;
      const desktop = prefs.claudeDesktop as
        | { enabled: boolean; modelMap: Record<string, RoleEntry> }
        | undefined;

      setCliEnabled(cli?.enabled ?? true);
      setEnvVars(cli?.envVars ?? {});
      setDesktopEnabled(desktop?.enabled ?? true);

      if (desktop?.modelMap) {
        const m = desktop.modelMap;
        setRoleMap({
          sonnet: m['sonnet'] ?? { model: 'deepseek-v4-pro', supports1m: true },
          opus: m['opus'] ?? { model: 'deepseek-v4-pro', supports1m: true },
          haiku: m['haiku'] ?? { model: 'deepseek-v4-flash', supports1m: false },
        });
      }

      setProfilePaths(detect.claudeCli.profilePaths ?? []);
      setDesktopConfigPath(detect.claudeDesktop.configPath ?? '');
      setDesktopBackups(backups);
    })();
  }, []);

  const saveCli = useCallback(async () => {
    setSavingCli(true);
    try {
      await window.codexSwitch.setPreferences({ claudeCli: { enabled: cliEnabled, envVars } });
      if (cliEnabled) await window.codexSwitch.claudeApplyAll();
      pushToast({
        kind: 'success',
        message: cliEnabled
          ? '已写入 ~/.claude/settings.json 和 ~/.zshrc，直接运行 claude 即可'
          : '已保存 Claude Code CLI 配置',
      });
    } catch (e) {
      pushToast({ kind: 'error', message: '保存失败：' + (e as Error).message });
    } finally {
      setSavingCli(false);
    }
  }, [cliEnabled, envVars, pushToast]);

  const saveDesktop = useCallback(async () => {
    setSavingDesktop(true);
    try {
      const fullMap = {
        sonnet: { model: roleMap.sonnet.model, supports1m: roleMap.sonnet.model === 'deepseek-v4-pro' },
        opus: { model: roleMap.opus.model, supports1m: roleMap.opus.model === 'deepseek-v4-pro' },
        haiku: { model: roleMap.haiku.model, supports1m: roleMap.haiku.model === 'deepseek-v4-pro' },
      };
      await window.codexSwitch.setPreferences({ claudeDesktop: { enabled: desktopEnabled, modelMap: fullMap } });
      if (desktopEnabled) await window.codexSwitch.claudeApplyAll();
      pushToast({
        kind: 'success',
        message: desktopEnabled
          ? '已写入 Claude Desktop 配置，请重启 Claude Desktop 生效'
          : '已保存 Claude Desktop 配置',
      });
    } catch (e) {
      pushToast({ kind: 'error', message: '保存失败：' + (e as Error).message });
    } finally {
      setSavingDesktop(false);
    }
  }, [desktopEnabled, roleMap, pushToast]);

  const restoreDesktop = useCallback(
    async (path: string) => {
      try {
        await window.codexSwitch.claudeDesktopRestore(path);
        setDesktopBackups(await window.codexSwitch.claudeDesktopBackups());
        pushToast({ kind: 'success', message: 'Claude Desktop 配置已还原' });
      } catch (e) {
        pushToast({ kind: 'error', message: '还原失败：' + (e as Error).message });
      }
    },
    [pushToast],
  );

  const uninstallAll = useCallback(async () => {
    try {
      await window.codexSwitch.claudeUninstallAll();
      pushToast({ kind: 'success', message: '已卸载所有 Codex Switch 写入的配置' });
    } catch (e) {
      pushToast({ kind: 'error', message: '卸载失败：' + (e as Error).message });
    }
  }, [pushToast]);

  return (
    <div className="space-y-4 text-sm">
      {/* ── Claude Code CLI ────────────────────────────────── */}
      <div className="border border-slate-700/40 rounded-xl p-4 space-y-3">
        <label className="flex items-center justify-between">
          <span className="font-medium">Claude Code CLI 接入</span>
          <input
            type="checkbox"
            checked={cliEnabled}
            onChange={(e) => setCliEnabled(e.target.checked)}
          />
        </label>
        <p className="text-xs text-slate-500">
          环境变量写入 Shell profile，Claude Code CLI 直连 DeepSeek（不走本地代理）
        </p>

        {profilePaths.length > 0 && (
          <div className="text-xs text-slate-400 space-y-0.5">
            <span className="text-slate-500">写入的 Shell profile：</span>
            {profilePaths.map((p) => (
              <span key={p} className="block ml-2 font-mono bg-slate-900/60 px-1.5 py-0.5 rounded">
                {p}
              </span>
            ))}
          </div>
        )}

        <div className="space-y-2 pt-1">
          <div className="text-xs text-slate-500 mb-1">环境变量默认值（写入 Shell profile）</div>
          {ENV_VAR_ROWS.map(({ key, label, envName }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-slate-400 shrink-0 w-28 text-xs">
                {label}
                <span className="block text-slate-600" title={envName}>
                  {envName}
                </span>
              </span>
              <select
                value={envVars[key] ?? 'deepseek-v4-pro'}
                onChange={(e) => setEnvVars((v) => ({ ...v, [key]: e.target.value }))}
                className="flex-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs"
              >
                {CLI_MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <button
          onClick={saveCli}
          disabled={savingCli}
          className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded text-sm"
        >
          {savingCli ? '保存中…' : '保存并重新应用'}
        </button>
      </div>

      {/* ── Claude Desktop ─────────────────────────────────── */}
      <div className="border border-slate-700/40 rounded-xl p-4 space-y-3">
        <label className="flex items-center justify-between">
          <span className="font-medium">Claude Desktop 接入</span>
          <input
            type="checkbox"
            checked={desktopEnabled}
            onChange={(e) => setDesktopEnabled(e.target.checked)}
          />
        </label>
        <p className="text-xs text-slate-500">
          写入 Claude Desktop 配置文件，请求经由本地代理转发至 DeepSeek
        </p>

        {desktopConfigPath && (
          <div className="text-xs text-slate-400">
            <span className="text-slate-500">配置文件：</span>
            <span className="font-mono bg-slate-900/60 px-1.5 py-0.5 rounded">
              {desktopConfigPath}
            </span>
          </div>
        )}

        <div className="space-y-2 pt-1">
          <div className="text-xs text-slate-500 mb-1">模型映射（Claude 角色 → DeepSeek 模型）</div>
          {DESKTOP_ROLES.map((role) => (
            <div key={role} className="flex items-center justify-between gap-3">
              <span className="text-slate-400 shrink-0 w-20 text-xs">{ROLE_LABEL[role]}</span>
              <select
                value={roleMap[role].model}
                onChange={(e) =>
                  setRoleMap((m) => ({
                    ...m,
                    [role]: { model: e.target.value, supports1m: e.target.value === 'deepseek-v4-pro' },
                  }))
                }
                className="flex-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs"
              >
                {DESKTOP_MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <button
          onClick={saveDesktop}
          disabled={savingDesktop}
          className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded text-sm"
        >
          {savingDesktop ? '保存中…' : '保存并重新应用'}
        </button>

        {desktopBackups.length > 0 && (
          <div className="pt-1">
            <div className="text-xs text-slate-400 mb-1">Claude Desktop 配置备份</div>
            <ul className="space-y-1 text-xs">
              {desktopBackups.slice(0, 5).map((f) => (
                <li
                  key={f}
                  className="flex items-center gap-2 bg-slate-900/60 px-3 py-2 rounded"
                >
                  <span className="font-mono truncate flex-1">{f.split('/').at(-1)}</span>
                  <button
                    onClick={() => restoreDesktop(f)}
                    className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded"
                  >
                    还原
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Uninstall all ──────────────────────────────────── */}
      <div className="pt-1">
        <button
          onClick={uninstallAll}
          className="px-4 py-2 bg-red-800 hover:bg-red-700 rounded text-sm"
        >
          一键卸载所有写入的配置
        </button>
        <p className="text-xs text-slate-500 mt-1">
          同时还原 Codex、Claude Desktop 配置并清除 Shell profile 注入块。
        </p>
      </div>
    </div>
  );
}
