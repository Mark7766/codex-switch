import type { IncomingMessage, ServerResponse } from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';

const DEEPSEEK_ANTHROPIC_HOST = 'api.deepseek.com';
const ANTHROPIC_VERSION = '2023-06-01';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ClaudeDesktopModelMap {
  sonnet: { model: string; supports1m: boolean };
  opus: { model: string; supports1m: boolean };
  haiku: { model: string; supports1m: boolean };
}

export const DEFAULT_CLAUDE_DESKTOP_MODEL_MAP: ClaudeDesktopModelMap = {
  sonnet: { model: 'deepseek-v4-pro', supports1m: true },
  opus: { model: 'deepseek-v4-pro', supports1m: true },
  haiku: { model: 'deepseek-v4-flash', supports1m: false },
};

export interface AnthropicRelayOptions {
  apiKey: string;
  modelMap: ClaudeDesktopModelMap;
}

/**
 * Structured log entry emitted by handleAnthropicMessages.
 * Mirrors the relevant subset of ProxyLogEntry (source is always 'claude-desktop').
 * Defined here to avoid circular imports with server.ts.
 */
export interface AnthropicLogEntry {
  level: 'info' | 'warn' | 'error';
  source: 'claude-desktop';
  message: string;
  reqId?: string;
  phase?: 'start' | 'stub' | 'success' | 'error';
  durationMs?: number;
  model?: string;
  requestedModel?: string;
  statusCode?: number;
  errorReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
}

// ─── Virtual Claude model catalogue ─────────────────────────────────────────

type ClaudeRole = 'sonnet' | 'opus' | 'haiku';

interface ClaudeModelEntry {
  id: string;
  role: ClaudeRole;
  contextWindow: number;
}

export const CLAUDE_MODELS: ClaudeModelEntry[] = [
  { id: 'claude-sonnet-4-5', role: 'sonnet', contextWindow: 1_048_576 },
  { id: 'claude-sonnet-4-6', role: 'sonnet', contextWindow: 200_000 },
  { id: 'claude-3-7-sonnet-20250219', role: 'sonnet', contextWindow: 1_048_576 },
  { id: 'claude-3-5-sonnet-20241022', role: 'sonnet', contextWindow: 200_000 },
  { id: 'claude-opus-4-5', role: 'opus', contextWindow: 1_048_576 },
  { id: 'claude-3-opus-20240229', role: 'opus', contextWindow: 200_000 },
  { id: 'claude-haiku-4-5', role: 'haiku', contextWindow: 200_000 },
  { id: 'claude-3-5-haiku-20241022', role: 'haiku', contextWindow: 200_000 },
  { id: 'claude-3-haiku-20240307', role: 'haiku', contextWindow: 200_000 },
];

/**
 * The two models exposed to Claude Desktop via the `inferenceModels` profile field.
 * Claude Desktop's model picker shows only these, preventing unwanted capability probing.
 */
export const INFERENCE_MODELS: ClaudeModelEntry[] = [
  { id: 'claude-haiku-4-5', role: 'haiku', contextWindow: 200_000 },
  { id: 'claude-sonnet-4-6', role: 'sonnet', contextWindow: 200_000 },
];

/** Resolve a Claude model ID to its role. Falls back to 'sonnet'. */
function inferRole(claudeModelId: string): ClaudeRole {
  const entry = CLAUDE_MODELS.find((m) => m.id === claudeModelId);
  if (entry) return entry.role;
  const id = claudeModelId.toLowerCase();
  if (id.includes('opus')) return 'opus';
  if (id.includes('haiku')) return 'haiku';
  return 'sonnet';
}

/** Resolve a Claude model ID to the actual DeepSeek model name. */
export function resolveAnthropicModel(
  claudeModelId: string,
  modelMap: ClaudeDesktopModelMap,
): string {
  const role = inferRole(claudeModelId);
  // Strip capability suffixes like [1m] from the stored model name
  return modelMap[role].model.replace(/\[[^\]]+\]$/, '');
}

// ─── Route handlers ──────────────────────────────────────────────────────────

/** Handle GET /anthropic/v1/models */
export function handleAnthropicModels(
  res: ServerResponse,
  opts: AnthropicRelayOptions,
): void {
  if (!opts.apiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        type: 'error',
        error: { type: 'authentication_error', message: 'Missing DeepSeek API key' },
      }),
    );
    return;
  }
  const models = INFERENCE_MODELS.map((m) => ({
    id: m.id,
    type: 'model',
    display_name: m.id,
    created_at: '2024-01-01T00:00:00Z',
    context_window: m.contextWindow,
  }));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      data: models,
      has_more: false,
      first_id: models[0]?.id ?? null,
      last_id: models[models.length - 1]?.id ?? null,
    }),
  );
}

/**
 * Handle POST /anthropic/v1/messages
 * Rewrites the model field and byte-streams the response from DeepSeek.
 */
export function handleAnthropicMessages(
  req: IncomingMessage,
  res: ServerResponse,
  opts: AnthropicRelayOptions,
  onLog: (entry: AnthropicLogEntry) => void,
): void {
  if (!opts.apiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        type: 'error',
        error: { type: 'authentication_error', message: 'Missing DeepSeek API key' },
      }),
    );
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'Invalid JSON body' },
        }),
      );
      return;
    }

    const requestedModel = typeof body['model'] === 'string' ? body['model'] : '';
    const deepseekModel = resolveAnthropicModel(requestedModel, opts.modelMap);
    body['model'] = deepseekModel;

    const reqId = 'req_' + randomBytes(3).toString('hex');
    const startTs = Date.now();

    // Inspect body for diagnostics
    const msgs = Array.isArray(body['messages']) ? (body['messages'] as Array<{ role: string }>) : [];
    const toolDefs = Array.isArray(body['tools']) ? (body['tools'] as Array<{ name?: string }>) : [];
    const lastRole = msgs[msgs.length - 1]?.role ?? 'none';
    const sysRaw = body['system'];
    const sysPreview =
      typeof sysRaw === 'string'
        ? sysRaw.slice(0, 60).replace(/\n/g, '↵')
        : Array.isArray(sysRaw)
          ? JSON.stringify(sysRaw).slice(0, 60)
          : '';
    const toolInfo = toolDefs.length > 0 ? ` tools=[${toolDefs.map((t) => t.name ?? '?').join(',')}]` : '';

    // Sub-agent dispatch detection:
    // Claude Desktop routes every user message to multiple parallel sub-agents
    // (each with a specialized tool set, msgs=1). These sub-agents are meaningless
    // for DeepSeek which can't execute Claude's tools — stub them immediately.
    // Also stub continuation requests (lastRole=assistant): Claude Desktop sends
    // these when it thinks the previous reply was truncated; DeepSeek doesn't
    // support continuation and would just generate a redundant follow-up.
    const isSubAgentDispatch =
      msgs.length === 1 && msgs[0]?.role === 'user' && toolDefs.length > 0;
    const isContinuation = msgs.length > 0 && lastRole === 'assistant';
    const stubReason = isSubAgentDispatch ? 'sub-agent' : isContinuation ? 'continuation' : null;

    if (stubReason) {
      onLog({
        level: 'info',
        source: 'claude-desktop',
        reqId,
        phase: 'stub',
        message: `[${stubReason} stub] ${requestedModel} msgs=${msgs.length} tools=${toolDefs.length} — skipped, not forwarded to DeepSeek`,
        model: deepseekModel,
        requestedModel,
      });
      const stubId = 'msg_stub_' + randomBytes(3).toString('hex');
      const stubMsg = {
        id: stubId,
        type: 'message',
        role: 'assistant',
        content: [] as unknown[],
        model: requestedModel,
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      };
      if (body['stream'] === true) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        });
        res.write(`data: ${JSON.stringify({ type: 'message_start', message: { ...stubMsg, stop_reason: null } })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stubMsg));
      }
      return;
    }

    onLog({
      level: 'info',
      source: 'claude-desktop',
      reqId,
      phase: 'start',
      message: `Claude Desktop → /anthropic/v1/messages  ${requestedModel} → ${deepseekModel} · msgs=${msgs.length} lastRole=${lastRole}${toolInfo}${sysPreview ? ` sys="${sysPreview}"` : ''}`,
      model: deepseekModel,
      requestedModel,
    });

    // Strip tools/tool_choice before forwarding: DeepSeek can't execute
    // Claude Desktop's proprietary tools (Agent/Bash/Edit/mcp__*), and forwarding
    // them causes a tool-use loop where DeepSeek returns tool_use stop_reason,
    // Claude Desktop "executes" the tool, replies, and DeepSeek loops again.
    delete body['tools'];
    delete body['tool_choice'];
    const bodyStr = JSON.stringify(body);

    const upstreamReq = https.request(
      {
        hostname: DEEPSEEK_ANTHROPIC_HOST,
        path: '/anthropic/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          'x-api-key': opts.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
      },
      (upstreamRes) => {
        const statusCode = upstreamRes.statusCode ?? 502;
        // Forward status + headers, then byte-stream the body (SSE or JSON)
        res.writeHead(statusCode, {
          'Content-Type':
            (upstreamRes.headers['content-type'] as string | undefined) ?? 'application/json',
          'Transfer-Encoding': 'chunked',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        });
        // Tap the stream to extract token usage from SSE / JSON without altering bytes.
        let inputTokens = 0;
        let outputTokens = 0;
        let stopReason = '';
        let sseBuf = '';
        const isSse = (upstreamRes.headers['content-type'] ?? '').toString().includes('event-stream');
        upstreamRes.on('data', (chunk: Buffer) => {
          res.write(chunk);
          if (isSse) {
            sseBuf += chunk.toString('utf-8');
            let idx;
            while ((idx = sseBuf.indexOf('\n')) !== -1) {
              const line = sseBuf.slice(0, idx).trim();
              sseBuf = sseBuf.slice(idx + 1);
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;
              try {
                const evt = JSON.parse(payload);
                if (evt?.type === 'message_start' && evt.message?.usage) {
                  inputTokens = evt.message.usage.input_tokens ?? inputTokens;
                  outputTokens = evt.message.usage.output_tokens ?? outputTokens;
                } else if (evt?.type === 'message_delta') {
                  if (evt.usage?.output_tokens != null) outputTokens = evt.usage.output_tokens;
                  if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
                }
              } catch {
                /* ignore malformed SSE chunk */
              }
            }
          } else {
            // JSON path: collect for end-of-stream parse
            sseBuf += chunk.toString('utf-8');
          }
        });
        upstreamRes.on('end', () => {
          res.end();
          if (!isSse && sseBuf) {
            try {
              const j = JSON.parse(sseBuf);
              inputTokens = j?.usage?.input_tokens ?? inputTokens;
              outputTokens = j?.usage?.output_tokens ?? outputTokens;
              stopReason = j?.stop_reason ?? stopReason;
            } catch {
              /* ignore */
            }
          }
          const durationMs = Date.now() - startTs;
          const tokenTag = inputTokens || outputTokens ? ` ↑${inputTokens}↓${outputTokens}` : '';
          onLog({
            level: 'info',
            source: 'claude-desktop',
            reqId,
            phase: 'success',
            durationMs,
            model: deepseekModel,
            requestedModel,
            statusCode,
            inputTokens,
            outputTokens,
            finishReason: stopReason,
            message: `✓ ${requestedModel} → ${deepseekModel} · ${durationMs}ms${tokenTag}`,
          });
        });
      },
    );

    upstreamReq.on('error', (e) => {
      const durationMs = Date.now() - startTs;
      onLog({
        level: 'error',
        source: 'claude-desktop',
        reqId,
        phase: 'error',
        durationMs,
        model: deepseekModel,
        requestedModel,
        errorReason: e.message,
        message: `Claude Desktop 代理错误：${e.message}`,
      });
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
      }
      if (!res.writableEnded) {
        res.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'api_error', message: 'Upstream unreachable' },
          }),
        );
      }
    });

    upstreamReq.write(bodyStr);
    upstreamReq.end();
  });
}

/**
 * Handle POST /anthropic/v1/count_tokens
 * Returns a rough token-count estimate so Claude Desktop's UI can display
 * context-usage progress without retrying on 404.
 */
export function handleAnthropicCountTokens(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    // Rough estimate: 1 token ≈ 4 UTF-8 bytes
    const bodyLen = chunks.reduce((sum, c) => sum + c.length, 0);
    const inputTokens = Math.max(1, Math.ceil(bodyLen / 4));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ input_tokens: inputTokens }));
  });
}
