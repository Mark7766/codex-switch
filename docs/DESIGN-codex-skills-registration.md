# Design: Codex 插件技能注册 — 安装提示词优化

- **日期**：2026-06-17
- **状态**：方案设计，待 Review
- **版本**：v1.12.0 补充

---

## 1. 问题

当前 Codex 插件安装提示词只做了"解包安装"，插件文件放到了正确位置，但 Codex 不会自动把插件里的技能注册到**活跃技能列表**。用户装完 173 个插件后，技能面板里看不到任何新技能——等于白装。

根因：Codex 的技能发现机制不会自动扫描 `~/.codex/plugins/cache/` 下的技能目录。需要显式创建 symlink 到 `~/.codex/skills/` 才能被识别。

## 2. 方案

在原安装提示词末尾追加一段"技能注册"步骤，让 Codex 在安装完成后自动执行。

### 2.1 技能注册命令

```
请帮我注册所有 Codex 插件中的技能到活跃技能列表。

步骤：
1. 找到 ~/.codex/plugins/cache/ 下的插件目录
2. 扫描 openai-primary-runtime/ 下 4 个核心技能和 openai-curated/ 下所有插件的 skills 子目录
3. 对每个技能创建 symlink 到 ~/.codex/skills/
   命名规则：插件名__技能名（双下划线防重名）
4. 过滤掉需要外部账号的 SaaS 插件（如 Notion、Slack、Jira 等），只保留通用开发类
5. 完成后告诉我总共注册了多少个技能
```

### 2.2 合并后的完整安装提示词

把原安装命令和技能注册合并为**一条指令**，用户粘贴一次即完成安装+注册：

```
你帮安装一下离线插件安装包 {路径} ，我要把这些插件都加载到codex里。

安装完成后，请帮我注册所有 Codex 插件中的技能到活跃技能列表。
找到 ~/.codex/plugins/cache/ 下的 openai-primary-runtime/ 的 4 个核心技能
和 openai-curated/ 下所有插件的 skills 子目录，
创建 symlink 到 ~/.codex/skills/，
命名用 插件名__技能名 防重名。
过滤掉需要外部账号的 SaaS 插件（Notion、Slack、Jira、Linear 等），
只保留通用开发类。
完成后告诉我注册了多少个。
```

### 2.3 客户端生成逻辑

`PluginManager.getInstallCommand()` 在 `type='codex'` 时返回上述完整指令。只需修改一处字符串拼接，在现有安装指令末尾追加 `\n\n安装完成后，请帮我注册所有 Codex 插件中的技能...`。

## 3. 命名规则详解

| 原始路径                                                | symlink 名称                       |
| ------------------------------------------------------- | ---------------------------------- |
| `openai-primary-runtime/plans/skills/planning`          | `plans__planning`                  |
| `openai-curated/frontend-design/skills/frontend-design` | `frontend-design__frontend-design` |
| `openai-curated/code-review/skills/code-review`         | `code-review__code-review`         |

> 双下划线 `__` 作为分隔符：左边是插件名，右边是技能名。避免不同插件有同名技能时冲突。

## 4. SaaS 过滤规则

需要过滤的插件特征（硬编码在指令中即可，不需要精确列表）：

- 插件名或技能说明中包含：Notion、Slack、Jira、Linear、Figma、Airtable、GitHub、GitLab、Bitbucket、Trello、Asana、Monday、Salesforce、HubSpot、Stripe、Intercom、Zendesk
- 技能依赖 OAuth / API Key / webhook 等外部认证

> 指令中用自然语言描述即可："过滤掉需要外部账号的 SaaS 插件（Notion、Slack、Jira、Linear 等），只保留通用开发类。" Codex 自己能理解并做判断。

## 5. 改动范围

| 文件                        | 改动                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| `electron/plugins/index.ts` | `getInstallCommand(type='codex')` 在返回字符串末尾追加技能注册段落 |
| 测试                        | 验证新提示词包含技能注册步骤                                       |

> 纯文本拼接，一行改动。不涉及 IPC、UI、Server。

---

> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
