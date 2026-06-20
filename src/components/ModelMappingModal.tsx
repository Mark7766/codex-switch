/**
 * Model mapping modal — Claude model → actual model (per provider).
 */
import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  provider: 'deepseek' | 'agnes' | 'glm';
  mapping: Record<string, string>;
  onSave: (m: Record<string, string>) => void;
}

const CLAUDE_MODELS = [
  { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

function modelOptions(p: 'deepseek' | 'agnes' | 'glm'): string[] {
  if (p === 'glm') return ['glm-5.2', 'glm-5.1', 'glm-4.7'];
  return p === 'agnes'
    ? ['agnes-2.0-flash', 'agnes-1.5-flash']
    : ['deepseek-v4-pro', 'deepseek-v4-flash'];
}

export function ModelMappingModal({
  open,
  onClose,
  provider,
  mapping,
  onSave,
}: Props): JSX.Element | null {
  const [local, setLocal] = useState<Record<string, string>>({ ...mapping });

  // 弹窗打开时，用最新的 mapping prop 重新同步 local 状态。
  // useState 初始化器只在组件挂载时执行一次，当页面切换导致
  // Settings 重新挂载后 mapping 会从空对象变为已保存的值，
  // 但 local 不会自动更新——必须通过 effect 同步。
  useEffect(() => {
    if (open) setLocal({ ...mapping });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border border-slate-600 rounded-xl p-5 max-w-sm w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-3">Claude 模型映射</h3>
        <div className="space-y-2 text-sm">
          {CLAUDE_MODELS.map((cm) => (
            <label key={cm.id} className="flex items-center justify-between">
              <span className="text-slate-300">{cm.label}</span>
              <select
                value={local[cm.id] ?? modelOptions(provider)[0]}
                onChange={(e) => setLocal({ ...local, [cm.id]: e.target.value })}
                className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md text-xs"
              >
                {modelOptions(provider).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded"
          >
            取消
          </button>
          <button
            onClick={() => {
              onSave(local);
              onClose();
            }}
            className="flex-1 px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-700 rounded"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
