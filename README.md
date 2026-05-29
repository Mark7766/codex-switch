# Codex Switch

> 跨平台桌面图形化代理：让 Codex CLI / Codex Desktop 无痛连接 DeepSeek。

零命令行、双击安装。在本地 `127.0.0.1:11435` 起一个 HTTP + WebSocket 代理，把 Codex 用的 OpenAI Responses API 实时转换为 DeepSeek Chat Completions（支持 SSE 流式 + `deepseek-reasoner` 的 `reasoning_content` 跨轮回传），并自动写好 `~/.codex/config.toml` 与 `~/.codex/auth.json`。

参考实现：[`codex-deepseek-installer`](https://github.com/Mark7766/codex-deepseek-installer)（CLI 版本，本项目是其 GUI 化）。

---

## 下载（v0.1.0）

| 平台 | 架构 | 下载文件 |
|------|------|---------|
| macOS Apple Silicon (M1/M2/M3/M4) | arm64 | `Codex-Switch-0.1.0-mac-arm64.dmg` |
| macOS Intel | x64 | `Codex-Switch-0.1.0-mac-x64.dmg` |
| Windows x86_64 | x64 | `Codex-Switch-Setup-0.1.0-win-x64.exe` |
| Windows ARM | arm64 | `Codex-Switch-Setup-0.1.0-win-arm64.exe` |

**怎么知道我该下哪个？**
- **Mac**：左上角  → 关于本机 → 看「芯片」是 Apple 还是 Intel。
- **Windows**：设置 → 系统 → 系统信息 → 看「系统类型」。

---

## 开发

需要 **Node.js 20 LTS**（**不要用 Node 23**，原因见下方 troubleshooting）+ **pnpm 9.x**。

```bash
pnpm install                 # 安装依赖
pnpm dev                     # 开发模式（Vite + Electron 热重载）

pnpm typecheck               # tsc --noEmit
pnpm test                    # Vitest 单元测试
pnpm test:coverage           # 覆盖率报告
pnpm lint                    # ESLint
pnpm format                  # Prettier

pnpm build                   # 编译主进程 + 渲染层
pnpm package:mac             # 打 macOS .dmg（x64 + arm64）
pnpm package:win             # 打 Windows NSIS .exe（需在 Windows 上运行）
```

---

## Troubleshooting

### `pnpm install` 在链接阶段挂起（0% CPU、无子进程）

**症状**：`Packages: +N` 出现 `added N` 后日志再无输出，`ps` 显示 pnpm 主进程 0% CPU、无任何子进程，等多久都不结束。

**根因**：pnpm 9.4.0 在 **Node.js 23.x（非 LTS）** 上偶发死锁。pnpm 的链接阶段大量使用 `worker_threads` 做并行 hardlink；Node 23 的 V8 12.4+ 与 libuv 1.50 在某些场景下与 pnpm 9.4 的线程池调度发生竞态，导致主线程进入事件循环 idle、所有 worker 都退出但 Promise 不 resolve。
相关上游：
- https://github.com/pnpm/pnpm/issues/8538
- https://github.com/nodejs/node/issues/55518

**解决方案（按优先级）**：

1. **首选：使用 Node 20 LTS**（项目 CI 已锁 Node 20）：
   ```bash
   nvm install 20 && nvm use 20
   rm -rf node_modules pnpm-lock.yaml
   pnpm install
   ```

2. **次选：分两步安装**（在 Node 23 上的本地 workaround）：
   ```bash
   pnpm install --ignore-scripts
   pnpm rebuild keytar
   pnpm rebuild electron
   ```
   这样跳过统一的 postinstall 阶段，把原生依赖的 prebuild 拉取拆成独立步骤，避免触发上述竞态。

3. 升级 pnpm 到 ≥ 9.7（待验证）或回退到 9.0。

### 启动报 `Cannot find module 'conf'`（或其它传递依赖找不到）

pnpm 默认用 **isolated** linker（`node_modules/.pnpm/<pkg>/node_modules/...`），electron-builder 24 把项目 `node_modules` 打进 `app.asar` 时无法跨 `.pnpm/` 子目录解析传递依赖，运行时就会报 `Cannot find module 'conf'`（`conf` 是 `electron-store` 的传递依赖）。

**解决**：在仓库根目录的 `.npmrc` 中加入：

```
node-linker=hoisted
```

然后删除 `node_modules` + `pnpm-lock.yaml` 重装并重打包：

```bash
rm -rf node_modules pnpm-lock.yaml release
pnpm install
pnpm package:mac    # 或 package:win
```

可用 `asar list` 验证传递依赖已进入 asar：

```bash
npx asar list "release/mac-arm64/Codex Switch.app/Contents/Resources/app.asar" \
  | grep -E '/(conf|electron-store|keytar)/package\.json$'
```

### `electron-builder` 报 `cannot find prebuild-install`

`keytar` 的 `install` 脚本调用 `prebuild-install`，但在 electron-builder 的 native rebuild 阶段，PATH 中找不到。这是**良性警告**：electron-builder 会自动 fallback 到 source build，最终 `.app/Contents/Resources/app.asar` 内仍会含 `keytar/build/Release/keytar.node`。可用以下命令验证：

```bash
node node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/bin/asar.js \
  list "release/mac-arm64/Codex Switch.app/Contents/Resources/app.asar" | grep keytar
```

### macOS 打开提示「无法验证开发者」

v0.1.0 未做代码签名 + 公证。临时绕过：右键 → 打开 → 在弹窗里再点「打开」。正式 release 会接入 Developer ID 签名。

### Windows 提示 SmartScreen 警告

同上，v0.1.0 未做 Authenticode 签名。点「更多信息」→「仍要运行」即可。

---

## License

MIT
