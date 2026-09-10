import { useEffect, useState } from 'react';
import { ChangelogModal } from '../components/ChangelogModal';
import { ModelMappingModal } from '../components/ModelMappingModal';
import { useAppStore } from '@/lib/store';
import { foldModel, foldModelMap } from '@/lib/model-fold';

type ProviderId = 'deepseek' | 'glm' | 'custom';

/**
 * 设置页（v3.0.0 重写）。
 *
 * 原先是每个供应商各写一遍：下拉选项、Key 输入框、保存处理器、模型列表、档位默认值——
 * 同一份事实在同一个文件里最多出现五遍（并已因此产生过措辞漂移）。现在全部由
 * `electron/config/providers.ts` 的注册表经 `getProviders()` 下发，页面只负责渲染。
 */
export function Settings(): JSX.Element {
  const pushToast = useAppStore((s) => s.pushToast);

  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [version, setVersion] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  // 供应商选择（每个工具独立）
  const [keyEditorProvider, setKeyEditorProvider] = useState<ProviderId>('deepseek');
  const [codexProvider, setCodexProvider] = useState<ProviderId>('deepseek');
  const [claudeDesktopProvider, setClaudeDesktopProvider] = useState<ProviderId>('deepseek');
  const [claudeCliProvider, setClaudeCliProvider] = useState<ProviderId>('deepseek');

  // Key（按供应商索引）
  const [maskedKeys, setMaskedKeys] = useState<Record<string, string>>({});
  const [keyInput, setKeyInput] = useState('');

  // Codex
  const [defaultModel, setDefaultModel] = useState('deepseek-flash');
  const [customModel, setCustomModel] = useState('');

  // 自定义供应商端点
  const [customCodexBaseUrl, setCustomCodexBaseUrl] = useState('');
  const [customClaudeBaseUrl, setCustomClaudeBaseUrl] = useState('');

  // Claude 模型映射
  const [showDesktopMapping, setShowDesktopMapping] = useState(false);
  const [showCliMapping, setShowCliMapping] = useState(false);
  const [desktopMapping, setDesktopMapping] = useState<Record<string, string>>({});
  const [cliMapping, setCliMapping] = useState<Record<string, string>>({});

  // 备份 / 更新 / 遥测
  const [hasOriginalBak, setHasOriginalBak] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [autoCheckUpdate, setAutoCheckUpdate] = useState(true);
  const [autoDownload, setAutoDownload] = useState(true);
  const [mirror, setMirror] = useState<'server' | 'github' | 'ghproxy' | 'custom'>('server');
  const [customMirror, setCustomMirror] = useState('');
  const [telemetryEnabled, setTelemetryEnabled] = useState(true);
  const [showChangelog, setShowChangelog] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  const byId = (id: string): ProviderDescriptor | undefined => providers.find((p) => p.id === id);
  /**
   * 持久化配置里可能残留已移除的供应商（如 agnes）——回落到列表首个，避免下拉空白或崩溃。
   * 这是**读时归一化**：不写回存储，只有用户自己重新选择并保存时才会落盘。
   */
  const providerOf = (id: unknown): ProviderId => {
    const hit = providers.find((p) => p.id === id);
    return hit?.id ?? providers[0]?.id ?? 'deepseek';
  };

  useEffect(() => {
    (async () => {
      const [list, prefs] = await Promise.all([
        window.codexSwitch.getProviders(),
        window.codexSwitch.getPreferences(),
      ]);
      setProviders(list);

      const idIn = (list2: ProviderDescriptor[], id: unknown): ProviderId =>
        list2.find((p) => p.id === id)?.id ?? list2[0]?.id ?? 'deepseek';
      const codex = idIn(list, prefs.provider);
      const desktop = idIn(list, prefs.claudeDesktopProvider ?? prefs.provider);
      const cli = idIn(list, prefs.claudeCliProvider ?? prefs.provider);
      setCodexProvider(codex);
      setClaudeDesktopProvider(desktop);
      setClaudeCliProvider(cli);
      setKeyEditorProvider(codex);

      // Key 掩码：按供应商逐个取
      const masked: Record<string, string> = {};
      for (const p of list) masked[p.id] = await window.codexSwitch.getKey(p.id);
      setMaskedKeys(masked);

      // Codex 模型：残留的旧名折叠为新名（仅改显示）
      setDefaultModel(foldModel(prefs.defaultModel, list.find((p) => p.id === codex) ?? null));

      // Claude 映射：从持久化恢复，并折叠旧名（仅 deepseek 声明了折叠规则）
      const desktopDesc = list.find((p) => p.id === desktop) ?? null;
      const cliDesc = list.find((p) => p.id === cli) ?? null;
      const cliVars = prefs.claudeCli?.envVars;
      if (cliVars?.anthropicModel && cliDesc) {
        setCliMapping(
          foldModelMap(
            {
              'claude-opus-4-7': cliVars.anthropicDefaultOpusModel ?? cliVars.anthropicModel,
              'claude-sonnet-4-6': cliVars.anthropicDefaultSonnetModel ?? cliVars.anthropicModel,
              'claude-haiku-4-5': cliVars.anthropicDefaultHaikuModel ?? cliVars.anthropicModel,
            },
            cliDesc,
          ),
        );
      }
      const dm = prefs.claudeDesktop?.modelMap;
      if (dm && Object.keys(dm).length > 0) setDesktopMapping(foldModelMap(dm, desktopDesc));

      setCustomCodexBaseUrl(prefs.customProvider?.codexBaseUrl ?? '');
      setCustomClaudeBaseUrl(prefs.customProvider?.claudeBaseUrl ?? '');
      setVersion(await window.codexSwitch.getVersion());
      setAutoCheckUpdate(prefs.autoCheckUpdate);
      setAutoDownload(prefs.autoDownload ?? true);
      setMirror(prefs.updateMirror);
      setCustomMirror(prefs.customMirrorUrl);
      setTelemetryEnabled(prefs.telemetryEnabled ?? true);
      try {
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

  /** 保存当前编辑中的供应商 Key（懒初始化：切供应商时刷新掩码）。 */
  async function saveKey(): Promise<void> {
    const descriptor = byId(keyEditorProvider);
    if (!descriptor) return;
    setSavingKey(true);
    try {
      await window.codexSwitch.setKey(descriptor.id, keyInput.trim());
      const masked = await window.codexSwitch.getKey(descriptor.id);
      setMaskedKeys((m) => ({ ...m, [descriptor.id]: masked }));
      setKeyInput('');
      pushToast({ kind: 'success', message: `已更新 ${descriptor.label} Key` });
    } catch (e) {
      pushToast({ kind: 'error', message: '保存 Key 失败：' + (e as Error).message });
    } finally {
      setSavingKey(false);
    }
  }

  /** Codex 卡片：保存并可应用（写 ~/.codex）。 */
  async function saveCodex(): Promise<void> {
    const descriptor = byId(codexProvider);
    if (!descriptor) return;
    if (defaultModel === '__custom__' && !customModel.trim()) {
      pushToast({ kind: 'info', message: '请填写要使用的自定义模型名' });
      return;
    }
    if (!maskedKeys[descriptor.id]) {
      pushToast({ kind: 'info', message: `请先在「供应商设置」中配置 ${descriptor.label} Key` });
      return;
    }
    if (descriptor.codex.baseUrl === 'custom' && !customCodexBaseUrl.trim()) {
      pushToast({ kind: 'info', message: '请先填写 Codex Base URL' });
      return;
    }
    try {
      await window.codexSwitch.applyPreferences({
        provider: descriptor.id,
        defaultModel: defaultModel === '__custom__' ? customModel.trim() : defaultModel,
        codexModel: defaultModel === '__custom__' ? customModel.trim() : defaultModel,
        customProvider: { codexBaseUrl: customCodexBaseUrl, claudeBaseUrl: customClaudeBaseUrl },
      });
      setMsg('已保存并写入 Codex 配置（重启 Codex 生效）');
      pushToast({ kind: 'success', message: '已保存并写入 Codex 配置' });
    } catch (e) {
      pushToast({ kind: 'error', message: '保存失败：' + (e as Error).message });
    }
  }

  /**
   * Claude 卡片保存。两个工具走同一段逻辑——原先这段含 4 家供应商校验的代码被复制了两遍。
   * CLI 额外把「槽位 → 模型」映射折算成 envVars（主对话跟随 Sonnet、子代理跟随 Haiku）。
   */
  async function saveClaude(tool: 'desktop' | 'cli'): Promise<void> {
    const providerId = tool === 'desktop' ? claudeDesktopProvider : claudeCliProvider;
    const descriptor = byId(providerId);
    if (!descriptor) return;
    const mapping = tool === 'desktop' ? desktopMapping : cliMapping;

    if (!maskedKeys[descriptor.id]) {
      pushToast({ kind: 'info', message: `请先在「供应商设置」中配置 ${descriptor.label} Key` });
      return;
    }
    if (descriptor.claude.baseUrl === 'custom' && !customClaudeBaseUrl.trim()) {
      pushToast({ kind: 'info', message: '请先填写 Claude Base URL' });
      return;
    }

    const roles = descriptor.claude.roleDefaults;
    const modelFor = (tier: 'opus' | 'sonnet' | 'haiku'): string => {
      const slot = descriptor.claude.slots.find((s) => s.tier === tier);
      return (slot && mapping[slot.id]) || roles[tier];
    };

    try {
      if (tool === 'desktop') {
        await window.codexSwitch.setPreferences({
          claudeDesktopProvider: descriptor.id,
          claudeDesktop: { enabled: true, modelMap: mapping },
          customProvider: { codexBaseUrl: customCodexBaseUrl, claudeBaseUrl: customClaudeBaseUrl },
        });
      } else {
        await window.codexSwitch.setPreferences({
          claudeCliProvider: descriptor.id,
          claudeCli: {
            enabled: true,
            envVars: {
              anthropicModel: modelFor('sonnet'),
              anthropicDefaultOpusModel: modelFor('opus'),
              anthropicDefaultSonnetModel: modelFor('sonnet'),
              anthropicDefaultHaikuModel: modelFor('haiku'),
              claudeCodeSubagentModel: modelFor('haiku'),
            },
          },
          customProvider: { codexBaseUrl: customCodexBaseUrl, claudeBaseUrl: customClaudeBaseUrl },
        });
      }
      await window.codexSwitch.claudeApplyAll();
      pushToast({
        kind: 'success',
        message:
          tool === 'desktop'
            ? '已保存 Claude Desktop 配置（重启应用生效）'
            : '已保存 Claude Code CLI 配置，新终端窗口生效',
      });
    } catch (e) {
      pushToast({ kind: 'error', message: '保存失败：' + (e as Error).message });
    }
  }

  async function checkUpdate(): Promise<void> {
    setUpdateMsg('正在检查…');
    try {
      await window.codexSwitch.updateCheck();
    } catch {
      setUpdateMsg('检查失败');
    }
  }

  const keyDescriptor = byId(keyEditorProvider);
  const codexDescriptor = byId(codexProvider);
  const codexModels = codexDescriptor?.codex.models ?? [];

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">设置</h1>

      {/* ── 供应商设置：一处管理所有供应商的 Key ───────────────────────── */}
      <Section title="🔑 供应商设置">
        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between">
            <span>供应商</span>
            <select
              value={keyEditorProvider}
              onChange={(e) => {
                setKeyEditorProvider(providerOf(e.target.value));
                setKeyInput('');
              }}
              className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          {codexProvider === 'custom' && (
            <>
              <label className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Codex Base URL</span>
                <input
                  value={customCodexBaseUrl}
                  onChange={(e) => setCustomCodexBaseUrl(e.target.value)}
                  placeholder="例如 https://api.example.com/v1"
                  className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md text-sm w-[280px]"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Claude Base URL</span>
                <input
                  value={customClaudeBaseUrl}
                  onChange={(e) => setCustomClaudeBaseUrl(e.target.value)}
                  placeholder="例如 https://api.example.com"
                  className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md text-sm w-[280px]"
                />
              </label>
            </>
          )}

          {keyDescriptor && (
            <>
              <div className="text-xs text-slate-400">
                当前 Key：
                <span className="font-mono text-slate-300">
                  {maskedKeys[keyDescriptor.id] || '（未设置）'}
                </span>
              </div>
              <label className="flex items-center justify-between gap-2">
                <span className="flex-shrink-0">{keyDescriptor.label} API Key</span>
                <input
                  type="password"
                  placeholder={keyDescriptor.key.placeholder}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md text-sm w-[280px]"
                />
              </label>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">{keyDescriptor.key.hint}</span>
                <button
                  onClick={saveKey}
                  disabled={savingKey || !keyInput.trim()}
                  className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 rounded text-xs"
                >
                  保存 Key
                </button>
              </div>
            </>
          )}
        </div>
      </Section>

      {/* ── Codex 接入 ──────────────────────────────────────────────────── */}
      <Section title={`📟 Codex 接入${codexDescriptor ? ` · ${codexDescriptor.label}` : ''}`}>
        <div className="space-y-3 text-sm">
          <ProviderPicker
            value={codexProvider}
            providers={providers}
            onChange={(id) => {
              setCodexProvider(id);
              const d = byId(id);
              if (d) setDefaultModel(d.codex.defaultModel);
            }}
          />
          <label className="flex items-center justify-between">
            <span>默认模型</span>
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md max-w-[240px]"
            >
              {codexModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              {/* 自定义端点才允许手填模型名 */}
              {codexDescriptor?.codex.baseUrl === 'custom' && (
                <>
                  <option disabled>──</option>
                  <option value="__custom__">✏️ 自定义模型…</option>
                </>
              )}
            </select>
          </label>
          {defaultModel === '__custom__' && (
            <label className="flex items-center justify-between">
              <span className="text-xs text-slate-400">输入模型名</span>
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="例如：gpt-5.5"
                className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md text-sm w-[240px]"
              />
            </label>
          )}

          {hasOriginalBak && (
            <div className="border-t border-slate-700 pt-3">
              <button
                onClick={async () => {
                  try {
                    await window.codexSwitch.codexRestoreOriginal();
                    setHasOriginalBak(false);
                    pushToast({ kind: 'success', message: '已还原为 OpenAI 官方配置' });
                  } catch (e) {
                    pushToast({ kind: 'error', message: '还原失败：' + (e as Error).message });
                  }
                }}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs"
              >
                切换到 OpenAI 官方
              </button>
              <span className="text-xs text-slate-500 ml-2">
                Codex 改回用 OpenAI 官方；已接入的供应商配置会保留（历史对话需要它）
              </span>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              onClick={saveCodex}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 rounded-md text-sm"
            >
              保存并应用
            </button>
            <span className="text-xs text-slate-500">重启 Codex 后生效</span>
          </div>
        </div>
      </Section>

      {/* ── Claude Desktop 接入 ────────────────────────────────────────── */}
      <Section
        title={`🖥 Claude Desktop 接入${byId(claudeDesktopProvider) ? ` · ${byId(claudeDesktopProvider)!.label}` : ''}`}
      >
        <div className="space-y-3 text-sm">
          <ProviderPicker
            value={claudeDesktopProvider}
            providers={providers}
            onChange={(id) => {
              setClaudeDesktopProvider(id);
              setDesktopMapping({});
            }}
          />
          <MappingRow
            mapping={desktopMapping}
            descriptor={byId(claudeDesktopProvider)}
            onOpen={() => setShowDesktopMapping(true)}
          />
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => saveClaude('desktop')}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 rounded-md text-sm"
            >
              保存并应用
            </button>
            <span className="text-xs text-slate-500">重启 Claude Desktop 生效</span>
          </div>
        </div>
      </Section>

      {/* ── Claude Code CLI 接入 ───────────────────────────────────────── */}
      <Section
        title={`⌨️ Claude Code CLI 接入${byId(claudeCliProvider) ? ` · ${byId(claudeCliProvider)!.label}` : ''}`}
      >
        <div className="space-y-3 text-sm">
          <ProviderPicker
            value={claudeCliProvider}
            providers={providers}
            onChange={(id) => {
              setClaudeCliProvider(id);
              setCliMapping({});
            }}
          />
          <MappingRow
            mapping={cliMapping}
            descriptor={byId(claudeCliProvider)}
            onOpen={() => setShowCliMapping(true)}
          />
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => saveClaude('cli')}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 rounded-md text-sm"
            >
              保存并应用
            </button>
            <span className="text-xs text-slate-500">新终端窗口生效</span>
          </div>
        </div>
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
                setMirror(e.target.value as 'server' | 'github' | 'ghproxy' | 'custom')
              }
              className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md"
            >
              <option value="server">官方服务器（推荐）</option>
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
            只上报「哪些配置项被写入」这类操作计数（例如「写入了 Codex 配置」），
            用于判断功能是否被用上。
            <span className="text-slate-500">
              不上报对话内容、文件路径、报错原文、 API Key，也不上报任何可识别你身份或设备的标识符。
            </span>
            仅在有网络连接时上传。
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
      {/* v3.0.0: 两个 Claude 工具共用同一个注册表驱动的映射弹窗 */}
      <ModelMappingModal
        open={showDesktopMapping}
        onClose={() => setShowDesktopMapping(false)}
        descriptor={byId(claudeDesktopProvider) ?? null}
        mapping={desktopMapping}
        onSave={setDesktopMapping}
      />
      <ModelMappingModal
        open={showCliMapping}
        onClose={() => setShowCliMapping(false)}
        descriptor={byId(claudeCliProvider) ?? null}
        mapping={cliMapping}
        onSave={setCliMapping}
      />
    </div>
  );
}

/** 供应商下拉——原先在四处各写一份（且措辞曾漂移）。 */
function ProviderPicker({
  value,
  providers,
  onChange,
}: {
  value: string;
  providers: ProviderDescriptor[];
  onChange: (id: ProviderId) => void;
}): JSX.Element {
  return (
    <label className="flex items-center justify-between">
      <span>供应商</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ProviderId)}
        className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md"
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 「管理模型映射…」按钮 + 当前映射摘要。 */
function MappingRow({
  mapping,
  descriptor,
  onOpen,
}: {
  mapping: Record<string, string>;
  descriptor?: ProviderDescriptor;
  onOpen: () => void;
}): JSX.Element {
  const roles = descriptor?.claude.roleDefaults;
  const pick = (tier: 'opus' | 'sonnet' | 'haiku'): string => {
    const slot = descriptor?.claude.slots.find((s) => s.tier === tier);
    return (slot && mapping[slot.id]) || roles?.[tier] || '—';
  };
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-400">
        Opus → {pick('opus')} · Sonnet → {pick('sonnet')} · Haiku → {pick('haiku')}
      </span>
      <button
        onClick={onOpen}
        className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs"
      >
        管理模型映射…
      </button>
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
