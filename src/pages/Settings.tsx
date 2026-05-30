import { useEffect, useState } from 'react';
import { ChangelogModal } from '../components/ChangelogModal';

export function Settings(): JSX.Element {
  const [maskedKey, setMaskedKey] = useState('');
  const [newKey, setNewKey] = useState('');
  const [port, setPort] = useState(11435);
  const [defaultModel, setDefaultModel] = useState<'deepseek-v4-flash' | 'deepseek-v4-pro'>('deepseek-v4-flash');
  const [autoStart, setAutoStart] = useState(true);
  const [backups, setBackups] = useState<{ config: string[]; auth: string[] }>({ config: [], auth: [] });
  const [msg, setMsg] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [autoCheckUpdate, setAutoCheckUpdate] = useState(true);
  const [mirror, setMirror] = useState<'auto' | 'github' | 'ghproxy' | 'custom'>('auto');
  const [customMirror, setCustomMirror] = useState('');
  const [maxBackups, setMaxBackups] = useState(5);
  const [showChangelog, setShowChangelog] = useState(false);
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
      setMirror(prefs.updateMirror);
      setCustomMirror(prefs.customMirrorUrl);
      setMaxBackups(prefs.maxBackupsPerFile);
    })();
    const off = window.codexSwitch.onUpdateEvent((e) => {
      const ev = e as UpdateEvent;
      if (ev.kind === 'available') setUpdateMsg(`发现新版本 v${ev.version}`);
      else if (ev.kind === 'not-available') setUpdateMsg('已是最新版本');
      else if (ev.kind === 'error') setUpdateMsg(`检查更新失败：${ev.message}`);
      else if (ev.kind === 'downloaded') setUpdateMsg(`v${ev.version} 已下载，可立即安装`);
    });
    return off;
  }, []);

  async function saveKey(): Promise<void> {
    if (!newKey.trim().startsWith('sk-')) {
      setMsg('Key 通常以 sk- 开头');
      return;
    }
    await window.codexSwitch.setApiKey(newKey.trim());
    setMaskedKey(await window.codexSwitch.getApiKey());
    setNewKey('');
    setMsg('已更新 API Key');
  }

  async function savePrefs(): Promise<void> {
    await window.codexSwitch.setPreferences({
      proxyPort: port,
      defaultModel,
      autoStartProxy: autoStart,
      autoCheckUpdate,
      updateMirror: mirror,
      customMirrorUrl: customMirror,
      maxBackupsPerFile: maxBackups,
    });
    await window.codexSwitch.updateSetMirror(mirror, customMirror);
    setMsg('已保存偏好');
  }

  async function checkUpdate(): Promise<void> {
    setUpdateMsg('正在检查更新…');
    await window.codexSwitch.updateCheck();
  }

  async function deleteBackup(p: string): Promise<void> {
    await window.codexSwitch.codexBackupDelete(p);
    setBackups(await window.codexSwitch.codexBackups());
  }

  async function cleanAllBackups(): Promise<void> {
    await window.codexSwitch.codexBackupClean();
    setBackups(await window.codexSwitch.codexBackups());
    setMsg('已清空所有备份');
  }

  async function rewriteCodex(): Promise<void> {
    try {
      await window.codexSwitch.codexWrite({ model: defaultModel });
      setBackups(await window.codexSwitch.codexBackups());
      setMsg('Codex 配置已更新');
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function restore(p: string): Promise<void> {
    const restored = await window.codexSwitch.codexRestore(p);
    setMsg(`已从备份还原 → ${restored}`);
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
          <button onClick={saveKey} className="px-4 py-2 bg-brand-600 hover:bg-brand-700 rounded-md text-sm">
            保存
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
              onChange={(e) => setDefaultModel(e.target.value as 'deepseek-v4-flash' | 'deepseek-v4-pro')}
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
          <div className="flex gap-2 pt-2">
            <button onClick={savePrefs} className="px-4 py-2 bg-brand-600 hover:bg-brand-700 rounded-md">
              保存偏好
            </button>
            <button onClick={rewriteCodex} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-md">
              重新写入 ~/.codex
            </button>
          </div>
        </div>
      </Section>

      <Section title="Codex 配置备份">
        <div className="flex items-center gap-3 text-sm mb-3">
          <label className="flex-1">每类文件保留份数</label>
          <input
            type="number"
            min={1}
            max={50}
            value={maxBackups}
            onChange={(e) => setMaxBackups(parseInt(e.target.value, 10) || 5)}
            className="w-20 px-2 py-1 bg-slate-900 border border-slate-700 rounded-md text-right"
          />
          <button
            onClick={cleanAllBackups}
            className="px-3 py-1 bg-red-700 hover:bg-red-600 rounded text-xs"
          >
            清空全部
          </button>
        </div>
        {backups.config.length === 0 && backups.auth.length === 0 && (
          <div className="text-sm text-slate-500">暂无备份。</div>
        )}
        <BackupList
          title="config.toml"
          files={backups.config}
          onRestore={restore}
          onDelete={deleteBackup}
        />
        <BackupList
          title="auth.json"
          files={backups.auth}
          onRestore={restore}
          onDelete={deleteBackup}
        />
      </Section>

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
          <label className="flex items-center justify-between">
            <span>下载镜像</span>
            <select
              value={mirror}
              onChange={(e) =>
                setMirror(e.target.value as 'auto' | 'github' | 'ghproxy' | 'custom')
              }
              className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md"
            >
              <option value="auto">自动（推荐）</option>
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

      <Section title="关于">
        <dl className="text-sm space-y-1.5">
          <Row label="应用版本" value={`v${version}`} />
          <Row label="代理地址" value={`127.0.0.1:${port}`} />
          <Row label="开源地址" value="github.com/Mark7766/codex-switch" />
        </dl>
      </Section>
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

function BackupList({
  title,
  files,
  onRestore,
  onDelete,
}: {
  title: string;
  files: string[];
  onRestore: (p: string) => void;
  onDelete: (p: string) => void;
}): JSX.Element | null {
  if (!files.length) return null;
  return (
    <div className="mb-3">
      <div className="text-xs text-slate-400 mb-1">{title}</div>
      <ul className="space-y-1 text-xs">
        {files.slice(0, 10).map((f) => (
          <li
            key={f}
            className="flex items-center justify-between bg-slate-900/60 px-3 py-2 rounded gap-2"
          >
            <span className="font-mono truncate flex-1">{f.split('/').slice(-1)[0]}</span>
            <button
              onClick={() => onRestore(f)}
              className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-xs"
            >
              还原
            </button>
            <button
              onClick={() => onDelete(f)}
              className="px-2 py-0.5 bg-red-800 hover:bg-red-700 rounded text-xs"
            >
              删除
            </button>
          </li>
        ))}
      </ul>
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
