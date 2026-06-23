/**
 * 把 DeepSeek 原始错误 / 网络错误翻译成中文用户能看懂的友好消息。
 * 同时给出"建议动作"标签，便于「日志」UI 在错误旁附"就地修复"按钮。
 */

import type { ChatMessage } from './translate';

export type ErrorAction =
  | 'open-settings-key'
  | 'open-settings-mapping'
  | 'open-deepseek-billing'
  | 'open-network-help'
  | 'open-rate-limit-help'
  | 'none';

export interface FriendlyError {
  reason: string;
  action: ErrorAction;
  raw?: string;
}

export interface DeepSeekErrorBody {
  error?: { message?: unknown; type?: unknown; code?: unknown };
}

const RAW_LIMIT = 300;

/** 主入口：根据 HTTP 状态码 + DeepSeek body + 网络异常 message 给出友好结果。 */
export function translateError(input: {
  statusCode?: number;
  body?: unknown;
  networkErrorMessage?: string;
}): FriendlyError {
  const { statusCode, body, networkErrorMessage } = input;

  if (networkErrorMessage) {
    const m = networkErrorMessage.toLowerCase();
    if (
      m.includes('econnreset') ||
      m.includes('econnrefused') ||
      m.includes('enotfound') ||
      m.includes('etimedout') ||
      m.includes('timeout') ||
      m.includes('network')
    ) {
      return {
        reason: '无法连接到 DeepSeek，请检查网络或代理设置',
        action: 'open-network-help',
        raw: networkErrorMessage.slice(0, RAW_LIMIT),
      };
    }
    return {
      reason: networkErrorMessage.slice(0, RAW_LIMIT),
      action: 'none',
    };
  }

  const err = (body as DeepSeekErrorBody | undefined)?.error;
  const msg = typeof err?.message === 'string' ? err.message : '';
  const type = typeof err?.type === 'string' ? err.type : '';
  const code = typeof err?.code === 'string' ? err.code : '';
  const haystack = `${msg} ${type} ${code}`.toLowerCase();

  if (
    statusCode === 401 ||
    haystack.includes('authentication') ||
    haystack.includes('invalid api key') ||
    haystack.includes('invalid_api_key')
  ) {
    return {
      reason: 'DeepSeek API Key 无效或已过期，请在「设置」中更新',
      action: 'open-settings-key',
      raw: msg.slice(0, RAW_LIMIT),
    };
  }
  if (
    haystack.includes('insufficient_quota') ||
    haystack.includes('quota') ||
    haystack.includes('balance')
  ) {
    return {
      reason: 'DeepSeek 账户额度不足，请前往 DeepSeek 充值',
      action: 'open-deepseek-billing',
      raw: msg.slice(0, RAW_LIMIT),
    };
  }
  if (
    statusCode === 429 ||
    haystack.includes('rate_limit') ||
    haystack.includes('rate limit') ||
    haystack.includes('too many requests')
  ) {
    return {
      reason: '请求过于频繁，已被 DeepSeek 限流，稍后重试',
      action: 'open-rate-limit-help',
      raw: msg.slice(0, RAW_LIMIT),
    };
  }
  if (
    haystack.includes('context_length') ||
    haystack.includes('context length') ||
    haystack.includes('maximum context')
  ) {
    return {
      reason: '对话过长，超过模型上下文限制',
      action: 'none',
      raw: msg.slice(0, RAW_LIMIT),
    };
  }
  if (statusCode === 400 && (haystack.includes('model') || haystack.includes('does not exist'))) {
    return {
      reason: '模型名不被 DeepSeek 接受，请检查模型映射设置',
      action: 'open-settings-mapping',
      raw: msg.slice(0, RAW_LIMIT),
    };
  }

  if (statusCode && statusCode >= 500) {
    return {
      reason: `DeepSeek 服务异常（${statusCode}），请稍后重试`,
      action: 'none',
      raw: msg.slice(0, RAW_LIMIT),
    };
  }

  return {
    reason: msg ? msg.slice(0, RAW_LIMIT) : `请求失败（HTTP ${statusCode ?? '未知'}）`,
    action: 'none',
    raw: msg.slice(0, RAW_LIMIT),
  };
}

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{4,}/g, 'sk-***'],
  [/(authorization\s*[:=]\s*)(?:bearer\s+)?[A-Za-z0-9._-]+/gi, '$1***'],
  [/("OPENAI_API_KEY"\s*:\s*")[^"]+(")/g, '$1***$2'],
  [/(api[_-]?key\s*[:=]\s*)[A-Za-z0-9_-]+/gi, '$1***'],
];

/** 对任意字符串做脱敏：API Key / Authorization / OPENAI_API_KEY 全部替换为 ***。 */
export function redactSensitive(text: string): string {
  let out = text;
  for (const [re, rep] of SENSITIVE_PATTERNS) {
    out = out.replace(re, rep);
  }
  return out;
}

/**
 * 判断是否为 DeepSeek 上下文超限错误。
 * 用于触发紧急压缩→自动重试的容错恢复路径。
 */
export function isContextExceededError(e: Error): boolean {
  const msg = (e.message ?? '').toLowerCase();
  return (
    msg.includes('context length') ||
    msg.includes('too long') ||
    msg.includes('maximum context') ||
    msg.includes('exceed') ||
    msg.includes('对话过长') ||
    msg.includes('上下文限制') ||
    msg.includes('超过模型') ||
    (msg.includes('400') && msg.includes('context'))
  );
}

// ── v1.14.2 截断重试 ──────────────────────────────────────────────────────

export interface TruncateResult {
  messages: ChatMessage[];
  dropped: number;
}

/**
 * 上下文超限时裁剪最早的消息，保留最近 K 条（含 system + 完整 tool 配对）。
 * 清理因截断而产生的孤立 tool 消息（其 tool_call_id 的 assistant 消息已被丢弃）。
 */
export function truncateMessages(messages: ChatMessage[], keepRecent = 30): TruncateResult {
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');

  if (nonSystem.length <= keepRecent) return { messages, dropped: 0 };

  const kept = nonSystem.slice(-keepRecent);
  const dropped = nonSystem.length - keepRecent;

  // 收集保留的 assistant tool_call IDs
  const keptToolCallIds = new Set<string>();
  for (const m of kept) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (tc.id) keptToolCallIds.add(tc.id);
      }
    }
  }

  // 移除孤立的 tool 消息（其 tool_call_id 不在保留的 assistant 消息中）
  let cleaned = kept.filter((m) => {
    if (m.role !== 'tool') return true;
    return m.tool_call_id ? keptToolCallIds.has(m.tool_call_id) : true;
  });

  // 收集保留的 tool 消息的 tool_call_id（用于反向清理孤立 tool_calls）
  const keptToolResultIds = new Set<string>();
  for (const m of cleaned) {
    if (m.role === 'tool' && m.tool_call_id) {
      keptToolResultIds.add(m.tool_call_id);
    }
  }

  // 清理 assistant 消息中引用了已丢弃 tool 结果的孤立 tool_calls
  cleaned = cleaned
    .map((m) => {
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        const validCalls = m.tool_calls.filter((tc) => {
          if (!tc.id) return true;
          return keptToolResultIds.has(tc.id);
        });
        if (validCalls.length === 0) {
          // 所有 tool_calls 都是孤立的 — 移除整个 tool_calls 数组
          const { tool_calls: _tc, ...rest } = m;
          void _tc;
          return rest as ChatMessage;
        }
        if (validCalls.length < m.tool_calls.length) {
          return { ...m, tool_calls: validCalls };
        }
      }
      return m;
    })
    .filter((m) => {
      // 移除完全空的 assistant 消息（无 content、无 tool_calls）
      if (m.role !== 'assistant') return true;
      const hasContent = typeof m.content === 'string' && m.content.length > 0;
      const hasToolCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
      return hasContent || hasToolCalls;
    });

  return { messages: [...systemMsgs, ...cleaned], dropped };
}
