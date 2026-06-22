import { useEffect, useState } from 'react';
import { ChangelogModal } from '../components/ChangelogModal';
import { ModelMappingModal } from '../components/ModelMappingModal';
import { useAppStore } from '@/lib/store';

export function Settings(): JSX.Element {
  const pushToast = useAppStore((s) => s.pushToast);
  const [savingKey, setSavingKey] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [provider, setProvider] = useState<'deepseek' | 'agnes' | 'glm' | 'packycode'>('deepseek');
  const [codexProvider, setCodexProvider] = useState<'deepseek' | 'agnes' | 'glm' | 'packycode'>(
    'deepseek',
  );
  const [maskedKey, setMaskedKey] = useState('');
  const [newKey, setNewKey] = useState('');
  const [maskedAgnesKey, setMaskedAgnesKey] = useState('');
  const [newAgnesKey, setNewAgnesKey] = useState('');
  const [maskedGlmKey, setMaskedGlmKey] = useState('');
  const [newGlmKey, setNewGlmKey] = useState('');
  const [maskedPackyCodeKey, setMaskedPackyCodeKey] = useState('');
  const [newPackyCodeKey, setNewPackyCodeKey] = useState('');
  const [port, setPort] = useState(11435);
  const [defaultModel, setDefaultModel] = useState('deepseek-v4-flash');
  const [customModel, setCustomModel] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [, setBackups] = useState<{ config: string[]; auth: string[] }>({
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
  // Claude Desktop / CLI provider (independent from Codex)
  const [claudeDesktopProvider, setClaudeDesktopProvider] = useState<
    'deepseek' | 'agnes' | 'glm' | 'packycode'
  >('deepseek');
  const [claudeCliProvider, setClaudeCliProvider] = useState<
    'deepseek' | 'agnes' | 'glm' | 'packycode'
  >('deepseek');
  const [showDesktopMapping, setShowDesktopMapping] = useState(false);
  const [showCliMapping, setShowCliMapping] = useState(false);
  const [desktopMapping, setDesktopMapping] = useState<Record<string, string>>({});
  const [cliMapping, setCliMapping] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const prefs = await window.codexSwitch.getPreferences();
      setPort(prefs.proxyPort);
      setDefaultModel(prefs.defaultModel);
      setAutoStart(prefs.autoStartProxy);
      setProvider(prefs.provider ?? 'deepseek');
      setCodexProvider(prefs.provider ?? 'deepseek');
      setClaudeDesktopProvider(prefs.claudeDesktopProvider ?? prefs.provider ?? 'deepseek');
      setClaudeCliProvider(prefs.claudeCliProvider ?? prefs.provider ?? 'deepseek');
      // 从持久化的 envVars / modelMap 恢复模型映射，修复页面切换后重置为默认值
      const cliVars = prefs.claudeCli?.envVars;
      if (cliVars?.anthropicModel) {
        setCliMapping({
          'claude-opus-4-7': cliVars.anthropicDefaultOpusModel ?? cliVars.anthropicModel,
          'claude-sonnet-4-6': cliVars.anthropicDefaultSonnetModel ?? cliVars.anthropicModel,
          'claude-haiku-4-5': cliVars.anthropicDefaultHaikuModel ?? cliVars.anthropicModel,
        });
      }
      const dm = prefs.claudeDesktop?.modelMap;
      if (dm && Object.keys(dm).length > 0) setDesktopMapping({ ...dm });
      setMaskedKey(await window.codexSwitch.getApiKey());
      setMaskedAgnesKey(await window.codexSwitch.getAgnesKey());
      setMaskedGlmKey(await window.codexSwitch.getGlmKey());
      setMaskedPackyCodeKey(await window.codexSwitch.getPackyCodeKey());
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

  async function saveAgnesKey(): Promise<void> {
    setSavingKey(true);
    try {
      await window.codexSwitch.setAgnesKey(newAgnesKey.trim());
      setMaskedAgnesKey(await window.codexSwitch.getAgnesKey());
      setNewAgnesKey('');
      pushToast({ kind: 'success', message: '已更新 Agnes Key' });
    } catch (e) {
      pushToast({ kind: 'error', message: '保存 Key 失败：' + (e as Error).message });
    } finally {
      setSavingKey(false);
    }
  }

  async function saveGlmKey(): Promise<void> {
    setSavingKey(true);
    try {
      await window.codexSwitch.setGlmKey(newGlmKey.trim());
      setMaskedGlmKey(await window.codexSwitch.getGlmKey());
      setNewGlmKey('');
      pushToast({ kind: 'success', message: '已更新 GLM Key' });
    } catch (e) {
      pushToast({ kind: 'error', message: '保存 Key 失败：' + (e as Error).message });
    } finally {
      setSavingKey(false);
    }
  }

  async function savePackyCodeKey(): Promise<void> {
    setSavingKey(true);
    try {
      await window.codexSwitch.setPackyCodeKey(newPackyCodeKey.trim());
      setMaskedPackyCodeKey(await window.codexSwitch.getPackyCodeKey());
      setNewPackyCodeKey('');
      pushToast({ kind: 'success', message: '已更新 PackyCode Key' });
    } catch (e) {
      pushToast({ kind: 'error', message: '保存 Key 失败：' + (e as Error).message });
    } finally {
      setSavingKey(false);
    }
  }

  async function savePrefs(): Promise<void> {
    if (defaultModel === '__custom__' && !customModel.trim()) {
      pushToast({ kind: 'info', message: '请输入自定义模型名' });
      return;
    }
    setSavingPrefs(true);
    pushToast({ kind: 'info', message: '正在保存并应用…' });
    try {
      const res = await window.codexSwitch.applyPreferences({
        proxyPort: port,
        defaultModel: defaultModel === '__custom__' ? customModel.trim() : defaultModel,
        provider: codexProvider,
        autoStartProxy: autoStart,
        autoCheckUpdate,
        autoDownload,
        updateMirror: mirror,
        customMirrorUrl: customMirror,
        maxBackupsPerFile: maxBackups,
        blockBackgroundSuggestions: blockSuggestions,
        telemetryEnabled,
        codexModel: defaultModel === '__custom__' ? customModel.trim() : defaultModel,
      });
      await window.codexSwitch.updateSetMirror(mirror, customMirror);
      setBackups(await window.codexSwitch.codexBackups());
      const tail = res.restarted
        ? '，已重启代理'
        : res.codexWritten
          ? '，已写入 ~/.codex/config.toml'
          : '';
      pushToast({ kind: 'success', message: '已保存并应用' + tail });
      if (res.codexWritten) {
        pushToast({
          kind: 'info',
          message: '配置文件已更新，请重启 Codex Desktop（退出后重新打开）使配置生效。',
        });
      }
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

      <Section title="🔑 供应商设置">
        <label className="flex items-center justify-between text-sm mb-3">
          <span>选择供应商</span>
          <select
            value={provider}
            onChange={(e) =>
              setProvider(e.target.value as 'deepseek' | 'agnes' | 'glm' | 'packycode')
            }
            className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md"
          >
            <option value="deepseek">DeepSeek</option>
            <option value="agnes">Agnes AI</option>
            <option value="glm">智谱 GLM</option>
            <option value="packycode">PackyCode · 直连</option>{' '}
          </select>
        </label>
        <div className="border-t border-slate-700 pt-3">
          {provider === 'deepseek' ? (
            <>
              <div className="text-sm text-slate-400 mb-2">
                DeepSeek Key：<code className="text-slate-200">{maskedKey || '尚未设置'}</code>
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
              <div className="text-xs text-slate-500 mt-2">
                在 platform.deepseek.com 获取 API Key
              </div>
            </>
          ) : provider === 'agnes' ? (
            <>
              <div className="text-sm text-slate-400 mb-2">
                Agnes Key：<code className="text-slate-200">{maskedAgnesKey || '尚未设置'}</code>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="Agnes API Key"
                  value={newAgnesKey}
                  onChange={(e) => setNewAgnesKey(e.target.value)}
                  className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-md text-sm"
                />
                <button
                  onClick={saveAgnesKey}
                  disabled={savingKey || !newAgnesKey.trim()}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-md text-sm min-w-[80px]"
                >
                  {savingKey ? '保存中…' : '保存'}
                </button>
              </div>
              <div className="text-xs text-slate-500 mt-2">
                在 platform.agnes-ai.com 获取 API Key
              </div>
            </>
          ) : provider === 'glm' ? (
            <>
              <div className="text-sm text-slate-400 mb-2">
                GLM Key：<code className="text-slate-200">{maskedGlmKey || '尚未设置'}</code>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="智谱 GLM API Key"
                  value={newGlmKey}
                  onChange={(e) => setNewGlmKey(e.target.value)}
                  className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-md text-sm"
                />
                <button
                  onClick={saveGlmKey}
                  disabled={savingKey || !newGlmKey.trim()}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-md text-sm min-w-[80px]"
                >
                  {savingKey ? '保存中…' : '保存'}
                </button>
              </div>
              <div className="text-xs text-slate-500 mt-2">
                在 open.bigmodel.cn 或 z.ai 获取 API Key
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-slate-400 mb-2">
                PackyCode Key：
                <code className="text-slate-200">{maskedPackyCodeKey || '尚未设置'}</code>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="PackyCode API Key"
                  value={newPackyCodeKey}
                  onChange={(e) => setNewPackyCodeKey(e.target.value)}
                  className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-md text-sm"
                />
                <button
                  onClick={savePackyCodeKey}
                  disabled={savingKey || !newPackyCodeKey.trim()}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-md text-sm min-w-[80px]"
                >
                  {savingKey ? '保存中…' : '保存'}
                </button>
              </div>
              <div className="text-xs text-slate-500 mt-2">在 packyapi.com 注册获取 API Key</div>
            </>
          )}
        </div>
      </Section>

      <Section
        title={`📟 Codex 接入 · ${
          codexProvider === 'deepseek'
            ? 'DeepSeek'
            : codexProvider === 'agnes'
              ? 'Agnes'
              : codexProvider === 'glm'
                ? 'GLM'
                : 'PackyCode'
        }`}
      >
        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between">
            <span>供应商</span>
            <select
              value={codexProvider}
              onChange={(e) => {
                const p = e.target.value as 'deepseek' | 'agnes' | 'glm' | 'packycode';
                setCodexProvider(p);
                // v1.15.0 PackyCode: 切换时重置模型映射
                setDefaultModel(
                  p === 'agnes'
                    ? 'agnes-2.0-flash'
                    : p === 'glm'
                      ? 'glm-5.2'
                      : p === 'packycode'
                        ? 'gpt-5.5'
                        : 'deepseek-v4-flash',
                );
              }}
              className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md"
            >
              <option value="deepseek">DeepSeek</option>
              <option value="agnes">Agnes AI</option>
              <option value="glm">智谱 GLM</option>
              <option value="packycode">PackyCode · 直连</option>{' '}
            </select>
          </label>
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
              onChange={(e) => setDefaultModel(e.target.value)}
              className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md max-w-[220px]"
            >
              {codexProvider === 'glm' ? (
                <>
                  <option value="glm-5.2">GLM-5.2 (glm-5.2)</option>
                  <option value="glm-5.1">GLM-5.1 (glm-5.1)</option>
                  <option value="glm-4.7">GLM-4.7 (glm-4.7)</option>
                </>
              ) : codexProvider === 'agnes' ? (
                <>
                  <option value="agnes-2.0-flash">Agnes 2.0 Flash (agnes-2.0-flash)</option>
                  <option value="agnes-1.5-flash">Agnes 1.5 Flash (agnes-1.5-flash)</option>
                </>
              ) : codexProvider === 'packycode' ? (
                <>
                  <option value="gpt-5.5">GPT-5.5</option>
                  <option value="gpt-5.4">GPT-5.4</option>
                  <option value="gpt-5.4-high">GPT-5.4 High</option>
                  <option value="gpt-5.4-mini">GPT-5.4 Mini</option>
                  <option value="codex-auto-review">Codex Auto Review</option>
                  <option disabled>──</option>
                  <option value="__custom__">✏️ 自定义模型…</option>
                </>
              ) : (
                <>
                  <option value="deepseek-v4-flash">DeepSeek V4 Flash (deepseek-v4-flash)</option>
                  <option value="deepseek-v4-pro">DeepSeek V4 Pro (deepseek-v4-pro)</option>
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
                className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md text-sm w-[220px]"
              />
            </label>
          )}
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

      {/* ── Claude Desktop 接入 ── */}
      <Section
        title={`🖥 Claude Desktop 接入 · ${
          claudeDesktopProvider === 'deepseek'
            ? 'DeepSeek'
            : claudeDesktopProvider === 'agnes'
              ? 'Agnes'
              : claudeDesktopProvider === 'glm'
                ? 'GLM'
                : 'PackyCode'
        }`}
      >
        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between">
            <span>供应商</span>
            <select
              value={claudeDesktopProvider}
              onChange={(e) => {
                setClaudeDesktopProvider(
                  e.target.value as 'deepseek' | 'agnes' | 'glm' | 'packycode',
                );
                setDesktopMapping({}); // 切换供应商时重置模型映射，使用新供应商默认值
              }}
              className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md"
            >
              <option value="deepseek">DeepSeek · 直连</option>
              <option value="agnes">Agnes AI</option>
              <option value="glm">智谱 GLM · 直连</option>
              <option value="packycode">PackyCode · 直连</option>{' '}
            </select>
          </label>
          <label className="flex items-center justify-between">
            <span>模型映射</span>
            <button
              onClick={() => setShowDesktopMapping(true)}
              className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded"
            >
              管理模型映射…
            </button>
          </label>
          <button
            onClick={async () => {
              if (claudeDesktopProvider === 'agnes' && !maskedAgnesKey) {
                pushToast({ kind: 'info', message: '请先在供应商设置中配置 Agnes Key' });
                return;
              }
              if (claudeDesktopProvider === 'glm' && !maskedGlmKey) {
                pushToast({ kind: 'info', message: '请先在供应商设置中配置 GLM Key' });
                return;
              }
              if (claudeDesktopProvider === 'deepseek' && !maskedKey) {
                pushToast({ kind: 'info', message: '请先在供应商设置中配置 DeepSeek Key' });
                return;
              }
              if (claudeDesktopProvider === 'packycode' && !maskedPackyCodeKey) {
                pushToast({ kind: 'info', message: '请先在供应商设置中配置 PackyCode Key' });
                return;
              }
              try {
                await window.codexSwitch.setPreferences({
                  claudeDesktopProvider,
                  claudeDesktop: { enabled: true, modelMap: desktopMapping },
                });
                await window.codexSwitch.claudeApplyAll();
                pushToast({ kind: 'success', message: '已保存 Claude Desktop 配置，重启生效' });
              } catch (e) {
                pushToast({ kind: 'error', message: '保存失败：' + (e as Error).message });
              }
            }}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 rounded-md text-sm"
          >
            保存并应用
          </button>
          <div className="text-xs text-slate-500">重启 Claude Desktop 生效</div>
        </div>
      </Section>

      {/* ── Claude Code CLI 接入 ── */}
      <Section
        title={`⌨️ Claude Code CLI 接入 · ${
          claudeCliProvider === 'deepseek'
            ? 'DeepSeek'
            : claudeCliProvider === 'agnes'
              ? 'Agnes'
              : claudeCliProvider === 'glm'
                ? 'GLM'
                : 'PackyCode'
        }`}
      >
        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between">
            <span>供应商</span>
            <select
              value={claudeCliProvider}
              onChange={(e) => {
                setClaudeCliProvider(e.target.value as 'deepseek' | 'agnes' | 'glm' | 'packycode');
                setCliMapping({}); // 切换供应商时重置模型映射，使用新供应商默认值
              }}
              className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md"
            >
              <option value="deepseek">DeepSeek · 直连</option>
              <option value="agnes">Agnes AI</option>
              <option value="glm">智谱 GLM · 直连</option>
              <option value="packycode">PackyCode · 直连</option>{' '}
            </select>
          </label>
          <label className="flex items-center justify-between">
            <span>模型映射</span>
            <button
              onClick={() => setShowCliMapping(true)}
              className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded"
            >
              管理模型映射…
            </button>
          </label>
          <button
            onClick={async () => {
              if (claudeCliProvider === 'agnes' && !maskedAgnesKey) {
                pushToast({ kind: 'info', message: '请先在供应商设置中配置 Agnes Key' });
                return;
              }
              if (claudeCliProvider === 'glm' && !maskedGlmKey) {
                pushToast({ kind: 'info', message: '请先在供应商设置中配置 GLM Key' });
                return;
              }
              if (claudeCliProvider === 'deepseek' && !maskedKey) {
                pushToast({ kind: 'info', message: '请先在供应商设置中配置 DeepSeek Key' });
                return;
              }
              if (claudeCliProvider === 'packycode' && !maskedPackyCodeKey) {
                pushToast({ kind: 'info', message: '请先在供应商设置中配置 PackyCode Key' });
                return;
              }
              try {
                // 将模型映射转为 envVars 持久化，确保 claudeApplyAll 读取到用户选择
                const defs =
                  claudeCliProvider === 'glm'
                    ? { main: 'glm-5.2', flash: 'glm-4.7' }
                    : claudeCliProvider === 'agnes'
                      ? { main: 'agnes-2.0-flash', flash: 'agnes-1.5-flash' }
                      : claudeCliProvider === 'packycode'
                        ? { main: 'claude-sonnet-4-6', flash: 'claude-haiku-4-5' }
                        : { main: 'deepseek-v4-pro', flash: 'deepseek-v4-flash' };
                const newEnvVars = {
                  anthropicModel: cliMapping['claude-sonnet-4-6'] ?? defs.main,
                  anthropicDefaultOpusModel: cliMapping['claude-opus-4-7'] ?? defs.main,
                  anthropicDefaultSonnetModel: cliMapping['claude-sonnet-4-6'] ?? defs.main,
                  anthropicDefaultHaikuModel: cliMapping['claude-haiku-4-5'] ?? defs.flash,
                  claudeCodeSubagentModel: cliMapping['claude-haiku-4-5'] ?? defs.flash,
                };
                await window.codexSwitch.setPreferences({
                  claudeCliProvider,
                  claudeCli: { enabled: true, envVars: newEnvVars },
                });
                await window.codexSwitch.claudeApplyAll();
                pushToast({
                  kind: 'success',
                  message: '已保存 Claude Code CLI 配置，新终端窗口生效',
                });
              } catch (e) {
                pushToast({ kind: 'error', message: '保存失败：' + (e as Error).message });
              }
            }}
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 rounded-md text-sm"
          >
            保存并应用
          </button>
          <div className="text-xs text-slate-500">新终端窗口生效</div>
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
      <ModelMappingModal
        open={showDesktopMapping}
        onClose={() => setShowDesktopMapping(false)}
        provider={claudeDesktopProvider}
        mapping={desktopMapping}
        onSave={setDesktopMapping}
      />
      <ModelMappingModal
        open={showCliMapping}
        onClose={() => setShowCliMapping(false)}
        provider={claudeCliProvider}
        mapping={cliMapping}
        onSave={setCliMapping}
      />
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
