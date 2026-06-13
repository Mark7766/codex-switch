/**
 * 把 DeepSeek 原始错误 / 网络错误翻译成中文用户能看懂的友好消息。
 * 同时给出"建议动作"标签，便于「日志」UI 在错误旁附"就地修复"按钮。
 */

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
  [/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
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
    (msg.includes('400') && msg.includes('context'))
  );
}
