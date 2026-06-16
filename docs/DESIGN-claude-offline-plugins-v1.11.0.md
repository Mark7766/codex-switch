# Design: Claude 离线插件一键安装 — v1.12.0

- **日期**：2026-06-16
- **状态**：方案设计，待 Review
- **版本**：v1.12.0
- **关联**：v1.10.0 Codex 离线插件方案、Server plugins API

---

## 1. 背景与目标

### 1.1 为什么 Claude 也需要？

Codex Switch 的 v1.10.0 解决了 Codex 用户装不上插件的痛点。但 Claude 用户面临完全一样的问题——官方 marketplace 所有插件都托管在 GitHub，国内用户加载不出来。

Claude 有两个产品形态：**Claude Desktop Cowork**（桌面应用内置）和 **Claude Code CLI**（命令行）。两者的扩展都是 **skills 文件（`SKILL.md`）+ `.claude-plugin/plugin.json`**，纯文本、零运行时依赖。同一份离线包可以同时服务两者。

### 1.2 和 Codex 方案的差异

| 维度       | Codex 插件                  | Claude 扩展                                                                       |
| ---------- | --------------------------- | --------------------------------------------------------------------------------- |
| 离线包来源 | 1 个 marketplace            | 130+ 个 GitHub 仓库 → 聚合打包                                                    |
| 包大小     | 36 MB                       | 165 MB                                                                            |
| 支持产品   | Codex Desktop / CLI         | **Claude Desktop Cowork（默认）+ Claude Code CLI（可选）**                        |
| 安装方式   | 自然语言指令 → Codex 自己装 | Cowork：结构化指令 → `mcp__cowork__save_skill`；Code：提示词 → Claude Code 自己装 |
| 插件数量   | 173（全装）                 | 170（精选 20 推荐，其余可选）                                                     |
| Server API | `/api/v1/plugins/pack`      | **复用同一接口**，加 `?type=claude`                                               |

### 1.3 为什么不给用户选 Cowork 还是 Code？

**用户不需要选择**。下载同一份离线包后：

- **默认就是 Claude Desktop Cowork**——这是 95% 用户的使用场景
- 如果用户也想在 Claude Code 中安装→ 点击「Claude Code 安装」按钮 → 获得一条提示词 → 粘贴到 Claude Code 即可

不需要在 Tab 栏加切换、不需要在下载页选模式。Cowork 是主路，Code 是支路。简单。

---

## 2. 精选插件（快速安装默认选中）

### 2.1 精选清单（20 个）

| 序号 | 插件路径                                                                 | 用途                 | 分类     |
| :--: | ------------------------------------------------------------------------ | -------------------- | -------- |
|  1   | `external_repos/obra__superpowers/skills/brainstorming`                  | 需求分析与头脑风暴   | 开发流程 |
|  2   | `external_repos/obra__superpowers/skills/writing-plans`                  | 编写实施计划         | 开发流程 |
|  3   | `external_repos/obra__superpowers/skills/executing-plans`                | 按计划逐步执行       | 开发流程 |
|  4   | `external_repos/obra__superpowers/skills/test-driven-development`        | TDD 测试驱动开发     | 开发流程 |
|  5   | `external_repos/obra__superpowers/skills/systematic-debugging`           | 系统化调试           | 开发流程 |
|  6   | `external_repos/obra__superpowers/skills/subagent-driven-development`    | 子代理并行开发       | 开发流程 |
|  7   | `external_repos/obra__superpowers/skills/verification-before-completion` | 完成前验证           | 开发流程 |
|  8   | `external_repos/obra__superpowers/skills/requesting-code-review`         | 请求代码审查         | 协作     |
|  9   | `external_repos/obra__superpowers/skills/receiving-code-review`          | 响应审查反馈         | 协作     |
|  10  | `external_repos/obra__superpowers/skills/finishing-a-development-branch` | 完成开发分支         | 协作     |
|  11  | `external_repos/obra__superpowers/skills/using-git-worktrees`            | Git Worktree 隔离    | 工具     |
|  12  | `external_repos/obra__superpowers/skills/dispatching-parallel-agents`    | 并行任务分发         | 工具     |
|  13  | `external_repos/obra__superpowers/skills/writing-skills`                 | 编写新 Skill         | 工具     |
|  14  | `external_repos/obra__superpowers/skills/using-superpowers`              | Superpowers 使用指南 | 入门     |
|  15  | `marketplace/plugins/frontend-design`                                    | 前端 UI 设计         | 创作     |
|  16  | `marketplace/plugins/playground`                                         | 代码沙箱实验         | 创作     |
|  17  | `marketplace/plugins/math-olympiad`                                      | 数学奥林匹克         | 创作     |
|  18  | `marketplace/plugins/claude-md-improver`                                 | CLAUDE.md 优化       | 工具     |
|  19  | `marketplace/plugins/feature-dev`                                        | 功能开发流程         | 开发流程 |
|  20  | `marketplace/plugins/code-review`                                        | 代码审查             | 协作     |

> 前 14 个是 Superpowers 全系列（参考工程已深度验证），后 6 个是 marketplace 内置的高频 skill。

---

## 3. 用户交互流程

### 3.1 整体流程

```
进入 Claude tab
  │
  ├─ 查看包信息（20 精选 + 170 全量 / 165 MB）
  │
  ├─ [ 下载插件包 (165 MB) ]
  │
  ├─ 下载中（进度条 + 速度 + 剩余时间）
  │
  └─ 下载完成 → 进入安装模式选择
       │
       ├─ 🚀 快速安装（推荐）→ Cowork
       │    └─ 显示 20 个精选清单 → [ 📋 复制指令 ] → 粘贴到 Cowork ✓
       │
       ├─ 🔧 自定义安装 → Cowork
       │    ├─ 显示 170 个完整列表（预勾选 20 个精选）
       │    ├─ 搜索/筛选/全选/取消
       │    ├─ 勾选完成后 [ 📋 复制指令 ] → 粘贴到 Cowork ✓
       │    └─ 指令仅包含用户选中的插件
       │
       └─ 💻 安装到 Claude Code（可选）
            └─ [ 📋 复制 Claude Code 提示词 ] → 粘贴到 Claude Code ✓
```

### 3.2 快速安装页面

```
┌──────────────────────────────────────────────────┐
│  ✅ 下载完成！                                    │
│  已保存至：/Users/xxx/Downloads/claude-offline-   │
│  plugins.tar.gz                                  │
│                                                  │
│  ┌─ 🚀 快速安装（推荐）────────────────────┐      │
│  │                                          │      │
│  │  将安装以下 20 个精选插件：               │      │
│  │                                          │      │
│  │  开发流程 (11)：                          │      │
│  │  brainstorming, writing-plans,            │      │
│  │  executing-plans, test-driven-dev,        │      │
│  │  systematic-debugging, subagent-dev,      │      │
│  │  verification, feature-dev …              │      │
│  │                                          │      │
│  │  协作 (3)：code-review, requesting-        │      │
│  │  review, finishing-branch                 │      │
│  │                                          │      │
│  │  工具 (4)：git-worktrees, parallel-       │      │
│  │  agents, writing-skills, claude-md        │      │
│  │                                          │      │
│  │  创作 (2)：frontend-design, playground     │      │
│  │                                          │      │
│  │  ┌──────────────────────────────────┐    │      │
│  │  │ 我刚上传了 /Users/…/claude-     │    │      │
│  │  │ offline-plugins.tar.gz，把里    │    │      │
│  │  │ 面的以下 skill 全部装到 Cowork：│    │      │
│  │  │ …                                │    │      │
│  │  └──────────────────────────────────┘    │      │
│  │  [ 📋 复制指令 ]                          │      │
│  └──────────────────────────────────────────┘      │
│                                                  │
│  想要更多选择？→ [ 🔧 自定义安装 ]                 │
│                                                  │
│                                                  │
│  💻 安装到 Claude Code（可选）                      │
│  [ 📋 复制 Claude Code 提示词 ]                    │
│                                                  │
│  [ 重新下载 ]  [ 打开下载文件夹 ]                   │
└──────────────────────────────────────────────────┘
```

### 3.3 自定义安装页面

```
┌──────────────────────────────────────────────────┐
│  🔧 自定义安装                                    │
│  ┌──────────────────────────────────────────┐     │
│  │ 🔍 搜索插件…          [开发流程] [协作] …  │     │
│  ├──────────────────────────────────────────┤     │
│  │ ☑ brainstorming       开发流程 · 推荐     │     │
│  │ ☑ writing-plans       开发流程 · 推荐     │     │
│  │ ☑ executing-plans     开发流程 · 推荐     │     │
│  │ ☐ adobe-for-creativ…  创作               │     │
│  │ ☐ airtable            数据               │     │
│  │ ☐ alloydb             数据库             │     │
│  │ ☐ aws-core            云服务             │     │
│  │ ☑ claude-md-improver  工具 · 推荐         │     │
│  │ …（滚动列表，170 项）                      │     │
│  ├──────────────────────────────────────────┤     │
│  │ 已选 20 个  [全选] [取消] [恢复推荐]      │     │
│  └──────────────────────────────────────────┘     │
│                                                  │
│  [ 📋 复制指令（20 个插件）]                       │
│  [ 返回快速安装 ]                                  │
└──────────────────────────────────────────────────┘
```

### 3.4 切换模式

用户可以在快速安装和自定义安装之间自由切换：

- 快速安装 → "想要更多选择？→ 自定义安装" 链接
- 自定义安装 → "返回快速安装" 按钮
- 自定义安装中的勾选状态在切换时不丢失

---

## 4. 安装指令设计

### 4.1 核心原理

Claude Desktop Cowork 有 `mcp__cowork__save_skill` 工具，可以程序化安装 skill。安装指令是一个自动化脚本——找到 tar.gz、扫描 SKILL.md、逐个提取、调用 save_skill 安装。

### 4.2 快速安装指令（20 个精选）

```
我刚上传了 {路径}，把里面的以下 skill 全部装到 Cowork：

步骤：
1. ls /sessions/*/mnt/uploads/*.tar.gz 找到文件
2. 对以下每个 skill，执行 tar xzf <文件> -O <路径>/SKILL.md 读取内容

要安装的 skill（共 20 个）：

A. external_repos/obra__superpowers/skills/ 下全部 14 个：
   brainstorming / writing-plans / executing-plans /
   test-driven-development / systematic-debugging /
   subagent-driven-development / verification-before-completion /
   requesting-code-review / receiving-code-review /
   finishing-a-development-branch / using-git-worktrees /
   dispatching-parallel-agents / writing-skills / using-superpowers

B. marketplace/plugins/ 下 6 个：
   frontend-design / playground / math-olympiad /
   claude-md-improver / feature-dev / code-review

3. 每读到一个 SKILL.md：
   a. 去掉 YAML frontmatter（开头的 --- ... ---）
   b. 用 mcp__cowork__save_skill 保存，name 填目录名
   c. 点一次 Save
```

### 4.3 自定义安装指令（动态生成）

当用户只选了 3 个插件（brainstorming + frontend-design + playground），指令变成：

```
我刚上传了 {路径}，把里面的以下 skill 全部装到 Cowork：

步骤：
1. ls /sessions/*/mnt/uploads/*.tar.gz 找到文件
2. 对以下每个 skill，执行 tar xzf <文件> -O <路径>/SKILL.md 读取内容

要安装的 skill（共 3 个）：
   - external_repos/obra__superpowers/skills/brainstorming
   - marketplace/plugins/frontend-design
   - marketplace/plugins/playground

3. 每读到一个 SKILL.md：
   a. 去掉 YAML frontmatter（开头的 --- ... ---）
   b. 用 mcp__cowork__save_skill 保存，name 填目录名
   c. 点一次 Save
```

**指令只包含用户选中的插件**，不展示未选中的。

### 4.4 Claude Code 安装指令

Claude Code 不需要 `mcp__cowork__save_skill`——它和 Codex 一样，给一段自然语言，Claude Code 自己处理。

```
我刚下载了 {路径}，把里面的 skill 全部装到 Claude Code 里。

步骤：
1. 先解压：tar xzf {路径} -C /tmp/claude-plugins/
2. 扫描所有 SKILL.md：find /tmp/claude-plugins/ -name "SKILL.md"
3. 只装以下 skill（共 20 个精选，如需更多可以自己选）：

   A. external_repos/obra__superpowers/skills/ 下全部 14 个：
      brainstorming / writing-plans / executing-plans /
      test-driven-development / systematic-debugging /
      subagent-driven-development / verification-before-completion /
      requesting-code-review / receiving-code-review /
      finishing-a-development-branch / using-git-worktrees /
      dispatching-parallel-agents / writing-skills / using-superpowers

   B. marketplace/plugins/ 下 6 个：
      frontend-design / playground / math-olympiad /
      claude-md-improver / feature-dev / code-review

4. 每个 skill 读取 SKILL.md → 放到 ~/.claude/skills/<name>/SKILL.md
5. 加载完成后验证一下：ls ~/.claude/skills/
```

> 和 Cowork 不同，Claude Code 的 skills 只要放到 `~/.claude/skills/` 目录下就会自动加载，不需要调用 save_skill 工具。

### 4.5 指令生成规则

| 规则           | 说明                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| 路径替换       | `{路径}` 替换为实际下载的绝对路径                                                     |
| 超 14 个同前缀 | Superpowers 14 个合并写为"external_repos/obra\_\_superpowers/skills/ 下全部 14 个：…" |
| ≤ 14 个同前缀  | 每个列出完整路径                                                                      |
| 不同来源       | 用 A/B/C 分组标注                                                                     |
| 步骤说明       | 始终附带完整的 3 步操作指南                                                           |

---

## 5. 技术设计

### 5.1 Server 端变更

#### 5.1.1 接口复用，增加 type 参数

```
GET /api/v1/plugins/pack?type=codex   ← 默认，行为不变
GET /api/v1/plugins/pack?type=claude  ← 新增
```

**当 `type=claude` 时返回**：与 `type=codex` 同结构，仅字段值不同。

```json
{
  "code": 0,
  "data": {
    "type": "claude",
    "version": "1.0.0",
    "filename": "claude-offline-plugins.tar.gz",
    "size": 173015040,
    "size_mb": 165,
    "plugin_count": 170,
    "description": "含 Superpowers 全系列 14 个 + 内置精品 6 个（精选 20），共 170+ 可选",
    "updated_at": "2026-06-15",
    "download_url": "/api/v1/plugins/pack/download?type=claude"
  }
}
```

**和 Codex 响应的区别**：仅 `type` / `filename` / `size` / `description` 字段值不同，结构完全一致。

> 插件列表（精选 20 个 + 完整 170+ 个）由**客户端硬编码**，Server 不返回。好处：
>
> - Server 端零额外逻辑
> - 客户端可以离线展示列表
> - 插件列表变更只需发新版客户端

**兼容性**：`type=codex` 时行为不变。

#### 5.1.2 下载接口

```
GET /api/v1/plugins/pack/download?type=claude
  → 302 → COS 广州 /files/claude-offline-plugins.tar.gz
  → COS 不可用 → 本地 FileResponse
```

#### 5.1.3 Server 端改动量

| 文件                                       | 改动   | 说明                                                                                       |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------ |
| `src/api/v1/plugins.py`                    | +10 行 | `get_plugin_pack()` 和 `download_plugin_pack()` 接受 `type` 参数，根据 type 返回对应包信息 |
| `data/files/claude-offline-plugins.tar.gz` | 新增   | 165MB，由现有 `upload-to-cos.sh --files` 上传                                              |

### 5.2 客户端变更

#### 5.2.1 新增/修改文件清单

```
codex-switch/
├── electron/
│   ├── plugins/
│   │   ├── index.ts                   # 修改：所有方法增加 type 参数
│   │   ├── types.ts                   # 修改：PluginPackInfo 增加 type 字段
│   │   └── claude-plugins.ts          # 新增：硬编码的 Claude 插件清单（170+ 条）
│   └── main.ts                        # 修改：IPC handler 透传 type 参数
├── src/
│   ├── pages/
│   │   └── Plugins.tsx                # 修改：Claude tab 完整重写（双模式）
│   ├── components/
│   │   └── PluginSelector.tsx         # 新增：自定义安装的插件选择列表
│   └── types/
│       └── global.d.ts                # 修改：类型扩展
└── tests/
    └── unit/
        └── plugins.test.ts            # 修改：增加 Claude 类型 + 指令生成测试
```

#### 5.2.2 PluginManager 变更

```typescript
// 所有方法增加 type 参数，默认 'codex' 保持兼容
async getPackInfo(type: 'codex' | 'claude' = 'codex'): Promise<PluginPackInfo>
async downloadPack(savePath: string, onProgress, type = 'codex'): Promise<string>
getInstallCommand(filePath: string, type: 'codex' | 'claude', selectedPlugins?: string[], target?: 'cowork' | 'code'): string
```

`getInstallCommand` 参数说明：

- `type='codex'` → 忽略其他参数，返回全装指令
- `type='claude'` + `target='cowork'`（默认）→ 返回 Cowork 安装指令（含 `mcp__cowork__save_skill` 步骤）
- `type='claude'` + `target='code'` → 返回 Claude Code 安装指令（解压→复制到 `~/.claude/skills/`）
- `selectedPlugins` 仅在 `type='claude'` 时生效

#### 5.2.3 插件列表硬编码

精选 20 个 + 完整 170+ 个列表**内置于客户端代码**，不走 Server API：

```
electron/plugins/
├── index.ts                       # 逻辑不变
├── types.ts                       # 类型不变
└── claude-plugins.ts              # 新增：硬编码的 Claude 插件清单
```

**`claude-plugins.ts` 数据结构**：

```typescript
interface ClaudePluginEntry {
  name: string; // 插件名（SKILL.md 所在目录名）
  path: string; // tar.gz 内完整路径（用于 tar xzf -O <path>/SKILL.md）
  category: string; // 分类：开发流程 / 协作 / 工具 / 创作 / 数据 / 云服务 / 安全 / 设计
  recommended: boolean; // 是否推荐（控制默认勾选）
}

/** 精选的 20 个推荐插件 */
export const RECOMMENDED_CLAUDE_PLUGINS: ClaudePluginEntry[] = [
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
  // … 共 20 个
];

/** 完整 170+ 插件清单 */
export const ALL_CLAUDE_PLUGINS: ClaudePluginEntry[] = [
  // Superpowers 14 个
  // marketplace 内置（36 个目录，子 skill 展开后 ~60 条）
  // external 153 个仓库（精选 ~80 条，去重后合并）
  // … 共 170+ 条
];

/** 按分类获取插件 */
export function getPluginsByCategory(): Record<string, ClaudePluginEntry[]>;
```

> 实际条目数和路径在实现时根据 `tar tzf` 解析结果精确填入。

#### 5.2.4 指令生成逻辑

```typescript
function getClaudeInstallCommand(filePath: string, selected: string[]): string {
  const header = `我刚上传了 ${filePath}，把里面的以下 skill 全部装到 Cowork。`;
  const steps = `
步骤：
1. ls /sessions/*/mnt/uploads/*.tar.gz 找到文件
2. 对以下每个 skill，执行 tar xzf <文件> -O <路径>/SKILL.md 读取内容
3. 每读到一个 SKILL.md：
   a. 去掉 YAML frontmatter（开头的 --- ... ---）
   b. 用 mcp__cowork__save_skill 保存，name 填目录名
   c. 点一次 Save`;

  const pluginList = formatPluginList(selected); // 根据数量和前缀自动合并/分行

  return (
    header + '\n' + steps + '\n\n要安装的 skill（共 ' + selected.length + ' 个）：\n' + pluginList
  );
}

function formatPluginList(selected: string[]): string {
  // 如果选了 superpowers 全系列 14 个 → 合并写成 "external_repos/... 下全部 14 个：…"
  // 如果只选了部分 superpowers → 逐个列出
  // 其他来源逐个列出路径
  // 按来源分组（A/B/C）
}
```

#### 5.2.4 文件名区分

| type     | 默认文件名                      | 去重检测     |
| -------- | ------------------------------- | ------------ |
| `codex`  | `codex-offline-pack.tar.gz`     | size > 30MB  |
| `claude` | `claude-offline-plugins.tar.gz` | size > 140MB |

#### 5.2.5 PluginSelector 组件

新组件 `src/components/PluginSelector.tsx`：

- Props: `plugins: PluginEntry[]`, `selected: Set<string>`, `onToggle: (name: string) => void`
- 顶部搜索框（实时过滤）
- 分类标签横向滚动筛选
- 列表项：checkbox + 名称 + 分类标签 + 推荐标记
- 底部：已选计数 + [全选] [取消] [恢复推荐] 按钮

---

## 6. UI/UX 设计细则

### 6.1 与 Codex tab 的差异化

| 维度     | Codex tab          | Claude tab             |
| -------- | ------------------ | ---------------------- |
| 图标     | codex logo         | claude logo            |
| 包名     | codex-offline-pack | claude-offline-plugins |
| 大小     | 36 MB              | 165 MB                 |
| 数量     | 173 个             | 170 个（20 推荐）      |
| 下载时长 | ~15s               | ~80s                   |
| 安装模式 | 单一全装           | 快速 + 自定义双模式    |
| 安装指令 | 1 句自然语言       | 结构化多步骤指令       |

### 6.2 下载提示优化

165MB 比 36MB 大很多，下载阶段增加：

- "文件较大（165 MB），预计 1-2 分钟，请耐心等待"
- 进度条 + 速度 + 剩余时间（已有）

### 6.3 Claude 安装指令引导

指令较长且包含技术细节，UI 增加引导文案：

> 📋 以下指令会自动找到安装包、读取 skill 文件、并逐个安装到 Cowork。
> **你只需粘贴到 Claude Desktop Cowork 的对话框中，回车即可。**
> 安装过程中 Cowork 会弹出每个 skill 的确认框，点击 Save 即可。
> 共 {n} 个 skill，预计需要点击 {n} 次 Save。

### 6.4 自定义安装的引导

> 💡 已为你预选了 20 个精选插件。你可以取消不需要的，或勾选更多感兴趣的。
> 点击「恢复推荐」可随时回到默认选择。

---

## 7. 下载统计与遥测

完全复用 v1.11.0 现有遥测事件，增加 `type`、安装模式和 `target` 字段：

```typescript
{ event: 'plugin_pack_info_fetch', type: 'claude', success: true }
{ event: 'plugin_pack_download', type: 'claude', success: true, duration_ms, cancelled }
{ event: 'plugin_install_command_copy', type: 'claude', mode: 'quick' | 'custom', target: 'cowork' | 'code', count: 20 }
```

`mode` 和 `count` 帮助我们了解用户倾向快速安装还是自定义选择。

---

## 8. IPC 通道变更

| 通道                          | 变更                                      |
| ----------------------------- | ----------------------------------------- |
| `plugins:get-pack-info`       | 增加可选参数 `type`，默认 `'codex'`       |
| `plugins:download`            | 增加可选参数 `type`，用于文件名和下载 URL |
| `plugins:get-install-command` | 增加可选参数 `type` + `selectedPlugins`   |
| **无需新增通道**              | 去重/进度/取消/Logo 全部复用              |

---

## 9. 错误处理

| 场景                 | 处理                                         |
| -------------------- | -------------------------------------------- |
| Server 无 claude 包  | "Claude 插件包暂未上线，请稍后再试"          |
| 下载 165MB 超时      | 5 分钟总超时 + 30s 静止超时（与 Codex 一致） |
| 磁盘空间不足         | `< 200MB` 时提示                             |
| 克隆失败的 19 个插件 | 不影响推荐体验，精选 20 个全在成功范围内     |

---

## 10. 版本规划

| 版本    | 内容                                                                   |
| ------- | ---------------------------------------------------------------------- |
| v1.12.0 | Claude tab 完整功能：下载 + 双模式安装 + 自定义选择 + Claude Code 支持 |
| 后续    | 增量更新、用户安装历史记录、一键重装                                   |

---

## 11. 与 v1.11.0 的代码复用度

本方案基于 v1.11.0 代码库（已完成邀请好友、自动更新等功能），在现有插件系统之上扩展 Claude 支持。

| 模块                                 | 复用比例 | 说明                                                                                    |
| ------------------------------------ | :------: | --------------------------------------------------------------------------------------- |
| `electron/plugins/index.ts`          |   80%    | type 参数 + target 参数（cowork/code）透传；getInstallCommand 增加 Claude Code 指令分支 |
| `electron/plugins/claude-plugins.ts` |    0%    | **全新**：硬编码 170+ 插件清单                                                          |
| `electron/plugins/types.ts`          |   85%    | 增加 ClaudePluginEntry + target 类型                                                    |
| `electron/ipc/channels.ts`           |   100%   | 不新增通道                                                                              |
| `electron/main.ts`                   |   95%    | IPC handler 透传 type + target                                                          |
| `src/pages/Plugins.tsx`              |   45%    | Claude tab 重写（Cowork 双模式 + Claude Code 按钮）                                     |
| `src/components/PluginSelector.tsx`  |    0%    | **全新组件**：自定义安装选择列表                                                        |
| `src/types/global.d.ts`              |   80%    | 类型扩展（target 参数）                                                                 |
| tests                                |   75%    | 增加 Claude 双模式 + Claude Code 目标测试                                               |

> 预估新增/修改代码量：~380 行（客户端）+ ~10 行（Server，仅 plugins.py type 参数）

---

> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
