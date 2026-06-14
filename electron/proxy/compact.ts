/**
 * compact.ts — 上下文压缩核心逻辑（v1.5.0）
 *
 * 负责判断是否需要压缩、调用 DeepSeek LLM 做对话摘要、失败时回退截断。
 * 复用 stream.ts 的 callDeepSeekSync 做非流式 API 调用。
 */

import { randomBytes } from 'node:crypto';

import type { ChatMessage } from './translate';
import type { ChatRequest } from './translate';
import { callDeepSeekSync } from './stream';

// ── constants ───────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 20;
const DEFAULT_RECENT_KEEP = 10;
const DEFAULT_FALLBACK_KEEP = 30;
const DEFAULT_SUMMARY_MAX_TOKENS = 2000;
const DEFAULT_SUMMARY_TIMEOUT_MS = 15_000;

const SUMMARIZE_SYSTEM_PROMPT = `你是对话摘要助手。请将以上对话历史压缩为一段简洁的摘要文本。
严格遵循以下规则：

1. **必须保留**：
   - 用户的核心目标和意图（"想做什么"）
   - 已做出的关键决策和选择
   - 重要的文件路径、代码片段、命令
   - 关键数据值（版本号、配置参数、API 返回的关键字段）
   - 未解决的问题或待办项

2. **可以忽略**：
   - 重复的内容和修正过程
   - 问候语和礼貌性对话
   - 已完成的中间步骤的细节
   - 错误尝试的具体过程（保留最终结论即可）

3. **输出格式**：
   - 使用中文
   - 以"此前对话摘要："开头
   - 用分点或短段落组织，不超过 2000 字
   - 不要添加任何额外的解释或前缀

4. **长度**：整个摘要输出不超过 2000 字符。`;

// ── types ───────────────────────────────────────────────────────────────────

export interface CompactOptions {
  apiKey: string;
  defaultModel?: string;
  threshold?: number;
  recentKeep?: number;
  fallbackKeep?: number;
  summaryMaxTokens?: number;
  summaryTimeoutMs?: number;
}

export interface CompactResult {
  compacted: boolean;
  method: 'clone' | 'llm_summary' | 'truncation';
  compactedId: string;
  compactedMessages: ChatMessage[];
  originalMessageCount: number;
  compactedMessageCount: number;
  summaryTokens?: number;
  error?: string;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function buildMessages(role: string, content: string): ChatMessage {
  return { role, content };
}

function stripTrailingAssistant(messages: ChatMessage[]): ChatMessage[] {
  let result = messages;
  while (result.length > 0) {
    const last = result[result.length - 1];
    if (!last || last.role !== 'assistant') break;
    result = result.slice(0, -1);
  }
  return result;
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Remove orphaned function_call_output messages whose preceding function_call
 * was dropped during truncation.  DeepSeek requires every tool message to have
 * a matching tool_calls in the same conversation.
 */
function removeOrphanedTools(messages: ChatMessage[]): ChatMessage[] {
  // Collect valid call_ids from assistant{tool_calls} messages
  const validCallIds = new Set<string>();
  for (const m of messages) {
    if (Array.isArray(m.tool_calls)) {
      for (const t of m.tool_calls) {
        validCallIds.add(t.id);
      }
    }
  }
  // If no tool_calls survived truncation, remove ALL tool messages —
  // they are all orphans.  If some survived, only keep tools that match.
  return messages.filter((m) => {
    if (m.role === 'tool') {
      return typeof m.tool_call_id === 'string' && validCallIds.has(m.tool_call_id);
    }
    return true;
  });
}

// ── public API ──────────────────────────────────────────────────────────────

/** 判断是否需要压缩。messages.length > threshold 时返回 true。 */
export function shouldCompact(messages: ChatMessage[], threshold?: number): boolean {
  return messages.length > (threshold ?? DEFAULT_THRESHOLD);
}

/**
 * 粗略估算消息列表的 token 数。
 * 中文 ~1.5 chars/token，英文 ~4 chars/token，折中取 2 chars/token。
 * 用于在消息数阈值之前提前判断是否需要压缩。
 */
export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    chars += content.length;
  }
  return Math.ceil(chars / 2);
}

/** 当 token 数超过模型上下文窗口的 70% 时触发压缩。 */
export function shouldCompactByTokens(
  messages: ChatMessage[],
  modelContextLimit = 128_000,
): boolean {
  return estimateTokens(messages) > modelContextLimit * 0.7;
}

/**
 * 紧急压缩：基于 token 数（而非消息条数）截断。
 * 从最新消息向旧消息累加 token，超过 limit 后丢弃更早的消息。
 * 默认限 800K tokens（~80% 的 1M 上下文窗口），保底至少保留 1 条。
 */
export function emergencyCompact(messages: ChatMessage[]): ChatMessage[] {
  const TOKEN_LIMIT = 800_000;
  const kept: ChatMessage[] = [];
  let tokens = 0;

  // Walk backwards from newest, accumulate until we hit the limit
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const content =
      typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
    const msgTokens = Math.ceil(content.length / 2);

    if (tokens + msgTokens > TOKEN_LIMIT && kept.length >= 1) {
      // Stop — we've hit the limit and have at least 1 message
      break;
    }
    tokens += msgTokens;
    kept.unshift(msg);
  }

  const dropped = messages.length - kept.length;
  if (dropped === 0) return messages; // nothing to drop

  // Clean orphaned tool messages: after token-based truncation, tool messages
  // whose preceding function_call was dropped become invalid.  Remove them.
  const cleaned = removeOrphanedTools(kept);

  const notice: ChatMessage = {
    role: 'system',
    content:
      `[对话历史已超出模型长度限制。已自动截断：丢弃最早 ${messages.length - cleaned.length} 条消息，` +
      `保留最近 ${cleaned.length} 条（约 ${Math.round(tokens / 1000)}K tokens）。` +
      '如需恢复完整上下文，请开启新对话。]',
  };
  return [notice, ...cleaned];
}

/**
 * 压缩对话历史。
 *
 * 流程：
 * 1. 消息数 ≤ threshold → 直接克隆（compacted=false）
 * 2. 消息数 > threshold → 调 DeepSeek 做 LLM 摘要
 * 3. LLM 失败/超时 → 回退截断保留最近 fallbackKeep 条
 */
export async function compactHistory(
  messages: ChatMessage[],
  opts: CompactOptions,
): Promise<CompactResult> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const recentKeep = opts.recentKeep ?? DEFAULT_RECENT_KEEP;
  const fallbackKeep = opts.fallbackKeep ?? DEFAULT_FALLBACK_KEEP;
  const summaryMaxTokens = opts.summaryMaxTokens ?? DEFAULT_SUMMARY_MAX_TOKENS;
  const summaryTimeoutMs = opts.summaryTimeoutMs ?? DEFAULT_SUMMARY_TIMEOUT_MS;

  const originalCount = messages.length;

  // ── short conversation: clone only ──────────────────────────────────────
  if (!shouldCompact(messages, threshold)) {
    return {
      compacted: false,
      method: 'clone',
      compactedId: '', // filled by caller
      compactedMessages: [...messages],
      originalMessageCount: originalCount,
      compactedMessageCount: messages.length,
    };
  }

  // ── long conversation: split and summarize ──────────────────────────────
  const keepRecent = messages.slice(-recentKeep);
  const toSummarize = messages.slice(0, -recentKeep);

  const summaryModel = opts.defaultModel ?? 'deepseek-chat';

  try {
    const summaryText = await summarizeWithTimeout(
      toSummarize,
      {
        apiKey: opts.apiKey,
        model: summaryModel,
        maxTokens: summaryMaxTokens,
      },
      summaryTimeoutMs,
    );

    // Build compacted history: system summary + recent messages
    const summaryMsg = buildMessages('system', `[对话历史摘要] ${summaryText}`);
    const compacted = [summaryMsg, ...keepRecent];

    return {
      compacted: true,
      method: 'llm_summary',
      compactedId: '',
      compactedMessages: compacted,
      originalMessageCount: originalCount,
      compactedMessageCount: compacted.length,
      summaryTokens: summaryText.length, // rough character count proxy
    };
  } catch (err) {
    // ── fallback: truncation ──────────────────────────────────────────────
    const truncated = messages.slice(-fallbackKeep);
    const cleaned = stripTrailingAssistant(truncated);

    return {
      compacted: true,
      method: 'truncation',
      compactedId: '',
      compactedMessages: cleaned,
      originalMessageCount: originalCount,
      compactedMessageCount: cleaned.length,
      error: (err as Error).message,
    };
  }
}

// ── internal ────────────────────────────────────────────────────────────────

interface SummarizeOpts {
  apiKey: string;
  model: string;
  maxTokens: number;
}

/** Call DeepSeek to summarize history, with timeout via Promise.race. */
async function summarizeWithTimeout(
  messages: ChatMessage[],
  opts: SummarizeOpts,
  timeoutMs: number,
): Promise<string> {
  const summaryReq: ChatRequest = {
    model: opts.model,
    messages: [
      { role: 'system', content: SUMMARIZE_SYSTEM_PROMPT },
      ...messages,
      { role: 'user', content: '请基于以上对话生成摘要' },
    ],
    stream: false,
  };

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LLM summary timeout')), timeoutMs),
  );

  const apiPromise = callDeepSeekSync(summaryReq, {
    apiKey: opts.apiKey,
  }).then((res) => {
    if (res.status !== 200) {
      throw new Error(`DeepSeek returned ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
    }
    const body = res.body as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content || content.trim().length === 0) {
      throw new Error('LLM summary returned empty content');
    }
    return content.trim();
  });

  return Promise.race([apiPromise, timeoutPromise]);
}

// ── compaction trigger / output item helpers ───────────────────────────────

export const COMPACTION_ITEM_TYPE = 'compaction';
export const COMPACTION_TRIGGER_TYPE = 'compaction_trigger';

/**
 * Extract compaction_trigger items from an input array.
 * Returns the triggers found and the filtered input with triggers removed.
 */
export function extractCompactionTriggers(input: unknown): {
  compactionTriggers: Array<Record<string, unknown>>;
  filteredInput: unknown[];
} {
  const compactionTriggers: Array<Record<string, unknown>> = [];
  const filteredInput: unknown[] = [];

  if (!Array.isArray(input)) return { compactionTriggers, filteredInput: [] };

  for (const item of input) {
    if (
      item &&
      typeof item === 'object' &&
      (item as Record<string, unknown>).type === COMPACTION_TRIGGER_TYPE
    ) {
      compactionTriggers.push(item as Record<string, unknown>);
    } else {
      filteredInput.push(item);
    }
  }

  return { compactionTriggers, filteredInput };
}

/**
 * Extract compaction input items (from a previous round) from an input array.
 * Decodes encrypted_content and returns the compacted messages.
 */
export function extractCompactionInputItems(input: unknown): {
  messages: ChatMessage[] | null;
  filteredInput: unknown[];
} {
  const filteredInput: unknown[] = [];
  let decodedMessages: ChatMessage[] | null = null;

  if (!Array.isArray(input)) return { messages: null, filteredInput: [] };

  for (const item of input) {
    const record = item as Record<string, unknown>;
    if (
      record &&
      record.type === COMPACTION_ITEM_TYPE &&
      typeof record.encrypted_content === 'string'
    ) {
      try {
        const decoded = decodeCompactionPayload(record.encrypted_content);
        if (decoded?.messages?.length) {
          // Take the messages from the first valid compaction item
          if (!decodedMessages) decodedMessages = decoded.messages;
        }
      } catch {
        // Silently skip corrupted compaction items
      }
    } else {
      filteredInput.push(item);
    }
  }

  return { messages: decodedMessages, filteredInput };
}

/**
 * Build a compaction output item matching the OpenAI Responses API spec.
 * The encrypted_content is a base64-encoded JSON blob with messages + metadata.
 */
export function buildCompactionOutputItem(
  compactResult: CompactResult & { compactedId: string },
): Record<string, unknown> {
  const payload = {
    compactedId: compactResult.compactedId,
    messages: compactResult.compactedMessages,
    timestamp: Date.now(),
  };
  const encryptedContent = Buffer.from(JSON.stringify(payload)).toString('base64');

  return {
    type: COMPACTION_ITEM_TYPE,
    id: `comp_${randomBytes(8).toString('hex')}`,
    encrypted_content: encryptedContent,
  };
}

// ── internal ────────────────────────────────────────────────────────────────

interface CompactPayload {
  compactedId?: string;
  messages?: ChatMessage[];
  timestamp?: number;
}

function decodeCompactionPayload(encoded: string): CompactPayload | null {
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf-8');
    const parsed = JSON.parse(json) as CompactPayload;
    // Validate minimal shape
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}
