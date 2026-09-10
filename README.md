# <img src="https://codex-switch.cloud/static/images/logo.png" width="28" height="28"> Codex Switch

**让 AI 编程触手可及。**

Codex Switch 帮你把 Codex 和 Claude 接到国内模型服务上（DeepSeek、智谱 GLM 等）——点几下按钮写好配置，之后各工具**直连供应商**，不经过任何中间转发。

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

**2. 填写 API Key** — 首次启动弹出 Setup 向导，填入 DeepSeek API Key（[免费申请](https://platform.deepseek.com/api_keys)）。想用智谱 GLM？在「设置 → 供应商设置」里切换并填入对应 Key

**3. 点「完成并应用配置」** — 自动写好 `~/.codex/`，打开 Codex Desktop 或 Codex CLI 直接对话

> 安装遇到问题？去官网 [使用指南](https://codex-switch.cloud/guide) 看图文步骤。

---

## 四款工具全部支持

| 工具            | 安装指南                                                        |
| --------------- | --------------------------------------------------------------- |
| Codex Desktop   | [📖 配置指南](https://codex-switch.cloud/guide?tool=codex)      |
| Claude Desktop  | [📖 配置指南](https://codex-switch.cloud/guide?tool=claude)     |
| Codex CLI       | [📖 配置指南](https://codex-switch.cloud/guide?tool=codex-cli)  |
| Claude Code CLI | [📖 配置指南](https://codex-switch.cloud/guide?tool=claude-cli) |

每款工具都能自由选择 **DeepSeek** 或 **智谱 GLM**（以及任意 OpenAI Responses / Anthropic 兼容的**自定义**服务）作为供应商，各自独立配置、互不干扰。

---

## 功能亮点

- **零命令行**：图形界面完成所有配置，不懂终端也能用
- **纯配置工具，不做转发**：不占端口、不需要保持运行；配置写好后各工具直连供应商，少一层转发
- **一键切换供应商**：DeepSeek / 智谱 GLM / 自定义之间随时切换，配置自动重写
- **模型目录自动写**：按官方文档写好 Codex 的 `~/.codex/models.json`，模型元数据正确
- **Key 安全存储**：API Key 存在操作系统钥匙串，不落盘明文
- **改动先备份**：所有配置文件写入前自动备份，支持一键还原、一键切回 OpenAI 官方
- **工具接入状态**：一眼看到四个工具是否已安装、配置是否已写入

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

应用内右上角「?」按钮打开帮助抽屉，里面有上手指南、常见问题和诊断信息（可一键生成诊断报告）。也可以直接提 [GitHub Issue](https://github.com/Mark7766/codex-switch/issues)。

---

## License

MIT
