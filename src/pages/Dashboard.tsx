import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../lib/store';

/**
 * 工具接入状态（v3.0.0）。
 *
 * 从「主面板」改名并重写：本地代理已删除，原先的代理状态、端口、请求数、成功率、
 * 累计时长、token 统计、使用方式说明全部失效，这里只保留**四个工具的接入状态**——
 * 这正是配置工具真正要回答的问题。
 */
export function Dashboard(): JSX.Element {
  const pushToast = useAppStore((s) => s.pushToast);
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
  const [detectBusy, setDetectBusy] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  const refreshDetect = useCallback(async () => {
    setDetectBusy(true);
    try {
      const initial = await window.codexSwitch.claudeDetect();
      // 对「已安装但尚未配置」的工具顺手补写配置，让「刷新检测」是可执行的而不只是只读轮询
      const needsApply =
        (initial.claudeCli.installed && !initial.claudeCli.configApplied) ||
        (initial.claudeDesktop.installed && !initial.claudeDesktop.configApplied);
      if (needsApply) {
        try {
          const applied = await window.codexSwitch.claudeApplyAll();
          setDetectResult(applied);
          setJustApplied(true);
        } catch {
          // 补写失败（例如还没填 Key）→ 展示未配置状态
          setDetectResult(initial);
          setJustApplied(false);
        }
      } else {
        setDetectResult(initial);
        setJustApplied(false);
      }
    } catch (e) {
      pushToast({ kind: 'error', message: '检测失败：' + (e as Error).message });
    } finally {
      setDetectBusy(false);
    }
  }, [pushToast]);

  useEffect(() => {
    void refreshDetect();
  }, [refreshDetect]);

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-xl font-semibold mb-1">工具接入状态</h1>
      <p className="text-sm text-slate-400 mb-6">
        这里显示四个工具是否已安装、以及配置是否已写入。想切换供应商或模型，去左侧「设置」。
      </p>

      <div className="bg-slate-800/30 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-medium">检测结果</div>
          <button
            onClick={refreshDetect}
            disabled={detectBusy}
            className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50 transition"
          >
            {detectBusy ? '检测中…' : '刷新检测'}
          </button>
        </div>
        {detectResult ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <ToolCard label="Codex Desktop" ts={detectResult.codexDesktop} />
            <ToolCard label="Codex CLI" ts={detectResult.codexCli} />
            <ToolCard label="Claude Code CLI" ts={detectResult.claudeCli} />
            <ToolCard
              label="Claude Desktop"
              ts={detectResult.claudeDesktop}
              restartHint={
                justApplied && detectResult.claudeDesktop.configApplied ? '重启应用生效' : undefined
              }
            />
          </div>
        ) : (
          <div className="text-xs text-slate-400">正在检测…</div>
        )}
      </div>
    </div>
  );
}

function ToolCard({
  label,
  ts,
  restartHint,
}: {
  label: string;
  ts: ToolStatus;
  restartHint?: string;
}): JSX.Element {
  const dot = ts.installed ? (ts.configApplied ? 'bg-green-500' : 'bg-red-500') : 'bg-slate-500';
  const text = ts.installed ? (ts.configApplied ? '已配置' : '未配置') : '未安装';
  return (
    <div className="bg-slate-900/70 rounded-md p-3 flex items-start gap-2">
      <span className={`mt-1.5 inline-block w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
      <div>
        <div className="text-xs text-slate-300 font-medium">{label}</div>
        <div className="text-xs text-slate-400 mt-0.5">{text}</div>
        {ts.installed && ts.configApplied && restartHint && (
          <div className="text-xs text-amber-400/70 mt-0.5">↺ {restartHint}</div>
        )}
      </div>
    </div>
  );
}
