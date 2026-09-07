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
  /**
   * 是否提供 DeepSeek 视觉模型 deepseek-v4-flash-vision-exp。
   * v2.2.0 起仅 Claude Code CLI 真正可用（env 会把该 model id 原样发给
   * api.deepseek.com/anthropic）；Claude Desktop 的 3P gateway 只能发送
   * claude-* 路由名、labelOverride 仅显示，图片到不了视觉模型 → Desktop 传 false。
   */
  vision?: boolean;
}

const CLAUDE_MODELS = [
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

function modelOptions(p: 'deepseek' | 'agnes' | 'glm' | 'custom', allowVision = true): string[] {
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
    : // v2.2.0: vision-exp 实验多模态模型，仅 Claude Code CLI（allowVision）可选
      allowVision
      ? ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']
      : ['deepseek-v4-pro', 'deepseek-v4-flash'];
}

// v2.2.0: Claude Code CLI 接 DeepSeek 的默认档位映射（env 会把这三个 id 原样发
// 给 api.deepseek.com/anthropic）：opus→pro、sonnet→flash、haiku→vision-exp。
const DEEPSEEK_ROLE_DEFAULT_CLI: Record<string, string> = {
  'claude-opus-4-7': 'deepseek-v4-pro',
  'claude-sonnet-4-6': 'deepseek-v4-flash',
  'claude-haiku-4-5': 'deepseek-v4-flash-vision-exp',
};
// Claude Desktop 不提供视觉模型：仅 pro/flash，haiku 默认 flash。
const DEEPSEEK_ROLE_DEFAULT_DESKTOP: Record<string, string> = {
  'claude-opus-4-7': 'deepseek-v4-pro',
  'claude-sonnet-4-6': 'deepseek-v4-flash',
  'claude-haiku-4-5': 'deepseek-v4-flash',
};

/** 槽位未映射时的默认值：DeepSeek 按是否允许 vision 取档位默认，其余供应商沿用预设列表首项。 */
function slotDefault(
  provider: 'deepseek' | 'agnes' | 'glm' | 'custom',
  slot: string,
  allowVision = true,
): string {
  const first = modelOptions(provider, allowVision)[0];
  if (provider === 'deepseek') {
    const role = allowVision ? DEEPSEEK_ROLE_DEFAULT_CLI : DEEPSEEK_ROLE_DEFAULT_DESKTOP;
    return role[slot] ?? first!;
  }
  return first!;
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
  vision = true,
}: Props): JSX.Element | null {
  const allowVision = vision !== false;
  const [local, setLocal] = useState<Record<string, string>>({ ...mapping });
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  // 弹窗打开时，用最新的 mapping prop 重新同步 local 状态。
  useEffect(() => {
    if (open) {
      setLocal({ ...mapping });
      // 恢复自定义值：如果 mapping 里的值不在预设列表中，就是之前保存过的自定义值
      const presets = modelOptions(provider, allowVision);
      const restored: Record<string, string> = {};
      for (const cm of CLAUDE_MODELS) {
        const val = mapping[cm.id] ?? slotDefault(provider, cm.id, allowVision);
        if (!isPreset(val!, presets)) restored[cm.id] = val!;
      }
      setCustomValues(restored);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const presets = modelOptions(provider, allowVision);
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
            const currentValue = local[cm.id] ?? slotDefault(provider, cm.id, allowVision);
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
                const fallback = slotDefault(provider, cm.id, allowVision);
                const val = local[cm.id] ?? fallback;
                resolved[cm.id] =
                  val === '__custom__'
                    ? customValues[cm.id] || fallback || ''
                    : val || fallback || '';
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
