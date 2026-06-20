/**
 * ClaudeSettingsSection — v1.13.0 redesign.
 * Separate sections: Claude Desktop + Claude Code CLI.
 * Each has [保存并应用] + [恢复]▾.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';

export function ClaudeSettingsSection(): JSX.Element {
  const pushToast = useAppStore((s) => s.pushToast);

  const [cliEnabled, setCliEnabled] = useState(true);
  const [profilePaths, setProfilePaths] = useState<string[]>([]);

  const [desktopEnabled, setDesktopEnabled] = useState(true);
  const [desktopConfigPath, setDesktopConfigPath] = useState('');

  const [savingCli, setSavingCli] = useState(false);
  const [savingDesktop, setSavingDesktop] = useState(false);

  useEffect(() => {
    (async () => {
      const [prefs, detect] = await Promise.all([
        window.codexSwitch.getPreferences(),
        window.codexSwitch.claudeDetect(),
      ]);
      const cli = prefs.claudeCli as { enabled: boolean } | undefined;
      const desktop = prefs.claudeDesktop as { enabled: boolean } | undefined;
      setCliEnabled(cli?.enabled ?? true);
      setDesktopEnabled(desktop?.enabled ?? true);
      setProfilePaths(detect.claudeCli.profilePaths ?? []);
      setDesktopConfigPath(detect.claudeDesktop.configPath ?? '');
    })();
  }, []);

  const saveCli = useCallback(async () => {
    setSavingCli(true);
    try {
      await window.codexSwitch.setPreferences({
        claudeCli: {
          enabled: cliEnabled,
          envVars: cliEnabled
            ? {
                // ⚠️ 与 electron/claude/env-writer.ts DEFAULT_ENV_VARS 保持一致
                anthropicModel: 'deepseek-v4-pro',
                anthropicDefaultOpusModel: 'deepseek-v4-pro',
                anthropicDefaultSonnetModel: 'deepseek-v4-pro',
                anthropicDefaultHaikuModel: 'deepseek-v4-flash',
                claudeCodeSubagentModel: 'deepseek-v4-flash',
              }
            : {},
        },
      });
      if (cliEnabled) await window.codexSwitch.claudeApplyAll();
      pushToast({
        kind: 'success',
        message: cliEnabled ? '已保存 Claude Code CLI 配置，新终端生效' : '已保存配置',
      });
    } catch (e) {
      pushToast({ kind: 'error', message: '保存失败：' + (e as Error).message });
    } finally {
      setSavingCli(false);
    }
  }, [cliEnabled, pushToast]);

  const saveDesktop = useCallback(async () => {
    setSavingDesktop(true);
    try {
      await window.codexSwitch.setPreferences({ claudeDesktop: { enabled: desktopEnabled } });
      if (desktopEnabled) await window.codexSwitch.claudeApplyAll();
      pushToast({
        kind: 'success',
        message: desktopEnabled ? '已保存，重启 Claude Desktop 生效' : '已保存配置',
      });
    } catch (e) {
      pushToast({ kind: 'error', message: '保存失败：' + (e as Error).message });
    } finally {
      setSavingDesktop(false);
    }
  }, [desktopEnabled, pushToast]);

  return (
    <>
      {/* ── Claude Desktop ──────────────────────────────────── */}
      <Section title="Claude Desktop 接入">
        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between">
            <span>接入状态</span>
            <input
              type="checkbox"
              checked={desktopEnabled}
              onChange={(e) => setDesktopEnabled(e.target.checked)}
            />
          </label>
          <p className="text-xs text-slate-500">
            {desktopEnabled ? '✅ 已配置 · 直连 DeepSeek' : '未启用'}
          </p>
          {desktopConfigPath && (
            <div className="text-xs text-slate-500">
              配置文件：<span className="font-mono">{desktopConfigPath}</span>
            </div>
          )}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={saveDesktop}
              disabled={savingDesktop}
              className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded text-sm"
            >
              {savingDesktop ? '保存中…' : '保存并应用'}
            </button>
            <span className="text-xs text-slate-500">重启 Claude Desktop 生效</span>
          </div>
        </div>
      </Section>

      {/* ── Claude Code CLI ─────────────────────────────────── */}
      <Section title="Claude Code CLI 接入">
        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between">
            <span>接入状态</span>
            <input
              type="checkbox"
              checked={cliEnabled}
              onChange={(e) => setCliEnabled(e.target.checked)}
            />
          </label>
          <p className="text-xs text-slate-500">
            {cliEnabled ? '✅ 已配置 · 直连 DeepSeek' : '未启用'}
          </p>
          {profilePaths.length > 0 && (
            <div className="text-xs text-slate-500">
              写入的 Shell profile：
              {profilePaths.map((p) => (
                <span key={p} className="block ml-2 font-mono">
                  {p}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={saveCli}
              disabled={savingCli}
              className="px-4 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 rounded text-sm"
            >
              {savingCli ? '保存中…' : '保存并应用'}
            </button>
            <span className="text-xs text-slate-500">新终端窗口生效</span>
          </div>
        </div>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="bg-slate-800/50 rounded-xl p-6">
      <div className="text-base font-medium mb-3">{title}</div>
      {children}
    </div>
  );
}
