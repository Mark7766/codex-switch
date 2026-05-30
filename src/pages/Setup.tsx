import { useState } from 'react';
import { useAppStore } from '../lib/store';

export function Setup(): JSX.Element {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<'deepseek-v4-flash' | 'deepseek-v4-pro'>('deepseek-v4-flash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setPage = useAppStore((s) => s.setPage);

  async function onFinish(): Promise<void> {
    setError(null);
    if (!apiKey.trim().startsWith('sk-')) {
      setError('DeepSeek API Key 通常以 "sk-" 开头，请检查后重试。');
      return;
    }
    setBusy(true);
    try {
      await window.codexSwitch.setApiKey(apiKey.trim());
      await window.codexSwitch.setPreferences({ defaultModel: model, hasCompletedSetup: true });
      const startInfo = await window.codexSwitch.proxyStart();
      await window.codexSwitch.codexWrite({ model });
      void startInfo;
      setPage('dashboard');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto p-10">
      <h1 className="text-2xl font-semibold mb-2">欢迎使用 Codex Switch 👋</h1>
      <p className="text-slate-400 mb-8">
        三步搞定 Codex CLI / Codex Desktop 连接 DeepSeek：填密钥 → 选模型 → 点完成。
      </p>

      <div className="space-y-6 bg-slate-800/50 rounded-xl p-6">
        <Field
          label="① 你的 DeepSeek API Key"
          hint="可在 DeepSeek 控制台 https://platform.deepseek.com/api_keys 创建；只会保存在本机系统钥匙串。"
        >
          <input
            type="password"
            placeholder="sk-xxxxxxxxxxxxxxxx"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-md text-sm focus:outline-none focus:border-brand-500"
          />
        </Field>

        <Field label="② 默认使用哪个 DeepSeek 模型" hint="后续可在「设置」中随时切换。">
          <div className="grid grid-cols-2 gap-3">
            <ModelOption
              active={model === 'deepseek-v4-flash'}
              onClick={() => setModel('deepseek-v4-flash')}
              title="DeepSeek V4 Flash"
              subtitle="快、稳，推荐日常使用"
            />
            <ModelOption
              active={model === 'deepseek-v4-pro'}
              onClick={() => setModel('deepseek-v4-pro')}
              title="DeepSeek V4 Pro"
              subtitle="更强，适合复杂任务"
            />
          </div>
        </Field>

        {error && (
          <div className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <button
          onClick={onFinish}
          disabled={busy}
          className="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 transition rounded-md py-2.5 text-sm font-medium"
        >
          {busy ? '正在启动…' : '③ 完成并启动代理'}
        </button>

        <p className="text-xs text-slate-500 leading-relaxed">
          完成后 Codex CLI / Desktop 会自动指向本地代理（127.0.0.1:11435）。 原有{' '}
          <code className="text-slate-300">~/.codex/config.toml</code> 与{' '}
          <code className="text-slate-300">~/.codex/auth.json</code>{' '}
          会先备份再覆盖，你随时可以在「设置」里一键还原。
        </p>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps): JSX.Element {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      {hint && <p className="text-xs text-slate-400 mb-2">{hint}</p>}
      {children}
    </div>
  );
}

interface ModelOptionProps {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}

function ModelOption({ active, onClick, title, subtitle }: ModelOptionProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg p-3 border transition ${
        active
          ? 'bg-brand-600/15 border-brand-500'
          : 'bg-slate-900 border-slate-700 hover:border-slate-500'
      }`}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>
    </button>
  );
}
