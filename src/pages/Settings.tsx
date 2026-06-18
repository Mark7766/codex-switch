import { useEffect, useState } from 'react';
import { ChangelogModal } from '../components/ChangelogModal';
import { ClaudeSettingsSection } from '../components/ClaudeSettingsSection';
import { useAppStore } from '@/lib/store';

export function Settings(): JSX.Element {
  const pushToast = useAppStore((s) => s.pushToast);
  const [savingKey, setSavingKey] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [maskedKey, setMaskedKey] = useState('');
  const [newKey, setNewKey] = useState('');
  const [port, setPort] = useState(11435);
  const [defaultModel, setDefaultModel] = useState<'deepseek-v4-flash' | 'deepseek-v4-pro'>(
    'deepseek-v4-flash',
  );
  const [autoStart, setAutoStart] = useState(true);
  const [backups, setBackups] = useState<{ config: string[]; auth: string[] }>({
    config: [],
    auth: [],
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [autoCheckUpdate, setAutoCheckUpdate] = useState(true);
  const [autoDownload, setAutoDownload] = useState(true);
  const [mirror, setMirror] = useState<'server' | 'auto' | 'github' | 'ghproxy' | 'custom'>(
    'server',
  );
  const [customMirror, setCustomMirror] = useState('');
  const [maxBackups, setMaxBackups] = useState(5);
  const [blockSuggestions, setBlockSuggestions] = useState(true);
  const [telemetryEnabled, setTelemetryEnabled] = useState(true);
  const [showChangelog, setShowChangelog] = useState(false);
  // v1.9.0 对话缓存
  const [cacheStats, setCacheStats] = useState<{ count: number; oldestTimestamp: number | null }>({
    count: 0,
    oldestTimestamp: null,
  });
  const [cacheLimit, setCacheLimit] = useState(1000);
  const [hasOriginalBak, setHasOriginalBak] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const prefs = await window.codexSwitch.getPreferences();
      setPort(prefs.proxyPort);
      setDefaultModel(prefs.defaultModel);
      setAutoStart(prefs.autoStartProxy);
      setMaskedKey(await window.codexSwitch.getApiKey());
      setBackups(await window.codexSwitch.codexBackups());
      setVersion(await window.codexSwitch.getVersion());
      setAutoCheckUpdate(prefs.autoCheckUpdate);
      setAutoDownload(prefs.autoDownload ?? true);
      setMirror(prefs.updateMirror);
      setCustomMirror(prefs.customMirrorUrl);
      setMaxBackups(prefs.maxBackupsPerFile);
      setBlockSuggestions(prefs.blockBackgroundSuggestions ?? true);
      setTelemetryEnabled(prefs.telemetryEnabled ?? true);
      setCacheLimit(prefs.conversationCacheLimit ?? 1000);
      try {
        setCacheStats(await window.codexSwitch.conversationCacheStats());
        setHasOriginalBak(await window.codexSwitch.codexHasOriginalBackup());
      } catch {
        /* ignore */
      }
    })();
    const off = window.codexSwitch.onUpdateEvent((e) => {
      const ev = e as UpdateEvent;
      if (ev.kind === 'available') setUpdateMsg(`发现新版本 v${ev.version}`);
      else if (ev.kind === 'not-available') setUpdateMsg('已是最新版本');
      else if (ev.kind === 'error') setUpdateMsg(`检查更新失败：${ev.message}`);
      else if (ev.kind === 'manual-download')
        setUpdateMsg('已在浏览器打开下载页，请下载 dmg 并拖拽覆盖 /Applications/Codex Switch.app');
      else if (ev.kind === 'downloaded') setUpdateMsg(`v${ev.version} 已下载，可立即安装`);
    });
    return off;
  }, []);

  async function saveKey(): Promise<void> {
    if (!newKey.trim().startsWith('sk-')) {
      pushToast({ kind: 'error', message: 'Key 通常以 sk- 开头' });
      return;
    }
    setSavingKey(true);
    try {
      await window.codexSwitch.setApiKey(newKey.trim());
      setMaskedKey(await window.codexSwitch.getApiKey());
      setNewKey('');
      pushToast({ kind: 'success', message: '已更新 API Key' });
    } catch (e) {
      pushToast({ kind: 'error', message: '保存 Key 失败：' + (e as Error).message });
    } finally {
      setSavingKey(false);
    }
  }

  async function savePrefs(): Promise<void> {
    setSavingPrefs(true);
    pushToast({ kind: 'info', message: '正在保存并应用…' });
    try {
      const res = await window.codexSwitch.applyPreferences({
        proxyPort: port,
        defaultModel,
        autoStartProxy: autoStart,
        autoCheckUpdate,
        autoDownload,
        updateMirror: mirror,
        customMirrorUrl: customMirror,
        maxBackupsPerFile: maxBackups,
        blockBackgroundSuggestions: blockSuggestions,
        telemetryEnabled,
        codexModel: defaultModel,
      });
      await window.codexSwitch.updateSetMirror(mirror, customMirror);
      setBackups(await window.codexSwitch.codexBackups());
      const tail = res.restarted ? '，已重启代理' : res.codexWritten ? '，已同步 ~/.codex' : '';
      pushToast({ kind: 'success', message: '已保存并应用' + tail });
      if (res.portChanged) {
        pushToast({
          kind: 'info',
          message: '端口已变更，请手动重启 Codex Desktop（退出后重新打开）使新端口生效。',
        });
      }
      setMsg(null);
    } catch (e) {
      pushToast({ kind: 'error', message: '保存失败：' + (e as Error).message });
    } finally {
      setSavingPrefs(false);
    }
  }

  async function checkUpdate(): Promise<void> {
    setUpdateMsg('正在检查更新…');
    await window.codexSwitch.updateCheck();
  }

  return (
    <div className="p-10 max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">设置</h1>

      <Section title="DeepSeek API Key">
        <div className="text-sm text-slate-400 mb-2">
          当前：<code className="text-slate-200">{maskedKey || '尚未设置'}</code>
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="新的 sk-..."
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-md text-sm"
          />
          <button
            onClick={saveKey}
            disabled={savingKey || !newKey.trim()}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-md text-sm min-w-[80px]"
          >
            {savingKey ? '保存中…' : '保存'}
          </button>
        </div>
      </Section>

      <Section title="代理与模型">
        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between">
            <span>本地端口</span>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(parseInt(e.target.value, 10) || 11435)}
              className="w-32 px-2 py-1 bg-slate-900 border border-slate-700 rounded-md text-right"
            />
          </label>
          <label className="flex items-center justify-between">
            <span>默认模型</span>
            <select
              value={defaultModel}
              onChange={(e) =>
                setDefaultModel(e.target.value as 'deepseek-v4-flash' | 'deepseek-v4-pro')
              }
              className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md"
            >
              <option value="deepseek-v4-flash">DeepSeek V4 Flash (deepseek-v4-flash)</option>
              <option value="deepseek-v4-pro">DeepSeek V4 Pro (deepseek-v4-pro)</option>
            </select>
          </label>
          <label className="flex items-center justify-between">
            <span>启动应用时自动启动代理</span>
            <input
              type="checkbox"
              checked={autoStart}
              onChange={(e) => setAutoStart(e.target.checked)}
            />
          </label>
          <label className="flex items-start justify-between gap-4">
            <span className="flex-1">
              拦截 Codex Desktop 后台 &ldquo;建议气泡&rdquo; 请求
              <span className="block text-xs text-slate-500 mt-1">
                开启后这些后台请求不消耗 DeepSeek token
              </span>
            </span>
            <input
              type="checkbox"
              checked={blockSuggestions}
              onChange={(e) => setBlockSuggestions(e.target.checked)}
              className="mt-1"
            />
          </label>

          {/* v1.13.0: 对话来源 + 备份合并到 Codex 配置 */}
          {hasOriginalBak && (
            <div className="border-t border-slate-700 pt-3 mt-3">
              <div className="flex items-center justify-between">
                <button
                  onClick={async () => {
                    try {
                      await window.codexSwitch.codexRestoreOriginal();
                      setHasOriginalBak(false);
                      pushToast({
                        kind: 'success',
                        message: '已切换到 OpenAI 官方配置，重启 Codex Desktop 后生效',
                      });
                    } catch (e) {
                      pushToast({ kind: 'error', message: '切换失败：' + (e as Error).message });
                    }
                  }}
                  className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
                >
                  切换到 OpenAI 官方
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={savePrefs}
              disabled={savingPrefs}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-md inline-flex items-center gap-2 min-w-[120px] justify-center"
            >
              {savingPrefs && (
                <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              )}
              {savingPrefs ? '正在应用…' : '保存并应用'}
            </button>
            <span className="text-xs text-slate-500">将写入 ~/.codex/config.toml</span>
          </div>
        </div>
      </Section>

      <ClaudeSettingsSection />

      <Section title="自动更新">
        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between">
            <span>启动时自动检查新版</span>
            <input
              type="checkbox"
              checked={autoCheckUpdate}
              onChange={(e) => setAutoCheckUpdate(e.target.checked)}
            />
          </label>
          {/* v1.11.0: 自动下载开关。macOS 仅下载 DMG 到下载文件夹，Windows 全自动安装。 */}
          <label className="flex items-center justify-between">
            <span>
              {/Mac OS X|Macintosh/.test(navigator.userAgent)
                ? '自动下载新版本（完成后通知你打开安装）'
                : '自动下载并安装新版本'}
            </span>
            <input
              type="checkbox"
              checked={autoDownload}
              onChange={(e) => setAutoDownload(e.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between">
            <span>下载镜像</span>
            <select
              value={mirror}
              onChange={(e) =>
                setMirror(e.target.value as 'server' | 'auto' | 'github' | 'ghproxy' | 'custom')
              }
              className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md"
            >
              <option value="server">官方服务器（推荐）</option>
              <option value="auto">自动</option>
              <option value="github">GitHub 直连</option>
              <option value="ghproxy">ghproxy 镜像</option>
              <option value="custom">自定义前缀</option>
            </select>
          </label>
          {mirror === 'custom' && (
            <input
              value={customMirror}
              onChange={(e) => setCustomMirror(e.target.value)}
              placeholder="https://your-mirror.example.com"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-md text-sm"
            />
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={checkUpdate}
              className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm"
            >
              立即检查更新
            </button>
            <button
              onClick={() => setShowChangelog(true)}
              className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm"
            >
              查看版本记录
            </button>
            {updateMsg && <span className="text-xs text-slate-400">{updateMsg}</span>}
          </div>
        </div>
      </Section>

      {msg && (
        <div className="text-sm text-slate-300 bg-slate-800/60 px-3 py-2 rounded-md">{msg}</div>
      )}

      <Section title="对话缓存">
        <div className="text-sm space-y-3">
          <div className="flex items-center justify-between text-slate-400">
            <span>
              已缓存 {cacheStats.count} 条对话记录
              {cacheStats.oldestTimestamp
                ? `，最早记录：${new Date(cacheStats.oldestTimestamp).toLocaleDateString()}`
                : ''}
            </span>
          </div>
          <label className="flex items-center justify-between">
            <span>缓存上限</span>
            <input
              type="number"
              min={100}
              max={10000}
              value={cacheLimit}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10) || 1000;
                setCacheLimit(v);
                window.codexSwitch.conversationCacheSetLimit(v);
              }}
              className="w-24 px-2 py-1 bg-slate-900 border border-slate-700 rounded-md text-right"
            />
          </label>
          <p className="text-xs text-slate-500">
            达到上限时自动保留最近 {cacheLimit} 条。对话内容同时保存在 Codex Desktop
            中，清空缓存不会丢失历史对话。
          </p>
          <button
            onClick={async () => {
              await window.codexSwitch.conversationCacheClear();
              setCacheStats({ count: 0, oldestTimestamp: null });
              pushToast({ kind: 'success', message: '已清空对话缓存' });
            }}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs"
          >
            清空全部缓存
          </button>
        </div>
      </Section>

      <Section title="关于">
        <dl className="text-sm space-y-1.5">
          <Row label="应用版本" value={`v${version}`} />
          <Row label="代理地址" value={`127.0.0.1:${port}`} />
          <Row label="开源地址" value="github.com/Mark7766/codex-switch" />
        </dl>
      </Section>

      <label className="flex items-start gap-3 text-sm text-slate-500 cursor-pointer">
        <input
          type="checkbox"
          checked={telemetryEnabled}
          onChange={(e) => {
            setTelemetryEnabled(e.target.checked);
            window.codexSwitch.telemetrySetEnabled(e.target.checked);
          }}
          className="mt-0.5"
        />
        <span>
          <span className="text-slate-400">参与体验优化计划</span>
          <span className="block text-xs mt-0.5">
            匿名上报使用数据，帮助我们改进产品。不会发送对话内容、API Key
            或个人信息。仅在有网络连接时上传。
          </span>
        </span>
      </label>
      {showChangelog && (
        <ChangelogModal
          open={showChangelog}
          onClose={() => setShowChangelog(false)}
          version={version}
        />
      )}
    </div>
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

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-slate-200 font-mono text-xs">{value}</dd>
    </div>
  );
}
