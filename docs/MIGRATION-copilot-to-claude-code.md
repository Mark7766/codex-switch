# 从 GitHub Copilot 迁移到 Claude Code 开发方案

> **适用范围**：基于 ai-coding-ok 三层记忆系统的 TypeScript/Electron/React 项目（也适用于 Python/FastAPI 等项目）
>
> **参考案例**：[codex-switch-server](https://github.com/Mark7766/codex-switch-server)（已完整迁移并上线生产，[AGENTS.md](https://github.com/Mark7766/codex-switch-server/blob/main/AGENTS.md)、[CLAUDE.md](https://github.com/Mark7766/codex-switch-server/blob/main/CLAUDE.md)、[.claude/settings.local.json](https://github.com/Mark7766/codex-switch-server/blob/main/.claude/settings.local.json) 可作为对照参考）
>
> **目标读者**：已经从 GitHub Copilot 开发转向 Claude Code 开发、或同时使用两者的开发者。

---

## 一、为什么要从 Copilot 迁移到 Claude Code

| 维度              | GitHub Copilot                         | Claude Code                                       |
| ----------------- | -------------------------------------- | ------------------------------------------------- |
| **上下文窗口**    | ~20K tokens（Copilot Chat）            | 200K tokens（可容纳完整项目记忆 + 代码）          |
| **文件读写**      | 受限，仅建议式                         | 直接读写文件系统，批量修改                        |
| **Shell 执行**    | 不支持直接                             | 原生支持，可运行测试/构建/部署                    |
| **Skill 系统**    | 无                                     | 丰富技能生态（brainstorming、TDD、debugging 等）  |
| **Hook 机制**     | 无                                     | SessionStart/PreToolUse/PostToolUse/Stop 四层钩子 |
| **记忆系统**      | 依赖 `.github/copilot-instructions.md` | ai-coding-ok 三层记忆 + PDCA 完整闭环             |
| **自主执行能力**  | 低（需要频繁人工确认）                 | 高（Plan → Do → Check → Act 完整流程）            |
| **多 Agent 编排** | 不支持                                 | 内置 Workflow 引擎，支持并行/流水线               |

简而言之：**Copilot 是副驾驶，Claude Code 是自动驾驶**。对于正在使用 ai-coding-ok 的项目，Claude Code 能更好地执行 PDCA 闭环——自动读记忆 → 写代码 → 跑测试 → 更新记忆。

---

## 二、迁移概览：需要哪些文件

```
codex-switch/                        # 你的项目根目录
├── AGENTS.md                        # 架构速查（Copilot + Claude Code 共用，已存在）
├── CLAUDE.md                        # Claude Code 自动加载入口 ⬅ 关键：策略调整
├── .claude/
│   └── settings.local.json          # Hook 配置（PDCA 强制闭环）⬅ 新建/增强
├── .github/
│   ├── copilot-instructions.md      # Copilot 行为指令（保留，兼容双工具）
│   └── agent/
│       ├── system-prompt.md         # Agent 人格 + 业务上下文 ⬅ 需扩充
│       ├── coding-standards.md      # 编码规范（已有，无需改动）
│       ├── workflows.md             # 场景工作流 ⬅ 需扩充
│       ├── prompt-templates.md      # Prompt 模板（已有，无需改动）
│       └── memory/                  # 三层记忆（已有，无需改动）
│           ├── project-memory.md
│           ├── decisions-log.md
│           └── task-history.md
```

**核心原则**：不删除任何 Copilot 配置（`.github/copilot-instructions.md` 等），只在现有基础上**新增/增强** Claude Code 专用配置。双工具可并存，互不干扰。

---

## 三、Step-by-Step 迁移步骤

### Step 1：强化 CLAUDE.md——从"温和提醒"到"硬性指令"

**现状**（codex-switch 当前）：

```markdown
# CLAUDE.md

> Claude Code 自动加载本文件...
> @AGENTS.md
```

**问题**：仅 `@AGENTS.md` 是温和的"看看这个文件"，Claude Code 可能不会严格遵循 PDCA，特别是在没有匹配到 skill 触发词时。

**改为**（参考 codex-switch-server）：

```markdown
<!-- ai-coding-ok: v2.2.0 -->

# ⛔ STOP — CALL Skill("ai-coding-ok") BEFORE ANY CODE WORK. THEN CALL Skill("ai-coding-ok") AFTER ALL WORK. THIS IS NON-NEGOTIABLE.

@AGENTS.md
```

**效果**：Claude Code 在每个会话启动时加载 CLAUDE.md → 看到全大写 STOP 指令 → 必须调用 ai-coding-ok skill → 走完 Plan → 写代码 → 走完 Act。

**注意**：codex-switch-server 的 CLAUDE.md 第一行版本标记 `<!-- ai-coding-ok: v2.2.0 -->` 也宜加上，供 upgrade 流程自动检测版本。

---

### Step 2：扩展 AGENTS.md Plan 阶段——读更多 Agent 文档

**现状**（codex-switch 当前 Plan 阶段只读 3 个文件）：

```markdown
### Plan 阶段（强制，任务开始前）

1. 读取 `.github/agent/memory/project-memory.md`
2. 读取 `.github/agent/memory/decisions-log.md`
3. 读取 `.github/agent/memory/task-history.md`
```

**问题**：system-prompt.md（Agent 人格）、workflows.md（场景工作流）、coding-standards.md（编码规范）没有被 Plan 阶段引用，Agent 不会主动读它们。如果这些文件内容过时，也无人发现。

**改为**（参考 codex-switch-server）：

```markdown
### Plan 阶段（强制，任务开始前）

1. 读取 `AGENTS.md` — 本文件，架构速查
2. 读取 `.github/agent/system-prompt.md` — Agent 人格、角色切换、行为边界
3. 读取 `.github/agent/workflows.md` — 场景工作流（Feature/Bug/Refactor/部署）
4. 读取 `.github/agent/coding-standards.md` — 编码规范
5. 读取 `.github/agent/memory/project-memory.md` — 项目事实和架构约束
6. 读取 `.github/agent/memory/decisions-log.md` — 历史技术决策
7. 读取 `.github/agent/memory/task-history.md` — 近期任务上下文

### Act 阶段（强制，任务结束后）

1. 更新 `.github/agent/memory/task-history.md` — 记录本次任务摘要
2. 如有架构决策变化 → 更新 `.github/agent/memory/decisions-log.md`
3. 如有项目事实变化 → 更新 `.github/agent/memory/project-memory.md`
4. 如 AGENTS.md / system-prompt.md / workflows.md / coding-standards.md 有事实性过时内容 → 同步更新对应文件
```

**要点**：新增第 4 条 Act 规则——Agent 文档自身也可能过时。codex-switch-server 的 TASK-024 就是因为 agent 文档（system-prompt.md 等）描述的还是旧架构，才被发现并修复的。

---

### Step 3：配置 Hook——从"口头提醒"到"强制阻断"

这是迁移中最关键的一步。Copilot 没有 hook 机制，只能靠 `.github/copilot-instructions.md` 中的文字指令。Claude Code 的 hook 机制可以做**真正阻断**。

**Step 3a：了解 Claude Code Hook 类型**

| Hook 事件          | 触发时机         | 用于                                  |
| ------------------ | ---------------- | ------------------------------------- |
| `SessionStart`     | 会话开始         | PDCA 提醒                             |
| `UserPromptSubmit` | 用户每次发消息   | PDCA 提醒                             |
| `PreToolUse`       | 调用工具前       | 阻断危险操作（如 git push、SSH 部署） |
| `Stop`             | Agent 回复结束前 | 阻断未更新记忆的回复                  |

**Step 3b：关键概念 `asyncRewake: true` + `exit 2`**

普通 hook 只是 `echo` 一段文字，Agent 可能忽略。`asyncRewake: true` 告诉运行时：这个 hook 的输出要以 `system-reminder` 形式**注入当前上下文窗口**，Agent 必须读它。加上 `exit 2`（阻塞错误），Agent 在满足条件前无法结束回复。

```json
{
  "type": "command",
  "command": "...",
  "asyncRewake": true // 输出注入为 system-reminder
}
// 通常配合 exit 2 实现强制阻断
// command 末尾的 "&& exit 2" 会在条件满足时触发
```

**Step 3c：创建 `.claude/settings.local.json`**

以下配置参考了 codex-switch-server 的实际生产配置。**直接复制到项目**，无需修改（如果项目名/路径不同，调整匹配器）：

```json
{
  "permissions": {
    "allow": [
      // ========== 安全操作：允许 ==========
      "Bash(git *)",
      "Bash(pnpm *)",
      "Bash(node *)",
      "Bash(curl *)",
      "Read(//Users/mark/work/gitspace/opensource/codex-switch/**)",
      "Read(//Users/mark/work/gitspace/opensource/codex-switch-server/**)"
    ]
  },
  "hooks": {
    // ── 钩子 1：会话开始时提醒 PDCA ──
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo '>>> PDCA GATE: Invoke Skill(ai-coding-ok) Plan BEFORE code. Update memory AFTER. <<<'"
          }
        ]
      }
    ],

    // ── 钩子 2：每次用户发消息时提醒 ──
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo '>>> PDCA: Is this coding? Invoke Skill(ai-coding-ok) BEFORE + AFTER. <<<'"
          }
        ]
      }
    ],

    // ── 钩子 3：编辑/写文件前提醒 ──
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "echo '>>> PDCA PLAN: Are you about to edit code? Invoke Skill(ai-coding-ok) Plan phase FIRST. <<<'"
          }
        ]
      },
      // ── 阻断器：禁止未经授权的 git push ──
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo '>>> PUSH BLOCKER: git push detected. User said: NO push to remote without EXPLICIT permission. If user did not say \"push\" or \"commit and push\" in this turn, STOP. <<<' && exit 2",
            "if": "Bash(git push*)",
            "asyncRewake": true
          },
          // ── 阻断器：禁止未经授权的 SSH 部署 ──
          {
            "type": "command",
            "command": "echo '>>> DEPLOY BLOCKER: SSH to production detected. Did USER explicitly ask to deploy? If not, STOP. <<<' && exit 2",
            "if": "Bash(*ssh*production*)",
            "asyncRewake": true
          }
        ]
      }
    ],

    // ── 钩子 4：回复结束前——强制 PDCA Act ──
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "CHANGED=$(git diff --name-only 2>/dev/null | grep -c '^src/\\|^electron/\\|^tests/'); if [ \"$CHANGED\" -gt 0 ]; then echo '>>> PDCA ACT BLOCK: You have '${CHANGED}' source files changed. MANDATORY: (1) task-history.md (2) decisions-log.md? (3) project-memory.md? <<<' && exit 2; else echo '>>> PDCA ACT: No source changes, skip. <<<'; fi",
            "asyncRewake": true
          }
        ]
      }
    ]
  }
}
```

**这个 Stop hook 的核心逻辑**：

1. `git diff --name-only` 检查是否有源代码文件被修改
2. 如果有改动 → `exit 2` **弹回** Agent 的回复，注入 PDCA ACT 提醒
3. Agent 看到提醒 → 更新记忆文件 → 再次结束
4. Stop hook 再次触发 → 这次没有新改动 → 正常通过

**与 codex-switch-server 配置的差异**：

- codex-switch-server 的阻断更严格（还加了 `docker compose up` 阻断器），因为它已在生产环境运行
- codex-switch 目前是桌面应用，没有远程服务器，所以不需要 SSH/Docker 阻断器
- **后续如果 codex-switch 引入发布流水线自动触发等自动化操作，应同步增加对应的 PreToolUse 阻断器**

---

### Step 4：扩充 system-prompt.md——给 Agent 更完整的业务上下文

codex-switch-server 的 system-prompt.md 比 codex-switch 多了以下关键内容，建议同步补充：

1. **身份**：明确"你是 codex-switch 项目的专属 AI 开发 Agent"
2. **核心价值观**：极简实用、质量不妥协、透明可追溯、持续学习
3. **业务上下文**：
   - 核心业务流程（从用户视角描述 6-8 步）
   - 关键业务概念（用简短定义解释领域术语，如"协议转换""配置注入""自动更新镜像"等）
4. **角色切换指南**：产品经理模式 / 架构师模式 / 工程师模式 / 测试工程师模式
5. **行为边界（安全策略）**：
   - 🟢 允许自主决定（命名优化、类型注解、补充测试）
   - 🟡 需要确认后执行（新增依赖、修改核心业务逻辑、修改 DB schema）
   - 🔴 禁止自主执行（删除数据、修改线上配置、发布版本）
6. **沟通风格**：中文沟通、英文代码/commit、不确定时坦诚说明

> **具体内容**参见 codex-switch-server 的 `.github/agent/system-prompt.md`（约 143 行），按本项目实际情况替换业务概念和流程部分。

---

### Step 5：扩充 workflows.md——预设场景工作流

codex-switch-server 的 workflows.md 预设了 5 种场景的标准操作流程：

| 场景     | 关键步骤                                                            |
| -------- | ------------------------------------------------------------------- |
| 新功能   | 理解需求 → 设计方案 → 实现（Model→Service→API→UI）→ 测试 → Act 收尾 |
| 修 Bug   | 复现（先写失败测试）→ 定位根因 → 修复 → 验证 → Act 收尾             |
| 重构     | 明确目标 → 小步改（每步跑测试）→ 验证行为等价 → Act 收尾            |
| 产品分析 | 切产品经理模式 → 输出用户故事+验收标准 → 确认                       |
| 部署     | 确认依赖完整 → 检查清单 → 部署验证                                  |

**对于 codex-switch**，场景 1 的具体实现步骤应改为：`Model/Service 层 → 代理逻辑 → IPC 通道 → preload 暴露 → React UI 组件`，遵循 Electron 主进程/渲染进程分层。

---

### Step 6：保留 copilot-instructions.md——兼容双工具

**不要删除** `.github/copilot-instructions.md`。原因：

1. 部分团队成员可能仍使用 Copilot
2. 同一个人可能在不同场景切换工具（Copilot 适合小修改，Claude Code 适合大任务）
3. Copilot Chat 会自动加载该文件中的全局行为指令

codex-switch-server 的方案是：两者共存，copilot-instructions.md 中保留 PDCA 要求（Plan 读记忆 → Act 更新记忆），只是 Copilot 缺少 hook 机制来强制阻断。

---

## 四、关键差异总结：codex-switch vs codex-switch-server

codex-switch-server 在迁移到 Claude Code 过程中做了以下关键调整，这些是 codex-switch 可以直接借鉴的：

| 文件                                | codex-switch 当前   | codex-switch-server 方案            | 迁移建议                           |
| ----------------------------------- | ------------------- | ----------------------------------- | ---------------------------------- |
| **CLAUDE.md**                       | 温和版 `@AGENTS.md` | 全大写 STOP + 直接命令              | ✅ **必改**——这是 hook 入口        |
| **AGENTS.md Plan 阶段**             | 读 3 个文件和记忆   | 读 7 个文件（含 agent 文档）        | ✅ **必改**——防止 agent 文档过时   |
| **AGENTS.md Act 阶段**              | 更新 3 个文件和记忆 | 新增第 4 条：同步更新 agent 文档    | ✅ **必改**                        |
| **.claude/settings.local.json**     | 仅少量 permissions  | 完整 4 层 hook + 阻断器             | ✅ **必改**——这是迁移核心          |
| **system-prompt.md**                | 基础版              | 含人格/业务上下文/角色切换/行为边界 | 🟡 **建议改**——提升 Agent 决策质量 |
| **workflows.md**                    | 基础版              | 5 种预设场景 + 每步具体行动         | 🟡 **建议改**——提升执行一致性      |
| **.github/copilot-instructions.md** | 有                  | 有且保留（兼容双工具）              | 🟢 **不动**——双工具共存            |

---

## 五、验证清单

迁移完成后，逐项验证：

- [ ] `CLAUDE.md` 是否以全大写 STOP 指令开头
- [ ] `.claude/settings.local.json` 是否存在且包含 4 层 hook
- [ ] 启动 Claude Code 新会话，是否看到 `>>> PDCA GATE:` 的 SessionStart 提醒
- [ ] 写一段代码后准备结束回复，Stop hook 是否**弹回**并强制要求更新记忆
- [ ] 更新 task-history.md 后再次结束，Stop hook 是否通过
- [ ] PreToolUse 的 git push 阻断器是否生效（尝试不带明确授权的 push）
- [ ] AGENTS.md Plan 阶段是否列出了 7 个文件（不是 3 个）
- [ ] `.github/copilot-instructions.md` 是否仍然存在（没有被误删）

---

## 六、常见问题

### Q1: Hook 阻断太频繁，影响效率怎么办？

Stop hook 只在有源代码改动时才阻断。纯问答、代码阅读、设计方案等不产生文件改动的回复不会触发。如果确实频繁触发，检查是否将生成文件（如 `pnpm-lock.yaml`）排除在 git diff 检查之外——hook 命令中 grep 的路径前缀 `^src/\\|^electron/\\|^tests/` 已经限制了范围。

### Q2: 团队成员还在用 Copilot，会冲突吗？

不会。Copilot 读 `.github/copilot-instructions.md`，Claude Code 读 `CLAUDE.md` + `.claude/settings.local.json`。两个工具各读各的，互不干扰。记忆文件（`project-memory.md` 等）是双方共享的——这正是 ai-coding-ok 的设计初衷。

### Q3: asyncRewake 和 exit 2 的区别是什么？

- `asyncRewake: true`：hook 的输出作为 `system-reminder` 注入上下文，Agent 必须读它
- `exit 2`：告诉运行时"这个 hook 失败了"，运行时把输出注为 blocking error
- 两者配合 = **Agent 必须读这个提醒，读完之后才能继续**

只用 `echo` 没有 `exit 2` = 一条普通 stdout，Agent 可能忽略。
只加 `exit 2` 没有 `asyncRewake` = 报错但 Agent 看不到输出内容，不知道为什么被阻断。

### Q4: 如果项目没有远程服务器，还需要 PreToolUse 阻断器吗？

codex-switch 作为桌面应用，不需要 SSH/Docker 阻断器。但 **git push 阻断器** 仍然必要——防止 Agent 在未明确授权时推送代码。后续如果有 CI 发布流水线，可在 PreToolUse 中增加对应的阻断规则。

### Q5: codex-switch-server 的 Stop hook 还会检查 docker compose，codex-switch 需要吗？

不需要。codex-switch 是 Electron 桌面应用，不是 Web 服务。那条阻断器是针对 codex-switch-server 这个已上线 Web 服务的。如果你的项目有类似的生产环境操作（如 `electron-builder --publish`），建议添加对应的阻断器。

---

## 七、参考资源

- [ai-coding-ok 框架](https://github.com/Mark7766/ai-coding-ok) — 三层记忆系统原始仓库
- [codex-switch-server AGENTS.md](https://github.com/Mark7766/codex-switch-server/blob/main/AGENTS.md) — 7 文件 Plan 阶段范本
- [codex-switch-server CLAUDE.md](https://github.com/Mark7766/codex-switch-server/blob/main/CLAUDE.md) — 激进版 Claude Code 入口
- [codex-switch-server .claude/settings.local.json](https://github.com/Mark7766/codex-switch-server/blob/main/.claude/settings.local.json) — Hook 强制阻断配置范本
- [Claude Code Hooks 文档](https://docs.anthropic.com/en/docs/claude-code/hooks) — 官方 hook 参考
- 本项目的 AGENTS.md — 项目架构速查
- 本项目的 `.github/agent/memory/decisions-log.md` — 历史技术决策

---

> 📅 文档版本：v1.0（2026-06-08）
>
> ✍️ 编写依据：对照 codex-switch 与 codex-switch-server 的实际文件差异，提取可迁移的配置模式。
