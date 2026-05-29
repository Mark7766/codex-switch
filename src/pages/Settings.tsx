import { useEffect, useState } from 'react';

export function Settings(): JSX.Element {
  const [maskedKey, setMaskedKey] = useState('');
  const [newKey, setNewKey] = useState('');
  const [port, setPort] = useState(11435);
  const [defaultModel, setDefaultModel] = useState<'deepseek-v4-flash' | 'deepseek-v4-pro'>('deepseek-v4-flash');
  const [autoStart, setAutoStart] = useState(true);
  const [backups, setBackups] = useState<{ config: string[]; auth: string[] }>({ config: [], auth: [] });
  const [msg, setMsg] = useState<string | null>(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    (async () => {
      const prefs = await window.codexSwitch.getPreferences();
      setPort(prefs.proxyPort);
      setDefaultModel(prefs.defaultModel);
      setAutoStart(prefs.autoStartProxy);
      setMaskedKey(await window.codexSwitch.getApiKey());
      setBackups(await window.codexSwitch.codexBackups());
      setVersion(await window.codexSwitch.getVersion());
    })();
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
    });
    setMsg('已保存偏好');
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
        {backups.config.length === 0 && backups.auth.length === 0 && (
          <div className="text-sm text-slate-500">暂无备份。</div>
        )}
        <BackupList title="config.toml" files={backups.config} onRestore={restore} />
        <BackupList title="auth.json" files={backups.auth} onRestore={restore} />
      </Section>

      {msg && (
        <div className="text-sm text-slate-300 bg-slate-800/60 px-3 py-2 rounded-md">{msg}</div>
      )}

      <Section title="关于">
        <dl className="text-sm space-y-1.5">
          <Row label="应用版本" value={`v${version}`} />
          <Row label="代理地址" value="127.0.0.1:11435" />
          <Row label="开源地址" value="github.com/Mark7766/codex-switch" />
        </dl>
      </Section>
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
}: {
  title: string;
  files: string[];
  onRestore: (p: string) => void;
}): JSX.Element | null {
  if (!files.length) return null;
  return (
    <div className="mb-3">
      <div className="text-xs text-slate-400 mb-1">{title}</div>
      <ul className="space-y-1 text-xs">
        {files.slice(0, 5).map((f) => (
          <li key={f} className="flex items-center justify-between bg-slate-900/60 px-3 py-2 rounded">
            <span className="font-mono truncate">{f.split('/').slice(-1)[0]}</span>
            <button
              onClick={() => onRestore(f)}
              className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-xs"
            >
              还原
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
