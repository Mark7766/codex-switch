import https from 'node:https';
import type { ChatRequest } from './translate';
import type { ReasoningStore } from './reasoning';

const DEEPSEEK_BASE = 'api.deepseek.com';

export type SseEvent = (type: string, payload: Record<string, unknown>) => void;

export interface DeepSeekDeps {
  apiKey: string;
  agent?: https.Agent;
}

export interface SyncResponse {
  status: number;
  body: Record<string, unknown>;
}

/**
 * 非流式调用 DeepSeek Chat Completions。
 */
export function callDeepSeekSync(body: ChatRequest, deps: DeepSeekDeps): Promise<SyncResponse> {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: DEEPSEEK_BASE,
        path: '/v1/chat/completions',
        method: 'POST',
        agent: deps.agent,
        headers: {
          Authorization: `Bearer ${deps.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(buf) });
          } catch (e) {
            reject(new Error(`Parse: ${(e as Error).message}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

interface ToolCallAcc {
  outputIdx: number;
  id: string;
  callId: string;
  name: string;
  args: string;
}

export interface StreamResult {
  outputItems: Array<Record<string, unknown>>;
  reasoningContent: string;
}

/**
 * 流式调用 DeepSeek，将增量转换成 Responses API 事件序列。
 */
export function streamDeepSeek(
  chatReq: ChatRequest,
  respId: string,
  onEvent: SseEvent,
  deps: DeepSeekDeps,
  reasoningStore: ReasoningStore,
): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ ...chatReq, stream: true });
    let buffer = '';
    let textItemId: string | null = null;
    let textOutputIdx = -1;
    let accText = '';
    let accReasoning = '';
    let nextOutputIdx = 0;
    const toolCalls: Record<number, ToolCallAcc> = {};

    const req = https.request(
      {
        hostname: DEEPSEEK_BASE,
        path: '/v1/chat/completions',
        method: 'POST',
        agent: deps.agent,
        headers: {
          Authorization: `Bearer ${deps.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (dsRes) => {
        if (dsRes.statusCode !== 200) {
          let e = '';
          dsRes.on('data', (c) => (e += c));
          dsRes.on('end', () =>
            reject(new Error(`DeepSeek ${dsRes.statusCode}: ${e.slice(0, 300)}`)),
          );
          return;
        }

        dsRes.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed.choices?.[0]?.delta;
              if (!delta) continue;

              if (delta.reasoning_content) accReasoning += delta.reasoning_content;

              if (delta.content) {
                if (!textItemId) {
                  textItemId = `msg_${Date.now()}`;
                  textOutputIdx = nextOutputIdx++;
                  onEvent('response.output_item.added', {
                    output_index: textOutputIdx,
                    item: {
                      id: textItemId,
                      type: 'message',
                      status: 'in_progress',
                      role: 'assistant',
                      content: [],
                    },
                  });
                  onEvent('response.content_part.added', {
                    item_id: textItemId,
                    output_index: textOutputIdx,
                    content_index: 0,
                    part: { type: 'output_text', text: '', annotations: [] },
                  });
                }
                accText += delta.content;
                onEvent('response.output_text.delta', {
                  item_id: textItemId,
                  output_index: textOutputIdx,
                  content_index: 0,
                  delta: delta.content,
                });
              }

              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!toolCalls[idx]) {
                    const fcId = `fc_${Date.now()}_${idx}`;
                    const callId = tc.id || `call_${Date.now()}_${idx}`;
                    const fcOutputIdx = nextOutputIdx++;
                    toolCalls[idx] = {
                      outputIdx: fcOutputIdx,
                      id: fcId,
                      callId,
                      name: tc.function?.name || '',
                      args: '',
                    };
                    onEvent('response.output_item.added', {
                      output_index: fcOutputIdx,
                      item: {
                        id: fcId,
                        type: 'function_call',
                        status: 'in_progress',
                        name: tc.function?.name || '',
                        call_id: callId,
                        arguments: '',
                      },
                    });
                    if (tc.function?.arguments) {
                      toolCalls[idx]!.args += tc.function.arguments;
                      onEvent('response.function_call_arguments.delta', {
                        item_id: fcId,
                        output_index: fcOutputIdx,
                        delta: tc.function.arguments,
                      });
                    }
                  } else {
                    const fc = toolCalls[idx]!;
                    if (tc.id && tc.id !== fc.callId) fc.callId = tc.id;
                    if (tc.function?.name && !fc.name) fc.name = tc.function.name;
                    if (tc.function?.arguments) {
                      fc.args += tc.function.arguments;
                      onEvent('response.function_call_arguments.delta', {
                        item_id: fc.id,
                        output_index: fc.outputIdx,
                        delta: tc.function.arguments,
                      });
                    }
                  }
                }
              }
            } catch {
              /* ignore malformed SSE chunk */
            }
          }
        });

        dsRes.on('end', () => {
          const outputItems: Array<Record<string, unknown> | null> = new Array(nextOutputIdx).fill(
            null,
          );

          if (textItemId) {
            onEvent('response.output_text.done', {
              item_id: textItemId,
              output_index: textOutputIdx,
              content_index: 0,
              text: accText,
            });
            onEvent('response.content_part.done', {
              item_id: textItemId,
              output_index: textOutputIdx,
              content_index: 0,
              part: { type: 'output_text', text: accText, annotations: [] },
            });
            const ti = {
              id: textItemId,
              type: 'message',
              status: 'completed',
              role: 'assistant',
              content: [{ type: 'output_text', text: accText, annotations: [] }],
            };
            onEvent('response.output_item.done', { output_index: textOutputIdx, item: ti });
            outputItems[textOutputIdx] = ti;
          }

          for (const fc of Object.values(toolCalls)) {
            onEvent('response.function_call_arguments.done', {
              item_id: fc.id,
              output_index: fc.outputIdx,
              arguments: fc.args,
            });
            const fi = {
              id: fc.id,
              type: 'function_call',
              status: 'completed',
              name: fc.name,
              call_id: fc.callId,
              arguments: fc.args,
            };
            onEvent('response.output_item.done', { output_index: fc.outputIdx, item: fi });
            outputItems[fc.outputIdx] = fi;
            if (accReasoning) reasoningStore.set(fc.callId, accReasoning);
          }

          const finalOutput = outputItems.filter(Boolean) as Array<Record<string, unknown>>;
          onEvent('response.completed', {
            response: {
              id: respId,
              object: 'response',
              status: 'completed',
              model: chatReq.model,
              output: finalOutput,
            },
          });
          resolve({ outputItems: finalOutput, reasoningContent: accReasoning });
        });

        dsRes.on('error', reject);
      },
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
