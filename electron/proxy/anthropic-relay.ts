/**
 * anthropic-relay.ts — Anthropic Messages → Chat Completions（v1.13.0 Agnes）
 *
 * Claude Desktop / CLI 发 Anthropic Messages 请求到代理时，
 * 翻译为 OpenAI Chat Completions 发给上游（DeepSeek / Agnes）。
 *
 * v1.6.0 删除后恢复，仅用于非直连场景（如 Agnes）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import https from 'node:https';

// ── types ───────────────────────────────────────────────────────────────────

interface AnthropicRequest {
  model: string;
  messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
  max_tokens?: number;
  stream?: boolean;
  system?: string;
}

interface ChatMessage {
  role: string;
  content: string;
}

interface RelayDeps {
  apiKey: string;
  upstreamBase: string;
  defaultModel?: string;
  agent: https.Agent;
  log(entry: Record<string, unknown>): void;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function extractText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => p.text ?? '').join('\n');
  }
  return '';
}

/** Anthropic content block → Chat message text */
function anthropicToChat(messages: AnthropicRequest['messages']): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: extractText(m.content),
  }));
}

// ── public API ──────────────────────────────────────────────────────────────

export function handleAnthropicMessages(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RelayDeps,
): void {
  const reqId = `claude_${Date.now().toString(36)}`;
  const startedAt = Date.now();

  let body = '';
  req.on('data', (c: Buffer) => (body += c));
  req.on('end', () => {
    let parsed: AnthropicRequest;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ type: 'error', error: { message: 'Invalid JSON' } }));
      return;
    }

    const chatMsgs = anthropicToChat(parsed.messages);
    if (parsed.system) {
      chatMsgs.unshift({ role: 'system', content: parsed.system });
    }

    // v1.13.0: Claude 模型名 → 当前供应商的默认模型（上游决定）
    const actualModel = deps.defaultModel ?? 'deepseek-v4-flash';

    deps.log({
      level: 'info',
      source: 'claude',
      reqId,
      phase: 'start',
      message: `→ Claude 请求 ${parsed.model}→${actualModel} upstream=${deps.upstreamBase}`,
      requestedModel: parsed.model,
      model: actualModel,
    });

    const chatReq = {
      model: actualModel,
      messages: chatMsgs as Array<{ role: string; content: string }>,
      max_tokens: parsed.max_tokens ?? 4096,
      stream: false,
    };

    const data = JSON.stringify(chatReq);
    const upstreamReq = https.request(
      {
        hostname: deps.upstreamBase,
        path: '/v1/chat/completions',
        method: 'POST',
        agent: deps.agent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Authorization: `Bearer ${deps.apiKey}`,
        },
      },
      (upstreamRes) => {
        const chunks: Buffer[] = [];
        upstreamRes.on('data', (c: Buffer) => chunks.push(c));
        upstreamRes.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          const status = upstreamRes.statusCode ?? 502;

          if (status !== 200) {
            deps.log({
              level: 'error',
              source: 'claude',
              reqId,
              phase: 'error',
              message: `✗ Claude 请求失败 状态=${status}`,
              statusCode: status,
            });
            res.writeHead(status);
            res.end(raw);
            return;
          }

          // Parse Chat Completions → Anthropic response
          try {
            const ds = JSON.parse(raw) as {
              choices?: Array<{ message?: { content?: string } }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            const content = ds.choices?.[0]?.message?.content ?? '';
            const anthropicResp = {
              id: `msg_${reqId}`,
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: content }],
              model: parsed.model,
              stop_reason: 'end_turn',
              usage: {
                input_tokens: ds.usage?.prompt_tokens ?? 0,
                output_tokens: ds.usage?.completion_tokens ?? 0,
              },
            };
            const tokens = ds.usage;
            deps.log({
              level: 'info',
              source: 'claude',
              reqId,
              phase: 'success',
              message:
                `✓ Claude 请求成功 状态=200 耗时=${Date.now() - startedAt}ms model=${actualModel}` +
                (tokens ? ` ↑${tokens.prompt_tokens}↓${tokens.completion_tokens}` : ''),
              durationMs: Date.now() - startedAt,
              statusCode: 200,
              ...(tokens
                ? { inputTokens: tokens.prompt_tokens, outputTokens: tokens.completion_tokens }
                : {}),
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(anthropicResp));
          } catch {
            deps.log({
              level: 'error',
              source: 'claude',
              reqId,
              phase: 'error',
              message: '✗ Claude 响应解析失败',
              statusCode: 502,
            });
            res.writeHead(502);
            res.end(JSON.stringify({ type: 'error', error: { message: 'Upstream parse error' } }));
          }
        });
      },
    );
    upstreamReq.on('error', (e) => {
      deps.log({
        level: 'error',
        source: 'claude',
        reqId,
        phase: 'error',
        message: `✗ Claude 上游错误：${e.message}`,
      });
      res.writeHead(502);
      res.end(JSON.stringify({ type: 'error', error: { message: e.message } }));
    });
    upstreamReq.write(data);
    upstreamReq.end();
  });
}
