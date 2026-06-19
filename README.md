# <img src="https://codex-switch.cloud/static/images/logo.png" width="28" height="28"> Codex Switch

**让 AI 编程触手可及。**

Codex Switch 帮你突破网络限制，在国内流畅使用 Codex 和 Claude，接入 DeepSeek 和 Agnes AI——免费、快速、本地安全。

[![Release](https://img.shields.io/github/v/release/Mark7766/codex-switch?color=blue)](https://github.com/Mark7766/codex-switch/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)](https://codex-switch.cloud/download)

---

## 快速安装

去官网 [codex-switch.cloud](https://codex-switch.cloud) 下载安装包，或者直接走安装指南：

<p align="center">
  <a href="https://codex-switch.cloud/guide?platform=windows"><strong>🪟 Windows 安装指南 →</strong></a>
  &nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://codex-switch.cloud/guide?platform=macos"><strong>🍎 Mac 安装指南 →</strong></a>
</p>

支持 **Windows 11** · **macOS 11+** · 完全免费开源。

---

## 三分钟上手

**1. 安装 Codex Switch** — 去 [下载页面](https://codex-switch.cloud/download) 获取 macOS 或 Windows 安装包，双击安装

**2. 填写 API Key** — 首次启动弹出 Setup 向导，填入 DeepSeek API Key（[免费申请](https://platform.deepseek.com/api_keys)）或 Agnes AI Key（[免费申请](https://platform.agnes-ai.com/)）

**3. 点「完成并启动代理」** — 自动配置 ~/.codex/，打开 Codex Desktop 或 Codex CLI 直接对话

> 安装遇到问题？去官网 [使用指南](https://codex-switch.cloud/guide) 看图文步骤。

---

## 四款工具全部支持

| 工具            | 安装指南                                                        |
| --------------- | --------------------------------------------------------------- |
| Codex Desktop   | [📖 配置指南](https://codex-switch.cloud/guide?tool=codex)      |
| Claude Desktop  | [📖 配置指南](https://codex-switch.cloud/guide?tool=claude)     |
| Codex CLI       | [📖 配置指南](https://codex-switch.cloud/guide?tool=codex-cli)  |
| Claude Code CLI | [📖 配置指南](https://codex-switch.cloud/guide?tool=claude-cli) |

每款工具都能自由选择 **DeepSeek** 或 **Agnes AI** 作为 AI 供应商，各自独立配置、互不干扰。

---

## 功能亮点

- **零命令行**：图形界面完成所有配置，不懂终端也能用
- **免费模型**：支持 Agnes AI，零成本使用，256K 上下文
- **一键切换供应商**：DeepSeek 和 Agnes 之间秒切，不重启、不等生效
- **协议自动翻译**：Codex 的 OpenAI Responses API、Claude 的 Anthropic Messages API，自动翻译为上游能理解的格式
- **Key 安全存储**：API Key 存在操作系统钥匙串，不落盘明文
- **本地代理**：仅监听 127.0.0.1:11435，外网无法访问
- **对话持续**：长对话不丢上下文，切供应商不影响进行中的对话
- **日志脱敏**：请求日志自动隐藏 Key 和敏感信息，方便排查问题

---

## 开发

```bash
pnpm install
pnpm dev          # 开发模式（Vite + Electron 热重载）
pnpm test         # 运行测试
pnpm package:mac  # 构建 macOS 安装包
```

需要 Node.js 20 LTS + pnpm 9.x。

---

## 问题反馈

应用内右上角搜索按钮输入问题，AI 秒回答案。也可以提 [GitHub Issue](https://github.com/Mark7766/codex-switch/issues)。

---

## License

MIT
