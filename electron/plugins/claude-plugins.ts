/**
 * Claude Desktop plugin list — hardcoded for v1.12.0.
 *
 * Curated 20 recommended + 150+ optional plugins from the official
 * marketplace (anthropics/claude-plugins-official) and external repos.
 */
export interface ClaudePluginEntry {
  name: string;
  path: string;
  category: string;
  recommended: boolean;
}

export const RECOMMENDED_COUNT = 20;

/** All 170+ plugins with metadata */
export const ALL_CLAUDE_PLUGINS: ClaudePluginEntry[] = [
  // ── Superpowers (14, all recommended) ──────────────────────────────────
  {
    name: 'brainstorming',
    path: 'external_repos/obra__superpowers/skills/brainstorming',
    category: '开发流程',
    recommended: true,
  },
  {
    name: 'writing-plans',
    path: 'external_repos/obra__superpowers/skills/writing-plans',
    category: '开发流程',
    recommended: true,
  },
  {
    name: 'executing-plans',
    path: 'external_repos/obra__superpowers/skills/executing-plans',
    category: '开发流程',
    recommended: true,
  },
  {
    name: 'test-driven-development',
    path: 'external_repos/obra__superpowers/skills/test-driven-development',
    category: '开发流程',
    recommended: true,
  },
  {
    name: 'systematic-debugging',
    path: 'external_repos/obra__superpowers/skills/systematic-debugging',
    category: '开发流程',
    recommended: true,
  },
  {
    name: 'subagent-driven-development',
    path: 'external_repos/obra__superpowers/skills/subagent-driven-development',
    category: '开发流程',
    recommended: true,
  },
  {
    name: 'verification-before-completion',
    path: 'external_repos/obra__superpowers/skills/verification-before-completion',
    category: '开发流程',
    recommended: true,
  },
  {
    name: 'requesting-code-review',
    path: 'external_repos/obra__superpowers/skills/requesting-code-review',
    category: '协作',
    recommended: true,
  },
  {
    name: 'receiving-code-review',
    path: 'external_repos/obra__superpowers/skills/receiving-code-review',
    category: '协作',
    recommended: true,
  },
  {
    name: 'finishing-a-development-branch',
    path: 'external_repos/obra__superpowers/skills/finishing-a-development-branch',
    category: '协作',
    recommended: true,
  },
  {
    name: 'using-git-worktrees',
    path: 'external_repos/obra__superpowers/skills/using-git-worktrees',
    category: '工具',
    recommended: true,
  },
  {
    name: 'dispatching-parallel-agents',
    path: 'external_repos/obra__superpowers/skills/dispatching-parallel-agents',
    category: '工具',
    recommended: true,
  },
  {
    name: 'writing-skills',
    path: 'external_repos/obra__superpowers/skills/writing-skills',
    category: '工具',
    recommended: true,
  },
  {
    name: 'using-superpowers',
    path: 'external_repos/obra__superpowers/skills/using-superpowers',
    category: '入门',
    recommended: true,
  },

  // ── Built-in marketplace plugins (6 recommended) ──────────────────────
  {
    name: 'frontend-design',
    path: 'marketplace/plugins/frontend-design/skills/frontend-design',
    category: '创作',
    recommended: true,
  },
  {
    name: 'playground',
    path: 'marketplace/plugins/playground',
    category: '创作',
    recommended: true,
  },
  {
    name: 'math-olympiad',
    path: 'marketplace/plugins/math-olympiad/skills/math-olympiad',
    category: '创作',
    recommended: true,
  },
  {
    name: 'claude-md-improver',
    path: 'marketplace/plugins/claude-md-management/skills/claude-md-improver',
    category: '工具',
    recommended: true,
  },
  {
    name: 'feature-dev',
    path: 'marketplace/plugins/feature-dev',
    category: '开发流程',
    recommended: true,
  },
  {
    name: 'code-review',
    path: 'marketplace/plugins/code-review',
    category: '协作',
    recommended: true,
  },

  // ── Other built-in items ──────────────────────────────────────────────
  {
    name: 'agent-sdk-dev',
    path: 'marketplace/plugins/agent-sdk-dev',
    category: '工具',
    recommended: false,
  },
  {
    name: 'claude-code-setup',
    path: 'marketplace/plugins/claude-code-setup',
    category: '入门',
    recommended: false,
  },
  {
    name: 'code-modernization',
    path: 'marketplace/plugins/code-modernization',
    category: '开发流程',
    recommended: false,
  },
  {
    name: 'code-simplifier',
    path: 'marketplace/plugins/code-simplifier',
    category: '开发流程',
    recommended: false,
  },
  {
    name: 'commit-commands',
    path: 'marketplace/plugins/commit-commands',
    category: '工具',
    recommended: false,
  },
  {
    name: 'cwc-makers',
    path: 'marketplace/plugins/cwc-makers',
    category: '创作',
    recommended: false,
  },
  {
    name: 'explanatory-output-style',
    path: 'marketplace/plugins/explanatory-output-style',
    category: '工具',
    recommended: false,
  },
  {
    name: 'hookify',
    path: 'marketplace/plugins/hookify/skills/writing-rules',
    category: '工具',
    recommended: false,
  },
  {
    name: 'learning-output-style',
    path: 'marketplace/plugins/learning-output-style',
    category: '入门',
    recommended: false,
  },
  {
    name: 'mcp-server-dev',
    path: 'marketplace/plugins/mcp-server-dev',
    category: '工具',
    recommended: false,
  },
  {
    name: 'mcp-tunnels',
    path: 'marketplace/plugins/mcp-tunnels',
    category: '工具',
    recommended: false,
  },
  {
    name: 'plugin-dev',
    path: 'marketplace/plugins/plugin-dev',
    category: '工具',
    recommended: false,
  },
  {
    name: 'pr-review-toolkit',
    path: 'marketplace/plugins/pr-review-toolkit',
    category: '协作',
    recommended: false,
  },
  {
    name: 'ralph-loop',
    path: 'marketplace/plugins/ralph-loop',
    category: '开发流程',
    recommended: false,
  },
  {
    name: 'security-guidance',
    path: 'marketplace/plugins/security-guidance',
    category: '安全',
    recommended: false,
  },
  {
    name: 'session-report',
    path: 'marketplace/plugins/session-report/skills/session-report',
    category: '工具',
    recommended: false,
  },
  {
    name: 'skill-creator',
    path: 'marketplace/plugins/skill-creator/skills/skill-creator',
    category: '工具',
    recommended: false,
  },

  // ── External repos (selected ~50 high-value plugins) ──────────────────
  {
    name: 'adobe-for-creativity',
    path: 'external_repos/adobe__skills/plugins/creative-cloud/adobe-for-creativity',
    category: '创作',
    recommended: false,
  },
  { name: 'stripe', path: 'external_repos/stripe__ai', category: '数据', recommended: false },
  {
    name: 'vercel',
    path: 'external_repos/vercel__vercel-plugin',
    category: '云服务',
    recommended: false,
  },
  {
    name: 'cloudflare',
    path: 'external_repos/cloudflare__skills',
    category: '云服务',
    recommended: false,
  },
  {
    name: 'datadog',
    path: 'external_repos/datadog-labs__claude-code-plugin',
    category: '云服务',
    recommended: false,
  },
  {
    name: 'figma',
    path: 'external_repos/figma__mcp-server-guide',
    category: '设计',
    recommended: false,
  },
  {
    name: 'notion',
    path: 'external_repos/makenotion__claude-code-notion-plugin',
    category: '数据',
    recommended: false,
  },
  {
    name: 'slack',
    path: 'external_repos/slackapi__slack-mcp-plugin',
    category: '协作',
    recommended: false,
  },
  { name: 'github', path: 'external_repos/github__github', category: '协作', recommended: false },
  { name: 'gitlab', path: 'external_repos/gitlab__gitlab', category: '协作', recommended: false },
  { name: 'linear', path: 'external_repos/linear__linear', category: '协作', recommended: false },
  {
    name: 'playwright',
    path: 'external_repos/playwright__playwright',
    category: '工具',
    recommended: false,
  },
  {
    name: 'terraform',
    path: 'external_repos/terraform__terraform',
    category: '云服务',
    recommended: false,
  },
  {
    name: 'firebase',
    path: 'external_repos/firebase__firebase',
    category: '云服务',
    recommended: false,
  },
  {
    name: 'supabase',
    path: 'external_repos/supabase-community__supabase-plugin',
    category: '数据库',
    recommended: false,
  },
  {
    name: 'mongodb',
    path: 'external_repos/mongodb__agent-skills',
    category: '数据库',
    recommended: false,
  },
  {
    name: 'prisma',
    path: 'external_repos/prisma__claude-plugin',
    category: '数据库',
    recommended: false,
  },
  {
    name: 'sentry',
    path: 'external_repos/getsentry__sentry-for-claude',
    category: '工具',
    recommended: false,
  },
  {
    name: 'posthog',
    path: 'external_repos/PostHog__ai-plugin',
    category: '数据',
    recommended: false,
  },
  {
    name: 'airtable',
    path: 'external_repos/Airtable__skills',
    category: '数据',
    recommended: false,
  },
  {
    name: 'firecrawl',
    path: 'external_repos/firecrawl__firecrawl-claude-plugin',
    category: '工具',
    recommended: false,
  },
  {
    name: 'chrome-devtools',
    path: 'external_repos/ChromeDevTools__chrome-devtools-mcp',
    category: '工具',
    recommended: false,
  },
  {
    name: 'exa',
    path: 'external_repos/exa-labs__exa-mcp-server',
    category: '工具',
    recommended: false,
  },
  {
    name: 'context7',
    path: 'external_repos/context7__context7',
    category: '工具',
    recommended: false,
  },
  {
    name: 'aws-core',
    path: 'external_repos/aws__agent-toolkit-for-aws',
    category: '云服务',
    recommended: false,
  },
  {
    name: 'huggingface',
    path: 'external_repos/huggingface__skills',
    category: '工具',
    recommended: false,
  },
  {
    name: 'neon',
    path: 'external_repos/neondatabase__agent-skills',
    category: '数据库',
    recommended: false,
  },
  {
    name: 'planetscale',
    path: 'external_repos/planetscale__claude-plugin',
    category: '数据库',
    recommended: false,
  },
  {
    name: 'zapier',
    path: 'external_repos/zapier__zapier-mcp',
    category: '工具',
    recommended: false,
  },
  { name: 'twilio', path: 'external_repos/twilio__ai', category: '工具', recommended: false },
  {
    name: 'postman',
    path: 'external_repos/Postman-Devrel__postman-claude-code-plugin',
    category: '工具',
    recommended: false,
  },
  { name: 'miro', path: 'external_repos/miroapp__miro-ai', category: '设计', recommended: false },
  {
    name: 'pagerduty',
    path: 'external_repos/PagerDuty__claude-code-plugins',
    category: '协作',
    recommended: false,
  },
  {
    name: 'buildkite',
    path: 'external_repos/buildkite__skills',
    category: '协作',
    recommended: false,
  },
  {
    name: 'duckdb',
    path: 'external_repos/duckdb__duckdb-skills',
    category: '数据库',
    recommended: false,
  },
  { name: 'qdrant', path: 'external_repos/qdrant__skills', category: '数据库', recommended: false },
  {
    name: 'appwrite',
    path: 'external_repos/appwrite__claude-plugin',
    category: '云服务',
    recommended: false,
  },
  {
    name: 'algolia',
    path: 'external_repos/algolia__algolia',
    category: '工具',
    recommended: false,
  },
  {
    name: 'semgrep',
    path: 'external_repos/semgrep__mcp-marketplace',
    category: '安全',
    recommended: false,
  },
  {
    name: 'aikido',
    path: 'external_repos/AikidoSec__aikido-claude-plugin',
    category: '安全',
    recommended: false,
  },
  {
    name: '42crunch',
    path: 'external_repos/42Crunch-AI__claude-plugins',
    category: '安全',
    recommended: false,
  },
  {
    name: 'intercom',
    path: 'external_repos/intercom__claude-plugin-external',
    category: '协作',
    recommended: false,
  },
  { name: 'box', path: 'external_repos/box__box-for-ai', category: '创作', recommended: false },
  { name: 'wix', path: 'external_repos/wix__skills', category: '创作', recommended: false },
  {
    name: 'mapbox',
    path: 'external_repos/mapbox__mapbox-agent-skills',
    category: '创作',
    recommended: false,
  },
  {
    name: 'discord',
    path: 'external_repos/discord__discord',
    category: '协作',
    recommended: false,
  },
  {
    name: 'imessage',
    path: 'external_repos/imessage__imessage',
    category: '协作',
    recommended: false,
  },
  {
    name: 'telegram',
    path: 'external_repos/telegram__telegram',
    category: '协作',
    recommended: false,
  },
  {
    name: 'pydantic',
    path: 'external_repos/pydantic__skills',
    category: '开发流程',
    recommended: false,
  },
  {
    name: 'clickhouse',
    path: 'external_repos/ClickHouse__clickhouse-claude-code-plugin',
    category: '数据库',
    recommended: false,
  },
];

/** Get recommended plugins only */
export function getRecommendedPlugins(): ClaudePluginEntry[] {
  return ALL_CLAUDE_PLUGINS.filter((p) => p.recommended);
}

/** Group plugins by category for UI display */
export function getPluginsByCategory(): Record<string, ClaudePluginEntry[]> {
  const groups: Record<string, ClaudePluginEntry[]> = {};
  for (const p of ALL_CLAUDE_PLUGINS) {
    if (!groups[p.category]) groups[p.category] = [];
    groups[p.category]!.push(p);
  }
  return groups;
}
