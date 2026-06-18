/**
 * Plugins page — v1.10.0.
 *
 * Offline plugin pack download and install guide.
 * Flow: view pack info → download (with progress) → copy install command → paste in Codex.
 */
import { useState, useEffect, useCallback } from 'react';

interface PluginPackInfo {
  version: string;
  filename: string;
  size: number;
  size_mb: number;
  plugin_count: number;
  description: string;
  updated_at: string;
  download_url: string;
}

interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  speedBytesPerSec: number;
  remainingSeconds: number;
}

type PluginType = 'codex' | 'claude';
type Phase = 'loading' | 'info' | 'downloading' | 'complete' | 'error';

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_000_000) return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1_000) return `${(bytesPerSec / 1_000).toFixed(0)} KB/s`;
  return `${bytesPerSec} B/s`;
}

function formatTime(seconds: number): string {
  if (seconds <= 0) return '即将完成';
  if (seconds < 60) return `约 ${seconds} 秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `约 ${m} 分 ${s} 秒`;
}

export function Plugins(): JSX.Element {
  const [pluginType, setPluginType] = useState<PluginType>('codex');
  const [phase, setPhase] = useState<Phase>('loading');
  const [packInfo, setPackInfo] = useState<PluginPackInfo | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [command, setCommand] = useState<string>('');
  const [logoDataUrls, setLogoDataUrls] = useState<Record<PluginType, string>>({
    codex: '',
    claude: '',
  });

  // Load brand logos on mount
  useEffect(() => {
    window.codexSwitch
      .pluginsGetLogo('codex')
      .then((url) => setLogoDataUrls((prev) => ({ ...prev, codex: url })));
    window.codexSwitch
      .pluginsGetLogo('claude')
      .then((url) => setLogoDataUrls((prev) => ({ ...prev, claude: url })));
  }, []);

  // On mount: check for existing download, then load pack info
  useEffect(() => {
    async function init(): Promise<void> {
      const type = pluginType === 'codex' ? 'codex' : 'claude';
      // 1. Check if already downloaded
      try {
        const existing = await window.codexSwitch.pluginsCheckExistingFile(
          undefined,
          type === 'claude' ? 'claude' : 'codex',
        );
        if (existing) {
          setFilePath(existing);
          let cmd: string;
          if (type === 'claude') {
            cmd = await window.codexSwitch.pluginsGetInstallCommand(
              existing,
              'claude',
              undefined,
              'cowork',
            );
          } else {
            cmd = await window.codexSwitch.pluginsGetInstallCommand(existing);
          }
          setCommand(cmd);
          try {
            const info = await window.codexSwitch.pluginsGetPackInfo(
              type === 'claude' ? 'claude' : undefined,
            );
            setPackInfo(info);
          } catch {
            /* pack info is optional when file exists */
          }
          setPhase('complete');
          return;
        }
      } catch {
        /* checkExistingFile failing is non-fatal */
      }

      // 2. No existing file — load pack info for download
      try {
        const info = await window.codexSwitch.pluginsGetPackInfo(
          type === 'claude' ? 'claude' : undefined,
        );
        setPackInfo(info);
        setPhase('info');
      } catch (e) {
        setError((e as Error).message || '无法获取插件信息');
        setPhase('error');
      }
    }
    init();
  }, [pluginType]);

  // Listen for download events
  useEffect(() => {
    const unsubProgress = window.codexSwitch.onPluginsDownloadProgress((p) => {
      setProgress(p);
      setPhase('downloading');
    });
    const unsubComplete = window.codexSwitch.onPluginsDownloadComplete((fp) => {
      setFilePath(fp);
      setPhase('complete');
      // Fetch the install command for the active tab
      const type = pluginType === 'claude' ? 'claude' : 'codex';
      const target = pluginType === 'claude' ? 'cowork' : undefined;
      window.codexSwitch
        .pluginsGetInstallCommand(fp, type, undefined, target)
        .then(setCommand)
        .catch(() => {
          setCommand(`你帮安装一下离线插件安装包 ${fp} ，我要把这些插件都加载到codex里`);
        });
    });
    const unsubError = window.codexSwitch.onPluginsDownloadError((msg) => {
      setError(msg);
      setPhase('error');
    });
    return () => {
      unsubProgress();
      unsubComplete();
      unsubError();
    };
  }, [pluginType]);

  const handleDownload = useCallback(() => {
    setPhase('downloading');
    setError(null);
    setProgress(null);
    const type = pluginType === 'claude' ? 'claude' : 'codex';
    window.codexSwitch.pluginsDownload(undefined, type).catch((e) => {
      setError((e as Error).message || '下载启动失败');
      setPhase('error');
    });
  }, [pluginType]);

  const handleCancel = useCallback(() => {
    window.codexSwitch.pluginsCancelDownload();
    setPhase('info');
    setProgress(null);
  }, []);

  const handleOpenDir = useCallback(() => {
    window.codexSwitch.pluginsOpenDownloadDir();
  }, []);

  const handleCopyClaudeCodeCommand = useCallback(async () => {
    if (!filePath) return;
    // Claude Code installs all 170+ plugins
    const cmd = await window.codexSwitch.pluginsGetInstallCommand(filePath, 'claude', [], 'code');
    try {
      await navigator.clipboard.writeText(cmd);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = cmd;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [filePath]);

  const handleCopy = useCallback(async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // Fallback: create temp textarea
      const ta = document.createElement('textarea');
      ta.value = command;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [command]);

  const handleRetry = useCallback(() => {
    setError(null);
    setPhase('loading');
    window.codexSwitch
      .pluginsGetPackInfo()
      .then((info) => {
        setPackInfo(info);
        setPhase('info');
      })
      .catch((e) => {
        setError((e as Error).message || '无法获取插件信息');
        setPhase('error');
      });
  }, []);

  // ── tab bar (always visible) ────────────────────────────────────────────

  const TabBar = (
    <div className="flex border-b border-slate-700 mb-6 max-w-xl mx-auto">
      <button
        onClick={() => setPluginType('codex')}
        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
          pluginType === 'codex'
            ? 'border-green-500 text-green-400'
            : 'border-transparent text-slate-400 hover:text-slate-200'
        }`}
      >
        {logoDataUrls.codex ? (
          <img src={logoDataUrls.codex} alt="Codex" className="w-5 h-5" />
        ) : (
          <span>🔌</span>
        )}
        Codex 插件
      </button>
      <button
        onClick={() => setPluginType('claude')}
        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
          pluginType === 'claude'
            ? 'border-green-500 text-green-400'
            : 'border-transparent text-slate-400 hover:text-slate-200'
        }`}
      >
        {logoDataUrls.claude ? (
          <img src={logoDataUrls.claude} alt="Claude" className="w-5 h-5" />
        ) : (
          <span>🧠</span>
        )}
        Claude 插件
      </button>
    </div>
  );

  // ── Claude: use same phases as Codex, with different content ──────────
  // The phase states (loading/info/downloading/complete/error) are shared.
  // For Claude, the info/complete cards show Claude-specific content.
  // For loading/error/downloading, the existing Codex UI is reused.

  // Cluade uses shared phases — when pluginType is 'claude', we customize info and complete only

  // ── loading ──────────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <div className="p-6 max-w-xl mx-auto">
        {TabBar}
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-slate-800 rounded w-2/3" />
          <div className="h-4 bg-slate-800 rounded w-full" />
          <div className="h-4 bg-slate-800 rounded w-3/4" />
          <div className="h-12 bg-slate-800 rounded w-1/2" />
        </div>
      </div>
    );
  }

  // ── error ────────────────────────────────────────────────────────────────

  if (phase === 'error') {
    return (
      <div className="p-6 max-w-xl mx-auto">
        {TabBar}
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-6 text-center">
          <div className="text-3xl mb-3">❌</div>
          <h2 className="text-lg font-semibold text-red-300 mb-2">获取插件信息失败</h2>
          <p className="text-sm text-slate-300 mb-4">{error || '未知错误'}</p>
          <button
            onClick={handleRetry}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-md text-sm transition"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  // ── downloading ──────────────────────────────────────────────────────────

  if (phase === 'downloading') {
    const pct = progress?.percent ?? 0;
    const downloaded = progress ? (progress.bytesDownloaded / 1_048_576).toFixed(1) : '0.0';
    const total = progress
      ? (progress.totalBytes / 1_048_576).toFixed(0)
      : (packInfo?.size_mb ?? '?');
    return (
      <div className="p-6 max-w-xl mx-auto">
        {TabBar}
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl">⬇</span>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">正在下载插件包…</h2>
              <p className="text-xs text-slate-400">
                {packInfo?.filename ?? 'codex-offline-pack.tar.gz'}
              </p>
            </div>
          </div>

          {/* progress bar */}
          <div className="w-full bg-slate-700 rounded-full h-3 mb-3 overflow-hidden">
            <div
              className="bg-green-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>

          <div className="flex justify-between text-sm text-slate-300 mb-1">
            <span>{pct}%</span>
            <span>
              {downloaded} / {total} MB
            </span>
          </div>
          {progress && (
            <div className="text-xs text-slate-400">
              速度 {formatSpeed(progress.speedBytesPerSec)} · 剩余{' '}
              {formatTime(progress.remainingSeconds)}
            </div>
          )}

          <button
            onClick={handleCancel}
            className="mt-4 w-full py-2 border border-slate-600 text-slate-300 rounded-md hover:bg-slate-700 transition text-sm"
          >
            取消下载
          </button>
        </div>
      </div>
    );
  }

  // ── complete ─────────────────────────────────────────────────────────────

  if (phase === 'complete' && filePath) {
    return (
      <div className="p-6 max-w-xl mx-auto space-y-6">
        {TabBar}
        {/* success banner */}
        <div className="bg-green-900/30 border border-green-700 rounded-lg p-6 text-center">
          <div className="text-3xl mb-2">✅</div>
          <h2 className="text-lg font-semibold text-green-300 mb-1">下载完成！</h2>
          <p className="text-xs text-slate-400 break-all">
            已保存至：<span className="text-slate-200">{filePath}</span>
          </p>
        </div>

        {/* install guide card */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
          <h3 className="text-base font-semibold text-slate-100 mb-4">📋 安装步骤</h3>

          <ol className="space-y-4 text-sm text-slate-300">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-slate-700 rounded-full flex items-center justify-center text-xs font-bold text-slate-200">
                1
              </span>
              <span>
                {pluginType === 'claude'
                  ? '打开 Claude Desktop，切换到 Cowork 模式'
                  : '打开 Codex（Desktop 或 CLI）'}
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-slate-700 rounded-full flex items-center justify-center text-xs font-bold text-slate-200">
                2
              </span>
              <span>
                {pluginType === 'claude'
                  ? '在 Cowork 对话框中输入以下指令：'
                  : '在 Codex 对话框中输入以下指令：'}
              </span>
            </li>
          </ol>

          {/* command box */}
          <div className="mt-3 bg-slate-950 border border-slate-600 rounded-lg p-4 font-mono text-sm text-slate-200 break-all leading-relaxed">
            {command || '加载中…'}
          </div>

          <button
            onClick={handleCopy}
            className={`mt-3 w-full py-2 rounded-md text-sm font-medium transition ${
              copied ? 'bg-green-600 text-white' : 'bg-brand-600 hover:bg-brand-500 text-white'
            }`}
          >
            {copied ? '✅ 已复制' : '📋 复制指令'}
          </button>

          <ol className="space-y-4 text-sm text-slate-300 mt-4" start={3}>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-slate-700 rounded-full flex items-center justify-center text-xs font-bold text-slate-200">
                3
              </span>
              <span>
                {pluginType === 'claude'
                  ? `Cowork 会逐个安装 20 个精选 skill，每个 skill 点一次 Save 即可 ✅`
                  : `Codex 会自动解包并安装全部 ${packInfo?.plugin_count ?? 173} 个插件，等待完成即可 ✅`}
              </span>
            </li>
          </ol>
        </div>

        {/* v1.12.0: Claude Code — installs ALL 170+ plugins */}
        {pluginType === 'claude' && (
          <div className="border-t border-slate-700 pt-4">
            <p className="text-xs text-slate-500 mb-2">
              💻 Claude Code 用户？点击下方按钮，粘贴到 Claude Code 即可安装全部 170+ 个 skill
            </p>
            <button
              onClick={handleCopyClaudeCodeCommand}
              className="w-full py-2 border border-slate-600 text-slate-300 rounded-md hover:bg-slate-700 transition text-sm"
            >
              📋 复制 Claude Code 安装指令（全部 170+ 个）
            </button>
          </div>
        )}

        {/* actions */}
        <div className="flex gap-3">
          <button
            onClick={handleDownload}
            className="flex-1 py-2 border border-slate-600 text-slate-300 rounded-md hover:bg-slate-700 transition text-sm"
          >
            重新下载
          </button>
          <button
            onClick={handleOpenDir}
            className="flex-1 py-2 border border-slate-600 text-slate-300 rounded-md hover:bg-slate-700 transition text-sm"
          >
            打开下载文件夹
          </button>
        </div>
      </div>
    );
  }

  // ── info (default) ───────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6">
      {TabBar}
      {/* pack info card */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          {pluginType === 'claude' ? (
            logoDataUrls.claude ? (
              <img src={logoDataUrls.claude} alt="Claude" className="w-9 h-9" />
            ) : (
              <span className="text-3xl">🧠</span>
            )
          ) : logoDataUrls.codex ? (
            <img src={logoDataUrls.codex} alt="Codex" className="w-9 h-9" />
          ) : (
            <span className="text-3xl">🔌</span>
          )}
          <div>
            <h2 className="text-xl font-semibold text-slate-100">
              {pluginType === 'claude' ? '安装 Claude 扩展' : '安装 Codex 插件'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {packInfo?.filename} v{packInfo?.version}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-slate-900/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-400">
              {pluginType === 'claude' ? '20' : (packInfo?.plugin_count ?? '…')}
            </div>
            <div className="text-xs text-slate-400 mt-1">精选</div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-400">{packInfo?.size_mb ?? '…'} MB</div>
            <div className="text-xs text-slate-400 mt-1">文件大小</div>
          </div>
        </div>

        {packInfo?.description && (
          <p className="text-sm text-slate-300 mb-4 leading-relaxed">{packInfo.description}</p>
        )}

        <div className="text-xs text-slate-500 mb-4">更新日期：{packInfo?.updated_at ?? '—'}</div>

        <button
          onClick={handleDownload}
          className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition"
        >
          {pluginType === 'claude' ? '下载 Claude 扩展包' : '下载插件包'}（
          {packInfo?.size_mb ?? '?'} MB）
        </button>

        <p className="text-xs text-slate-500 mt-3 text-center">
          {pluginType === 'claude'
            ? '下载完成后，复制指令粘贴到 Claude Desktop Cowork 中即可完成安装'
            : '下载完成后，只需复制一条指令粘贴到 Codex 中即可完成安装'}
        </p>
      </div>

      {/* first-use hint */}
      <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-4 text-sm text-amber-200 leading-relaxed">
        💡 <span className="font-medium">首次使用？</span>
        这里有一份精选的 {packInfo?.plugin_count ?? '多'} 个插件合集，包括 Claude Code 集成、
        代码格式化、Git 辅助、中文优化等。国内高速下载，一键安装，无需任何配置。
      </div>

      {/* tip */}
      <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-4 text-xs text-slate-400 leading-relaxed">
        💡 <span className="text-slate-300">提示：</span>
        {pluginType === 'claude'
          ? '包含 Superpowers 全系列、前端设计、代码审查等 20 个精选扩展。'
          : '插件包包含 Claude Code 集成、代码格式化、Git 辅助、中文优化等 '}
        {pluginType !== 'claude' && (
          <>
            {packInfo?.plugin_count ?? '多'} 个精选插件。安装后可在 Codex
            的插件面板中看到所有已加载的插件。
          </>
        )}
        {pluginType === 'claude' && <>安装后在 Claude Desktop Cowork 中即可使用。</>}
      </div>
    </div>
  );
}
