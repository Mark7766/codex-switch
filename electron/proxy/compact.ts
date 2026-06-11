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

// ── public API ──────────────────────────────────────────────────────────────

/** 判断是否需要压缩。messages.length > threshold 时返回 true。 */
export function shouldCompact(messages: ChatMessage[], threshold?: number): boolean {
  return messages.length > (threshold ?? DEFAULT_THRESHOLD);
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
    const summaryMsg = buildMessages(
      'system',
      `[对话历史摘要] ${summaryText}`,
    );
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
