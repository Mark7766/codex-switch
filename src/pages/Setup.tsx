import { useEffect, useState } from 'react';
import { useAppStore } from '../lib/store';

/**
 * 首次启动向导（v3.0.0 改为注册表驱动）。
 *
 * 此前这里是**唯一漏掉泛型化的页面**：供应商、模型列表、Key 前缀全部硬编码成 DeepSeek，
 * 结果新装用户根本没法在向导里选智谱 GLM —— 只能先进设置页再改。现在与设置页同源，
 * 都读 `getProviders()`。
 */
export function Setup(): JSX.Element {
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [providerId, setProviderId] = useState<ProviderDescriptor['id']>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setPage = useAppStore((s) => s.setPage);

  useEffect(() => {
    void (async () => {
      const list = await window.codexSwitch.getProviders();
      setProviders(list);
      if (list.length === 0) return;
      setProviderId(list[0]!.id);
      setModel(list[0]!.codex.defaultModel);
    })();
  }, []);

  const descriptor = providers.find((p) => p.id === providerId);
  const models = descriptor?.codex.models ?? [];

  function switchProvider(id: ProviderDescriptor['id']): void {
    setProviderId(id);
    setError(null);
    const next = providers.find((p) => p.id === id);
    if (next) setModel(next.codex.defaultModel);
  }

  async function onFinish(): Promise<void> {
    setError(null);
    if (!descriptor) return;
    // Key 校验规则来自注册表（此前硬编码 DeepSeek 的 sk- 前缀）
    const raw = apiKey.trim();
    if (raw.length < descriptor.key.minLength) {
      setError(
        `${descriptor.label} API Key 长度至少 ${descriptor.key.minLength} 位，请检查后重试。`,
      );
      return;
    }
    if (descriptor.key.prefix && !raw.startsWith(descriptor.key.prefix)) {
      setError(
        `${descriptor.label} API Key 通常以 "${descriptor.key.prefix}" 开头，请检查后重试。`,
      );
      return;
    }
    setBusy(true);
    try {
      // v3.0.0: 不再有「启动代理」这一步（本地代理已删除）；applyPreferences 会顺手写好 ~/.codex
      await window.codexSwitch.setKey(descriptor.id, raw);
      await window.codexSwitch.applyPreferences({
        provider: descriptor.id,
        defaultModel: model,
        hasCompletedSetup: true,
      });
      setPage('settings');
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
        三步搞定 Codex CLI / Codex Desktop：选供应商 → 填密钥 → 选模型。 之后可在「设置」里接入
        Claude，或随时切换供应商。
      </p>

      <div className="space-y-6 bg-slate-800/50 rounded-xl p-6">
        <Field
          label="① 使用哪家供应商"
          hint="想接 DeepSeek / 智谱 GLM / 自定义兼容服务，都从这里选。"
        >
          <div className="grid grid-cols-1 gap-3">
            {providers.map((p) => (
              <ModelOption
                key={p.id}
                active={providerId === p.id}
                onClick={() => switchProvider(p.id)}
                title={p.label}
              />
            ))}
          </div>
        </Field>

        {descriptor && (
          <Field label={`② 你的 ${descriptor.label} API Key`} hint={descriptor.key.hint}>
            <input
              type="password"
              placeholder={descriptor.key.placeholder}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-md text-sm focus:outline-none focus:border-brand-500"
            />
          </Field>
        )}

        <Field label="③ 默认使用哪个模型" hint="后续可在「设置」中随时切换。">
          <div className="grid grid-cols-1 gap-3">
            {models.map((m) => (
              <ModelOption key={m} active={model === m} onClick={() => setModel(m)} title={m} />
            ))}
          </div>
        </Field>

        {error && (
          <div className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <button
          onClick={onFinish}
          disabled={busy || !descriptor}
          className="w-full bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 transition rounded-md py-2.5 text-sm font-medium"
        >
          {busy ? '正在写入配置…' : '完成并应用配置'}
        </button>

        <p className="text-xs text-slate-500 leading-relaxed">
          完成后 Codex CLI / Desktop 会直连该供应商的官方端点。 原有{' '}
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
}

function ModelOption({ active, onClick, title }: ModelOptionProps): JSX.Element {
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
    </button>
  );
}
