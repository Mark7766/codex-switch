# Codex Switch 代码统计 — v1.14.0

> 统计日期：2026-06-20

## 总览

| 类别                    | 行数       | 文件数 |
| ----------------------- | ---------- | ------ |
| 主进程 (electron/)      | 9,328      | —      |
| 渲染进程 (src/)         | 4,406      | —      |
| 测试 (tests/)           | 3,435      | —      |
| **核心代码合计**        | **17,169** | —      |
| TypeScript (.ts)        | 13,008     | 62     |
| TypeScript React (.tsx) | 4,203      | 23     |
| CSS                     | 240        | 3      |
| Markdown                | 15,273     | 46     |
| YAML                    | 8,226      | 14     |

## 主进程模块明细 (electron/)

| 模块           | 行数  | 说明                                      |
| -------------- | ----- | ----------------------------------------- |
| proxy/         | 3,344 | HTTP + WebSocket 代理、协议转换、流式转发 |
| claude/        | 1,085 | Claude Desktop / CLI 配置写入与检测       |
| plugins/       | 1,069 | 离线插件包下载与安装引导                  |
| codex/         | 588   | ~/.codex 配置读写、备份、还原             |
| config/        | 538   | 用户偏好持久化 (electron-store)、密钥管理 |
| server-client/ | 551   | Server 集成、遥测上报                     |
| updater/       | 377   | 自动更新 (electron-updater + macOS DMG)   |
| ipc/           | 118   | IPC 通道定义                              |
| main.ts        | 1,442 | 应用入口                                  |
| preload.ts     | 216   | 渲染进程安全桥                            |

## 渲染进程模块明细 (src/)

| 模块        | 行数  | 说明                                                 |
| ----------- | ----- | ---------------------------------------------------- |
| pages/      | 2,349 | Setup / Dashboard / Settings / Logs / Help / Plugins |
| components/ | 1,377 | UI 组件 (HeaderBar, Modal, Search 等)                |
| types/      | 287   | 全局类型定义                                         |
| lib/        | 87    | Zustand store                                        |
| styles/     | 15    | Tailwind 入口                                        |

## Top 20 文件（按行数降序）

| 行数  | 文件                                |
| ----- | ----------------------------------- |
| 1,442 | electron/main.ts                    |
| 726   | src/pages/Settings.tsx              |
| 668   | electron/proxy/server.ts            |
| 553   | src/pages/Plugins.tsx               |
| 517   | electron/plugins/claude-plugins.ts  |
| 504   | electron/plugins/index.ts           |
| 446   | electron/proxy/ws-handler.ts        |
| 409   | electron/proxy/http-handler.ts      |
| 390   | electron/claude/env-writer.ts       |
| 371   | tests/unit/plugins.test.ts          |
| 363   | src/pages/Logs.tsx                  |
| 347   | tests/unit/anthropic-relay.test.ts  |
| 332   | electron/proxy/stream.ts            |
| 329   | electron/codex/writer.ts            |
| 327   | electron/proxy/translate.ts         |
| 300   | electron/server-client/telemetry.ts |
| 291   | src/pages/Help.tsx                  |
| 287   | src/types/global.d.ts               |
| 281   | src/pages/Dashboard.tsx             |
| 281   | src/App.tsx                         |

## 代码比例

```
主进程 (electron/)  ████████████████████████████████████  54.4%
渲染进程 (src/)      ██████████████████                   25.7%
测试 (tests/)        ██████████████                       20.0%
```
