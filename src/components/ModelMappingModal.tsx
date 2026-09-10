/**
 * Claude 模型映射弹窗（v3.0.0 改为注册表驱动）。
 *
 * 原先这里自带 `modelOptions()` / `DEEPSEEK_ROLE_DEFAULT` / `CLAUDE_MODELS` 三份供应商数据，
 * 与设置页重复维护；现在全部来自 `electron/config/providers.ts` 下发的描述符。
 */
import { useEffect, useState } from 'react';
import { foldModel } from '@/lib/model-fold';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 当前供应商描述符（来自 providers:list）；为空时不渲染内容。 */
  descriptor: ProviderDescriptor | null;
  mapping: Record<string, string>;
  onSave: (m: Record<string, string>) => void;
}

/** 判断一个值是不是预设列表里的，不在的就是自定义值 */
function isPreset(val: string, presets: string[]): boolean {
  return presets.includes(val);
}

export function ModelMappingModal({
  open,
  onClose,
  descriptor,
  mapping,
  onSave,
}: Props): JSX.Element | null {
  const [local, setLocal] = useState<Record<string, string>>({ ...mapping });
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const presets = descriptor?.claude.models ?? [];
  const slots = descriptor?.claude.slots ?? [];
  const roles = descriptor?.claude.roleDefaults;
  // v1.16.0: 自定义供应商不配置 Haiku（仅 Opus + Sonnet）
  const visibleSlots = descriptor?.claude.includeHaiku
    ? slots
    : slots.filter((s) => s.tier !== 'haiku');

  const slotDefault = (slotId: string, tier: 'opus' | 'sonnet' | 'haiku'): string =>
    roles?.[tier] ?? presets[0] ?? '';

  // 弹窗打开时同步最新 mapping，并折叠已下线的旧模型名（否则会被当成自定义值渲染出输入框）
  useEffect(() => {
    if (open && descriptor) {
      const source: Record<string, string> = {};
      for (const [slot, model] of Object.entries(mapping)) {
        source[slot] = foldModel(model, descriptor);
      }
      setLocal({ ...source });
      const restored: Record<string, string> = {};
      for (const slot of slots) {
        const val = source[slot.id] ?? slotDefault(slot.id, slot.tier);
        if (val && !isPreset(val, presets)) restored[slot.id] = val;
      }
      setCustomValues(restored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !descriptor) return null;

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
          {visibleSlots.map((slot) => {
            const currentValue = local[slot.id] ?? slotDefault(slot.id, slot.tier);
            const isCustom = !isPreset(currentValue, presets);
            return (
              <div key={slot.id}>
                <label className="flex items-center justify-between">
                  <span className="text-slate-300">{slot.label}</span>
                  <select
                    value={isPreset(currentValue, presets) ? currentValue : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setLocal({ ...local, [slot.id]: '__custom__' });
                        setCustomValues({
                          ...customValues,
                          [slot.id]: customValues[slot.id] ?? currentValue ?? '',
                        });
                      } else {
                        setLocal({ ...local, [slot.id]: e.target.value });
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
                  // 右对齐在 select 正下方。原先用 float-right，会挤压左侧档位标签导致折行。
                  <div className="flex justify-end mt-1">
                    <input
                      type="text"
                      value={customValues[slot.id] ?? ''}
                      onChange={(e) =>
                        setCustomValues({ ...customValues, [slot.id]: e.target.value })
                      }
                      placeholder="输入模型名"
                      className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-md text-xs w-[200px]"
                    />
                  </div>
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
              for (const slot of visibleSlots) {
                const fallback = slotDefault(slot.id, slot.tier);
                const val = local[slot.id] ?? fallback;
                resolved[slot.id] =
                  val === '__custom__'
                    ? customValues[slot.id] || fallback || ''
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
