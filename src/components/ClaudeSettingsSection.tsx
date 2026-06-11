import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';

const CLI_MODEL_OPTIONS = [
  { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro（Pro）' },
  { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash（Flash）' },
];

const ENV_VAR_ROWS: Array<{ key: string; label: string; envName: string }> = [
  { key: 'anthropicModel', label: '默认主模型', envName: 'ANTHROPIC_MODEL' },
  { key: 'anthropicDefaultOpusModel', label: 'Opus 角色', envName: 'ANTHROPIC_DEFAULT_OPUS_MODEL' },
  {
    key: 'anthropicDefaultSonnetModel',
    label: 'Sonnet 角色',
    envName: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  },
  {
    key: 'anthropicDefaultHaikuModel',
    label: 'Haiku 角色',
    envName: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  },
  { key: 'claudeCodeSubagentModel', label: '子代理模型', envName: 'CLAUDE_CODE_SUBAGENT_MODEL' },
];

/** v1.6.0: inferenceModels shown as read-only — DeepSeek endpoint routes by prefix. */
const INFERENCE_MODEL_ROWS = [
  { model: 'deepseek-v4-pro', claude: 'claude-opus-4-7' },
  { model: 'deepseek-v4-flash', claude: 'claude-sonnet-4-6' },
  { model: 'deepseek-v4-flash', claude: 'claude-haiku-4-5' },
];

/** Claude 接入设置分区（Claude Code CLI + Claude Desktop）。 */
export function ClaudeSettingsSection(): JSX.Element {
  const pushToast = useAppStore((s) => s.pushToast);

  const [cliEnabled, setCliEnabled] = useState(true);
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [profilePaths, setProfilePaths] = useState<string[]>([]);

  const [desktopEnabled, setDesktopEnabled] = useState(true);
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

      const cli = prefs.claudeCli as
        | { enabled: boolean; envVars: Record<string, string> }
        | undefined;
      const desktop = prefs.claudeDesktop as { enabled: boolean } | undefined;

      setCliEnabled(cli?.enabled ?? true);
      setEnvVars(cli?.envVars ?? {});
      setDesktopEnabled(desktop?.enabled ?? true);

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
      await window.codexSwitch.setPreferences({
        claudeDesktop: { enabled: desktopEnabled },
      });
      if (desktopEnabled) await window.codexSwitch.claudeApplyAll();
      pushToast({
        kind: 'success',
        message: desktopEnabled
          ? '已写入 Claude Desktop 配置（直连 api.deepseek.com），请重启 Claude Desktop 生效'
          : '已保存 Claude Desktop 配置',
      });
    } catch (e) {
      pushToast({ kind: 'error', message: '保存失败：' + (e as Error).message });
    } finally {
      setSavingDesktop(false);
    }
  }, [desktopEnabled, pushToast]);

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
          写入 Claude Desktop 3P 网关配置，直连 api.deepseek.com/anthropic（不走本地代理）
        </p>

        {desktopConfigPath && (
          <div className="text-xs text-slate-400">
            <span className="text-slate-500">配置文件：</span>
            <span className="font-mono bg-slate-900/60 px-1.5 py-0.5 rounded">
              {desktopConfigPath}
            </span>
          </div>
        )}

        {/* v1.6.0: model mapping is handled by DeepSeek endpoint — read-only display */}
        <div className="space-y-1 pt-1">
          <div className="text-xs text-slate-500 mb-1">
            模型映射（由 DeepSeek 端点按前缀路由，无需代理层处理）
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left font-normal py-0.5">Claude 模型</th>
                <th className="text-left font-normal py-0.5">→ DeepSeek 模型</th>
              </tr>
            </thead>
            <tbody>
              {INFERENCE_MODEL_ROWS.map((row) => (
                <tr key={row.claude} className="text-slate-400">
                  <td className="py-0.5 font-mono">{row.claude}</td>
                  <td className="py-0.5 font-mono text-slate-300">{row.model}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
                <li key={f} className="flex items-center gap-2 bg-slate-900/60 px-3 py-2 rounded">
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
