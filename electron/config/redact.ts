/**
 * 日志脱敏（v3.0.0 从 `electron/proxy/errors.ts` 迁出）。
 *
 * 代理删除后仍有消费者：`electron/server-client/telemetry.ts` 在遥测上报前清洗属性
 * （诊断包已不含日志，故不再需要在这里脱敏）。所以它不能再住在 `proxy/` 里。
 *
 * 放在 `electron/config/` 是因为这里已是跨切面基础设施（store / secrets / providers），
 * 且不依赖任何业务模块；它也不是 Codex/Claude 专属，故不适合放进那两个目录。
 */

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  // 最小长度取 4 而非 8：遥测里出现过 `.slice(0, 50)` 截断后残留的短片段（TASK-098）
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
