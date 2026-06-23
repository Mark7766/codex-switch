/**
 * Model mapping modal — Claude model → actual model (per provider).
 */
import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  provider: 'deepseek' | 'agnes' | 'glm' | 'custom';
  mapping: Record<string, string>;
  onSave: (m: Record<string, string>) => void;
}

const CLAUDE_MODELS = [
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

function modelOptions(p: 'deepseek' | 'agnes' | 'glm' | 'custom'): string[] {
  if (p === 'glm') return ['glm-5.2', 'glm-5.1', 'glm-4.7'];
  if (p === 'custom')
    return [
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
    ];
  return p === 'agnes'
    ? ['agnes-2.0-flash', 'agnes-1.5-flash']
    : ['deepseek-v4-pro', 'deepseek-v4-flash'];
}

/** 判断一个值是不是预设列表里的，不在的就是自定义值 */
function isPreset(val: string, presets: string[]): boolean {
  return presets.includes(val);
}

export function ModelMappingModal({
  open,
  onClose,
  provider,
  mapping,
  onSave,
}: Props): JSX.Element | null {
  const [local, setLocal] = useState<Record<string, string>>({ ...mapping });
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  // 弹窗打开时，用最新的 mapping prop 重新同步 local 状态。
  useEffect(() => {
    if (open) {
      setLocal({ ...mapping });
      // 恢复自定义值：如果 mapping 里的值不在预设列表中，就是之前保存过的自定义值
      const presets = modelOptions(provider);
      const restored: Record<string, string> = {};
      for (const cm of CLAUDE_MODELS) {
        const val = mapping[cm.id] ?? presets[0];
        if (!isPreset(val!, presets)) restored[cm.id] = val!;
      }
      setCustomValues(restored);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const presets = modelOptions(provider);
  // v1.16.0: 自定义供应商不配置 Haiku（仅 Opus + Sonnet）
  const visibleModels =
    provider === 'custom'
      ? CLAUDE_MODELS.filter((m) => m.id !== 'claude-haiku-4-5')
      : CLAUDE_MODELS;

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
        <div className="space-y-3 text-sm">
          {visibleModels.map((cm) => {
            const currentValue = local[cm.id] ?? presets[0];
            const isCustom = currentValue === '__custom__';
            return (
              <div key={cm.id}>
                <label className="flex items-center justify-between">
                  <span className="text-slate-300">{cm.label}</span>
                  <select
                    value={isPreset(currentValue!, presets) ? currentValue : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setLocal({ ...local, [cm.id]: '__custom__' });
                        setCustomValues({
                          ...customValues,
                          [cm.id]: customValues[cm.id] ?? currentValue ?? '',
                        });
                      } else {
                        setLocal({ ...local, [cm.id]: e.target.value });
                      }
                    }}
                    className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md text-xs w-[200px]"
                  >
                    {presets.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    <option disabled>──</option>
                    <option value="__custom__">✏️ 自定义…</option>
                  </select>
                </label>
                {isCustom && (
                  <input
                    type="text"
                    value={customValues[cm.id] ?? ''}
                    onChange={(e) => setCustomValues({ ...customValues, [cm.id]: e.target.value })}
                    placeholder="输入模型名"
                    className="mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded-md text-xs w-[200px] float-right"
                  />
                )}
              </div>
            );
          })}
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
              // 保存时把 __custom__ 替换为实际自定义值
              const resolved: Record<string, string> = {};
              for (const cm of visibleModels) {
                const val = local[cm.id] ?? presets[0];
                resolved[cm.id] =
                  val === '__custom__'
                    ? customValues[cm.id] || presets[0] || ''
                    : val || presets[0] || '';
              }
              onSave(resolved);
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
