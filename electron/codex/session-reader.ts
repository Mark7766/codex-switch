/**
 * session-reader.ts — Codex sessions JSONL 只读访问（v1.13.0）
 *
 * 从 Codex 自己的 ~/.codex/sessions/ 目录读取对话历史，作为代理缓存未命中时的
 * 权威回退数据源。
 *
 * 纯只读——不写任何东西。不依赖 ndjson、不依赖 compact。
 *
 * 实现策略：扫描 ~/.codex/sessions/YYYY/MM/DD/ 目录树，匹配 rollout JSONL 文件。
 * 不依赖 SQLite（避免 node:sqlite 实验性 API 的平台兼容问题）。
 */
import { readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { codexDir } from './paths';
import log from 'electron-log';

// ── types ───────────────────────────────────────────────────────────────────

/** JSONL 文件中一行的顶层结构。消息嵌套在 response_item.payload 内。 */
interface RolloutLine {
  type: string;
  payload?: Record<string, unknown>;
}

/** 判断 payload 是否为 message 类型，并提取 role/content。 */
function extractMessage(payload: Record<string, unknown>): SessionMessage | null {
  const innerType = payload.type as string | undefined;
  // 顶层 type="message" 的旧格式，或 response_item payload 内 type="message"
  if (innerType !== 'message') return null;
  const role = (payload.role as string) ?? 'user';
  const content = payload.content as SessionMessage['content'];
  if (!role || content === undefined) return null;
  const msg: SessionMessage = { role, content };
  if (payload.tool_calls) {
    msg.tool_calls = payload.tool_calls as SessionMessage['tool_calls'];
  }
  if (payload.tool_call_id) {
    msg.tool_call_id = payload.tool_call_id as string;
  }
  if (payload.name) {
    msg.name = payload.name as string;
  }
  return msg;
}

/** 已解析的对话消息（原样保留 Responses 格式，不翻译）。 */
export interface SessionMessage {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

// ── paths ───────────────────────────────────────────────────────────────────

function sessionsDir(): string {
  return join(codexDir(), 'sessions');
}

// ── directory scanning ──────────────────────────────────────────────────────

/** 递归扫描 sessions 目录下的所有 .jsonl 文件路径。 */
async function scanRolloutFiles(): Promise<string[]> {
  const results: string[] = [];
  const base = sessionsDir();

  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      try {
        const s = await stat(full);
        if (s.isDirectory()) {
          await walk(full);
        } else if (s.isFile() && name.endsWith('.jsonl') && name.startsWith('rollout-')) {
          results.push(full);
        }
      } catch {
        // skip unreadable
      }
    }
  }

  await walk(base);
  // 按修改时间倒序（新在前），方便优先匹配最近的对话
  return results.sort().reverse();
}

/**
 * 在 rollout 文件名中匹配 response_id 的 UUID 部分。
 * rollout 文件名格式: rollout-YYYY-MM-DDTHH-mm-ss-{uuid}.jsonl
 * response_id 是一个带连字符的 UUID，如 resp_xxx 或纯 UUID。
 */
function fileNameMatchesResponseId(fileName: string, responseId: string): boolean {
  // 规范化：去掉 resp_ 前缀和连字符
  const normalized = responseId.replace(/^resp_/, '').replace(/-/g, '');
  const base = fileName.replace(/\.jsonl$/, '');
  // 提取 rollout 文件名中 UUID 部分（时间戳之后的部分）
  const parts = base.split('-');
  // rollout-YYYY-MM-DDTHH-mm-ss-{uuid...}
  // uuid 部分从第 5 段开始（YYYY, MM, DDTHH, mm, ss, uuid...）
  if (parts.length < 6) return false;
  const uuidPart = parts.slice(5).join('-').replace(/-/g, '');
  // 双向包含匹配：两者互为子串
  return normalized.includes(uuidPart) || uuidPart.includes(normalized);
}

/** 扫描查找匹配 response_id 的 rollout 文件。 */
async function findRolloutPath(responseId: string): Promise<string | null> {
  if (!responseId) return null;
  const files = await scanRolloutFiles();
  for (const file of files) {
    const base = file.split('/').pop() ?? file.split('\\').pop() ?? '';
    if (fileNameMatchesResponseId(base, responseId)) {
      return file;
    }
  }
  return null;
}

// ── JSONL parsing ───────────────────────────────────────────────────────────

/**
 * 从 JSONL 文件解析出对话消息（filter type: "message"）。
 * 保持原始 Responses 格式，不做格式翻译。
 */
async function parseRolloutFile(filePath: string): Promise<SessionMessage[]> {
  const messages: SessionMessage[] = [];
  try {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as RolloutLine;
        // 两种格式兼容:
        // 1. 顶层 type="message" (旧版 Codex)
        // 2. 顶层 type="response_item", payload.type="message" (Codex v0.140+)
        if (entry.type === 'message' && entry.payload) {
          const msg = extractMessage(entry.payload);
          if (msg) messages.push(msg);
        } else if (entry.type === 'response_item' && entry.payload) {
          const msg = extractMessage(entry.payload);
          if (msg) messages.push(msg);
        }
      } catch {
        // 跳过损坏行
      }
    }
  } catch {
    log.warn('[session-reader] JSONL 文件读取失败：%s', filePath);
  }
  return messages;
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * 检查 Codex sessions 目录是否存在。
 */
export async function hasCodexSessions(): Promise<boolean> {
  try {
    await stat(sessionsDir());
    return true;
  } catch {
    return false;
  }
}

/**
 * 给定一个 response_id，从 Codex 的 sessions 目录读取该对话的完整消息历史。
 *
 * @returns 消息数组（按时间顺序），未找到时返回空数组。
 */
export async function readSessionHistory(responseId: string): Promise<SessionMessage[]> {
  if (!responseId) return [];

  const rolloutPath = await findRolloutPath(responseId);
  if (!rolloutPath) {
    log.info(
      '[session-reader] 未找到 Codex rollout 文件 for responseId=%s',
      responseId.slice(0, 16),
    );
    return [];
  }

  log.info('[session-reader] 从 Codex JSONL 回退读取会话：%s', rolloutPath);
  return parseRolloutFile(rolloutPath);
}

/**
 * 读取会话历史并转换为 ChatMessage 格式（用于缓存未命中 fallback）。
 *
 * SessionMessage 的 content 可能是 Responses API 的 content 数组格式
 * （如 [{type:"input_text", text:"hello"}]），需要提取为纯文本字符串。
 */
export async function readSessionHistoryAsChatMessages(
  responseId: string,
): Promise<Array<{ role: string; content: string }>> {
  const raw = await readSessionHistory(responseId);
  return raw.map(toChatMessage);
}

function toChatMessage(msg: SessionMessage): { role: string; content: string } {
  let content: string;
  if (typeof msg.content === 'string') {
    content = msg.content;
  } else if (Array.isArray(msg.content)) {
    content = msg.content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n');
  } else {
    content = '';
  }
  return { role: msg.role, content };
}

/**
 * 统计 sessions 目录下的 rollout 文件数量（粗略的会话计数）。
 */
export async function countSessions(): Promise<number> {
  try {
    const files = await scanRolloutFiles();
    return files.length;
  } catch {
    return 0;
  }
}
