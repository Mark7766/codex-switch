/**
 * OpenAI Responses API ⇄ DeepSeek Chat Completions 协议转换。
 * 移植自 codex-deepseek-installer/proxy/deepseek-proxy.mjs。
 */

const VALID_ROLES = new Set(['system', 'user', 'assistant', 'tool']);

export interface ChatMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  reasoning_content?: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }>;
  stream?: boolean;
}

export interface ResponsesItem {
  type?: string;
  role?: string;
  content?: unknown;
  call_id?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  output?: unknown;
}

export interface ResponsesTool {
  type?: string;
  name?: string;
  description?: string;
  parameters?: unknown;
  function?: { name?: string; description?: string; parameters?: unknown };
}

export function normalizeRole(r: string | undefined): string {
  const lower = (r || 'user').toLowerCase();
  if (lower === 'developer') return 'system';
  return VALID_ROLES.has(lower) ? lower : 'user';
}

/**
 * 把 Responses API 的 input items 转换为 DeepSeek Chat messages。
 * @param input Responses API input 数组
 * @param reasoningMap call_id → reasoning_content 的全局映射
 */
export function itemsToMessages(
  input: unknown,
  reasoningMap: Map<string, string> = new Map(),
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (!Array.isArray(input)) return messages;

  let i = 0;
  while (i < input.length) {
    const raw = input[i];

    if (typeof raw === 'string') {
      messages.push({ role: 'user', content: raw });
      i++;
      continue;
    }

    const item = raw as ResponsesItem;

    if (item.type === 'function_call_output') {
      messages.push({
        role: 'tool',
        tool_call_id: item.call_id ?? '',
        content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? ''),
      });
      i++;
      continue;
    }

    if (item.type === 'function_call') {
      // DeepSeek requires ALL tool_calls from the same assistant turn to live in ONE
      // assistant message. Consume all consecutive function_call items together.
      const toolCalls: NonNullable<ChatMessage['tool_calls']> = [];
      let reasoning: string | undefined;
      while (i < input.length && (input[i] as ResponsesItem).type === 'function_call') {
        const fc = input[i] as ResponsesItem;
        const callId = fc.call_id || fc.id || `call_${Date.now()}`;
        toolCalls.push({
          id: callId,
          type: 'function',
          function: {
            name: fc.name || '',
            arguments:
              typeof fc.arguments === 'string' ? fc.arguments : JSON.stringify(fc.arguments ?? {}),
          },
        });
        const rc = reasoningMap.get(callId);
        if (rc && !reasoning) reasoning = rc;
        i++;
      }
      const msg: ChatMessage = { role: 'assistant', content: null, tool_calls: toolCalls };
      if (reasoning) msg.reasoning_content = reasoning;
      messages.push(msg);
      continue;
    }

    const role = normalizeRole(item.role);
    let content = '';
    if (typeof item.content === 'string') {
      content = item.content;
    } else if (Array.isArray(item.content)) {
      content = item.content
        .map((c: unknown) => {
          if (typeof c === 'string') return c;
          if (c && typeof c === 'object' && 'text' in c) {
            const text = (c as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    if (content) messages.push({ role, content });
    i++;
  }

  return messages;
}

/**
 * Codex 在同一连接的后续轮次中只发 function_call_output 而不重发 function_call,
 * 这里把上一轮保存的 function_call 注入回去，DeepSeek 才不会拒绝。
 */
export function fixOrphanedToolResults(
  input: unknown,
  lastToolCalls: ResponsesItem[],
): ResponsesItem[] {
  if (!Array.isArray(input)) return [];
  if (!lastToolCalls?.length) return input as ResponsesItem[];

  const result: ResponsesItem[] = [];
  for (const item of input as ResponsesItem[]) {
    if (item.type === 'function_call_output') {
      const hasPreceding = result.some(
        (x) => x.type === 'function_call' && x.call_id === item.call_id,
      );
      if (!hasPreceding) {
        const tc = lastToolCalls.find((t) => t.call_id === item.call_id) || lastToolCalls[0];
        if (tc) {
          result.push(tc.call_id === item.call_id ? tc : { ...tc, call_id: item.call_id });
        }
      }
    }
    result.push(item);
  }
  return result;
}

/**
 * DeepSeek rejects any conversation where an assistant message that contains
 * `tool_calls` is not IMMEDIATELY followed by one `tool` message per call_id.
 * Codex CLI sometimes inserts "Approved command…" user messages between the
 * assistant tool-call message and the tool results, which triggers a 400.
 *
 * This function rebuilds the message array so that every `assistant{tool_calls}`
 * block is immediately followed by its matching tool messages (in call-order,
 * with empty stubs for any missing ones). Non-tool messages that were
 * originally interleaved are deferred to after the completed tool block.
 *
 * Unlike the previous version this processes ALL assistant{tool_calls} blocks
 * in the array, not just the last one — necessary for long conversations where
 * approval messages may appear in earlier turns as well.
 */
export function fixToolMessageOrder(messages: ChatMessage[]): ChatMessage[] {
  // Indices of tool messages that have already been placed immediately after
  // their corresponding assistant{tool_calls} message.
  const consumed = new Set<number>();
  const result: ChatMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    if (consumed.has(i)) continue;

    const msg = messages[i];
    if (!msg) continue;

    if (msg.role !== 'assistant' || !msg.tool_calls?.length) {
      result.push(msg);
      continue;
    }

    // Assistant message with tool_calls — emit it, then immediately emit
    // all matching tool messages (in toolCallIds order, stubs for missing).
    result.push(msg);
    const toolCallIds = msg.tool_calls.map((tc) => tc.id);

    // Look ahead for matching tool messages (first occurrence per call_id wins).
    const toolMsgByCallId = new Map<string, { idx: number; msg: ChatMessage }>();
    for (let j = i + 1; j < messages.length; j++) {
      const m = messages[j];
      if (!m || consumed.has(j)) continue;
      if (m.role === 'tool' && m.tool_call_id && toolCallIds.includes(m.tool_call_id)) {
        if (!toolMsgByCallId.has(m.tool_call_id)) {
          toolMsgByCallId.set(m.tool_call_id, { idx: j, msg: m });
        }
      }
    }

    // Emit in toolCallIds order; fill any missing call_ids with an empty stub.
    for (const id of toolCallIds) {
      const found = toolMsgByCallId.get(id);
      if (found) {
        result.push(found.msg);
        consumed.add(found.idx);
      } else {
        result.push({ role: 'tool', tool_call_id: id, content: '' });
      }
    }
  }

  return result;
}

export function extractTools(tools: unknown): ChatRequest['tools'] {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const result: NonNullable<ChatRequest['tools']> = [];
  for (const t of tools as ResponsesTool[]) {
    if (t.type === 'web_search' || t.type === 'web_search_preview') continue;
    const name = t.function?.name || t.name || '';
    if (!name) continue;
    result.push({
      type: 'function',
      function: {
        name,
        description: t.function?.description || t.description || '',
        parameters: t.function?.parameters ||
          t.parameters || {
            type: 'object',
            properties: {},
          },
      },
    });
  }
  return result.length > 0 ? result : undefined;
}

/** DeepSeek 官方接受的模型白名单，命中即直接透传。 */
export const VALID_DEEPSEEK_MODELS = new Set<string>([
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-coder',
]);

/** 前缀兜底规则：当精确映射 / 白名单都未命中时，按前缀分流。顺序敏感（更具体的在前）。 */
export const PREFIX_RULES: ReadonlyArray<{ prefix: string; target: string }> = [
  { prefix: 'gpt-5-codex', target: 'deepseek-v4-flash' },
  { prefix: 'gpt-4o-mini', target: 'deepseek-v4-flash' },
  { prefix: 'gpt-4o', target: 'deepseek-v4-flash' },
  { prefix: 'gpt-4-turbo', target: 'deepseek-v4-pro' },
  { prefix: 'gpt-4', target: 'deepseek-v4-pro' },
  { prefix: 'gpt-3.5', target: 'deepseek-v4-flash' },
  { prefix: 'gpt-', target: 'deepseek-v4-flash' },
  { prefix: 'o1-mini', target: 'deepseek-v4-flash' },
  { prefix: 'o1', target: 'deepseek-v4-pro' },
  { prefix: 'o3-mini', target: 'deepseek-v4-flash' },
  { prefix: 'o3', target: 'deepseek-v4-pro' },
  { prefix: 'text-davinci', target: 'deepseek-v4-flash' },
];

export type ModelMatchKind = 'exact' | 'whitelist' | 'prefix' | 'fallback';

export interface ModelMapResult {
  model: string;
  matched: ModelMatchKind;
}

/**
 * 详细版映射：返回命中类型，便于上层日志区分（exact/whitelist 走静默；prefix/fallback 应打 WARN）。
 */
export function resolveModel(
  requested: string | undefined,
  mapping: Record<string, string>,
  fallback = 'deepseek-v4-flash',
): ModelMapResult {
  if (!requested) return { model: fallback, matched: 'fallback' };
  if (Object.prototype.hasOwnProperty.call(mapping, requested)) {
    return { model: mapping[requested]!, matched: 'exact' };
  }
  if (VALID_DEEPSEEK_MODELS.has(requested)) {
    return { model: requested, matched: 'whitelist' };
  }
  for (const rule of PREFIX_RULES) {
    if (requested.startsWith(rule.prefix)) {
      return { model: rule.target, matched: 'prefix' };
    }
  }
  return { model: fallback, matched: 'fallback' };
}

/**
 * 模型映射：精确 → 白名单 → 前缀 → fallback。
 * 未知模型一律命中 fallback，绝不透传给 DeepSeek。
 */
export function mapModel(
  requested: string | undefined,
  mapping: Record<string, string>,
  fallback = 'deepseek-v4-flash',
): string {
  return resolveModel(requested, mapping, fallback).model;
}
