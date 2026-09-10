/**
 * 供应商注册表 —— Codex / Claude 接入配置的**唯一事实来源**（v3.0.0）。
 *
 * 背景：配置 Codex 与配置 Claude 本是同一套机器（都是「往某个端点写地址 + Key + 模型表」），
 * 此前每个供应商的地址、模型表、Key 账户散落在 writer / desktop-writer / env-writer /
 * secrets / migrations / Settings.tsx / ModelMappingModal 七八个文件里，同一份事实最多抄五遍
 * （已因此产生两次漂移 bug）。现在集中到这里，新增供应商（如阿里 Qwen）＝ 加一条数据。
 *
 * ⚠️ **本模块必须是纯数据 + 纯函数，且描述符里不得出现函数或 RegExp**：
 * 渲染进程通过 IPC 通道 `providers:list` 拿到 `PROVIDER_LIST`（见 main.ts）。任何不可
 * JSON 序列化的东西都会让那条通道静默失效——`tests/unit/providers.test.ts` 有对应断言。
 */

import type { UserPreferences } from './store';

export type ProviderId = 'deepseek' | 'glm' | 'custom';

/** 供应商 Key 在 electron-store 回退存储中的字段名（keytar 不可用时使用）。 */
export type KeyFallbackField = 'apiKey' | 'glmApiKey' | 'customApiKey';

export interface ProviderCodexConfig {
  /** config.toml 的 `model_provider` 值，同时也是 `[model_providers.X]` 的段名。 */
  providerId: string;
  /** `[model_providers.X].name`。 */
  name: string;
  /** Codex 端点。`'custom'` 表示由用户在设置里填写。 */
  baseUrl: string | 'custom';
  /** `model_reasoning_effort`。deepseek="high"、glm="max"（照各自官方文档）、custom="xhigh"。 */
  reasoningEffort: string;
  /** deepseek 官方模板要求写 `preferred_auth_method`。 */
  preferredAuthMethod?: string;
  /** deepseek 官方模板要求写 `forced_login_method`。 */
  forcedLoginMethod?: string;
  /** 用 `experimental_bearer_token` 把 Key 直接写进 config.toml（deepseek / glm 官方模板）。 */
  bearerTokenInToml: boolean;
  /** 用 `requires_openai_auth = true` + auth.json 鉴权（自定义供应商模板）。 */
  requiresOpenAiAuth: boolean;
  /** 写 1M 上下文窗口与 900K 自动压缩阈值（自定义供应商模板）。 */
  contextWindowOverrides: boolean;
  /** 写 `[features] enable_request_compression=false` / `remote_compaction_v2=false`。 */
  featureFlags: boolean;
  /** 可选模型列表（设置页下拉与 Claude 模型映射共用）。 */
  models: string[];
  /** 新建配置时的默认模型。 */
  defaultModel: string;
  /** 打包的模型目录资产文件名。有值时写入共享的 `~/.codex/models.json`（合并写）。 */
  catalogAsset?: string;
  /** 已下线但用户可能仍存着的模型名 → 新名（精确匹配），仅供显示层折叠。 */
  retiredModels?: Record<string, string>;
  /** 已下线的旧模型名前缀，仅供显示层折叠。 */
  retiredPrefixes?: string[];
}

/** Claude 的三个档位。env 变量字段与 Desktop 的 labelOverride 都按档位取默认模型。 */
export type ClaudeTier = 'opus' | 'sonnet' | 'haiku';

export interface ProviderClaudeConfig {
  /** Claude 端点（Anthropic Messages 兼容）。`'custom'` 表示由用户填写。 */
  baseUrl: string | 'custom';
  /** 可选模型列表。 */
  models: string[];
  /** Claude 档位（Claude Desktop / CLI 的模型映射槽位）。 */
  slots: Array<{ id: string; tier: ClaudeTier; label: string }>;
  /** 各档位的默认上游模型。 */
  roleDefaults: Record<ClaudeTier, string>;
  /** 是否给 Claude Desktop 配置 Haiku 档（自定义供应商不配，与 v1.16.0 行为一致）。 */
  includeHaiku: boolean;
  /**
   * 属于本供应商的模型名前缀。
   *
   * 用途：判断「已保存的模型名是否属于别的供应商」——若以**其他**供应商的任一前缀开头，
   * 就视为串了供应商、回退到本供应商默认值。此前这段判断是手写的 O(n²) 组合矩阵
   * （每加一个供应商要改 n 处），现改为按注册表推导。
   */
  acceptedModelPrefixes: string[];
}

export interface ProviderKeyConfig {
  /** keytar account。 */
  account: string;
  /** electron-store 回退字段。 */
  fallbackField: KeyFallbackField;
  /** 必填前缀（deepseek 要求 sk-）。 */
  prefix?: string;
  /** 最短长度。 */
  minLength: number;
  placeholder: string;
  hint: string;
}

export interface ProviderDescriptor {
  id: ProviderId;
  /** 展示名。所有供应商在 v3.0.0 都是直连，故不再需要「· 直连」后缀。 */
  label: string;
  codex: ProviderCodexConfig;
  claude: ProviderClaudeConfig;
  key: ProviderKeyConfig;
}

/** Claude 的三个档位（Claude Desktop 与 Claude Code CLI 共用）。 */
const CLAUDE_SLOTS: ProviderClaudeConfig['slots'] = [
  { id: 'claude-opus-4-7', tier: 'opus', label: 'Claude Opus 4.7' },
  { id: 'claude-sonnet-4-6', tier: 'sonnet', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', tier: 'haiku', label: 'Claude Haiku 4.5' },
];

/**
 * 自定义供应商原样透传 Claude 原生模型名。
 *
 * 注意：必须包含 `roleDefaults` 用到的三个名字（含不带日期后缀的 `claude-haiku-4-5`），
 * 否则「默认值不在自己的可选列表里」——用户看不出默认档位是什么，也没法手动选回去。
 */
const CLAUDE_NATIVE_MODELS = [
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
];

const DEEPSEEK_MODELS = ['deepseek-flash', 'deepseek-v4-pro'];
const GLM_MODELS = ['glm-5.3', 'glm-5.3-flash', 'glm-5.2'];

/**
 * 供应商注册表。新增供应商（如阿里 Qwen）在此加一条即可；若该供应商需要独立的
 * `~/.codex/models.json` 目录，再加一个 json 资产并在 electron-builder.yml 的
 * extraResources 里声明。
 */
export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    codex: {
      providerId: 'deepseek',
      name: 'deepseek',
      // 尾斜杠照官方模板逐字节保留，勿「规范化」
      baseUrl: 'https://api.deepseek.com/',
      reasoningEffort: 'high',
      preferredAuthMethod: 'apikey',
      forcedLoginMethod: 'api',
      bearerTokenInToml: true,
      requiresOpenAiAuth: false,
      contextWindowOverrides: false,
      featureFlags: false,
      models: DEEPSEEK_MODELS,
      defaultModel: 'deepseek-flash',
      catalogAsset: 'deepseek-models.json',
      // v3.0.0 前的旧名仍可调用，但已不在选项里；存量用户存着它们时折叠为新名显示
      retiredPrefixes: ['deepseek-v4-flash'],
    },
    claude: {
      baseUrl: 'https://api.deepseek.com/anthropic',
      models: [...DEEPSEEK_MODELS].reverse(),
      slots: CLAUDE_SLOTS,
      roleDefaults: {
        opus: 'deepseek-v4-pro',
        sonnet: 'deepseek-flash',
        haiku: 'deepseek-flash',
      },
      includeHaiku: true,
      acceptedModelPrefixes: ['deepseek'],
    },
    key: {
      account: 'deepseek-api-key',
      fallbackField: 'apiKey',
      prefix: 'sk-',
      minLength: 10,
      placeholder: '新的 sk-...',
      hint: '在 platform.deepseek.com 获取 API Key',
    },
  },

  glm: {
    id: 'glm',
    label: '智谱 GLM',
    codex: {
      // 智谱官方 Codex 模板：https://docs.bigmodel.cn/cn/coding-plan/tool/codex
      providerId: 'ZAI',
      name: 'ZAI',
      baseUrl: 'https://open.bigmodel.cn/api/v1',
      reasoningEffort: 'max',
      bearerTokenInToml: true,
      requiresOpenAiAuth: false,
      contextWindowOverrides: false,
      featureFlags: false,
      models: GLM_MODELS,
      defaultModel: 'glm-5.3',
      catalogAsset: 'glm-models.json',
    },
    claude: {
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      models: GLM_MODELS,
      slots: CLAUDE_SLOTS,
      roleDefaults: {
        opus: 'glm-5.3',
        sonnet: 'glm-5.3-flash',
        haiku: 'glm-5.3-flash',
      },
      includeHaiku: true,
      acceptedModelPrefixes: ['glm'],
    },
    key: {
      account: 'glm-api-key',
      fallbackField: 'glmApiKey',
      minLength: 10,
      placeholder: '智谱 GLM API Key',
      hint: '在 open.bigmodel.cn 或 z.ai 获取 API Key',
    },
  },

  custom: {
    id: 'custom',
    label: '自定义',
    codex: {
      providerId: 'custom',
      name: '自定义',
      baseUrl: 'custom',
      reasoningEffort: 'xhigh',
      bearerTokenInToml: false,
      requiresOpenAiAuth: true,
      contextWindowOverrides: true,
      featureFlags: true,
      models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-high', 'gpt-5.4-mini', 'codex-auto-review'],
      defaultModel: 'gpt-5.5',
    },
    claude: {
      baseUrl: 'custom',
      models: CLAUDE_NATIVE_MODELS,
      slots: CLAUDE_SLOTS,
      roleDefaults: {
        opus: 'claude-opus-4-7',
        sonnet: 'claude-sonnet-4-6',
        haiku: 'claude-haiku-4-5',
      },
      includeHaiku: false,
      // 自定义供应商原样透传 Claude 名，故 claude- 是它的「自家前缀」
      acceptedModelPrefixes: ['claude-'],
    },
    key: {
      account: 'custom-api-key',
      fallbackField: 'customApiKey',
      minLength: 10,
      placeholder: 'API Key',
      hint: '在 API 服务商后台获取 Key',
    },
  },
};

/** 供 IPC 传给渲染层的纯数据列表。顺序即设置页下拉顺序。 */
export const PROVIDER_LIST: ProviderDescriptor[] = [
  PROVIDERS.deepseek,
  PROVIDERS.glm,
  PROVIDERS.custom,
];

/**
 * v3.0.0: `'agnes'` 已被移除，但存量配置里可能仍存着它。
 *
 * **只在读路径归一化，绝不写回。** 用户明确选择「不做任何处理」——不加迁移、不弹提示、
 * 不清钥匙串。这里的唯一目的是防止 `PROVIDERS['agnes']` 得到 undefined 后在每次启动 /
 * 保存时抛 TypeError（那会让整个应用不可用）。
 *
 * 归一化的结果只有在用户**自己**重新选择并保存时才会落盘，这是预期行为（那时下拉的值
 * 就是新供应商），不是我们替他做的迁移。
 */
export function normalizeProvider(value: unknown): ProviderId {
  return value === 'deepseek' || value === 'glm' || value === 'custom' ? value : 'deepseek';
}

/** 取描述符；未知值（含存量 'agnes'）归一化到默认供应商，避免 undefined 崩溃。 */
export function getProvider(id: unknown): ProviderDescriptor {
  return PROVIDERS[normalizeProvider(id)];
}

/**
 * 「切换到 OpenAI 官方」时要整段剥离的 `[model_providers.X]` 段名正则。
 *
 * ⚠️ 由注册表派生，**不要手写**：v3.0.0 新增 GLM 直连（providerId `ZAI`）时若漏掉它，
 * GLM 的段会残留在切回 OpenAI 后的 config.toml 里，让 Codex 继续把请求发给 GLM ——
 * 这正是 BUG-007（v2.3.0 修过）的同类重犯。
 */
export function managedProviderBlockPattern(): RegExp {
  const ids = PROVIDER_LIST.map((p) => p.codex.providerId);
  return new RegExp(`^model_providers\\.(${ids.join('|')})$`);
}

/** 解析某供应商的 Claude 端点：`custom` 时取用户在设置里填的地址。 */
export function resolveClaudeBaseUrl(
  descriptor: ProviderDescriptor,
  prefs: Pick<UserPreferences, 'customProvider'>,
): string {
  return descriptor.claude.baseUrl === 'custom'
    ? (prefs.customProvider?.claudeBaseUrl ?? '')
    : descriptor.claude.baseUrl;
}
