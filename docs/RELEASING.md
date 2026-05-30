# 发布流程

本文档面向项目维护者：发新版需要做什么、注意什么。

## 1. 准备

- [ ] `package.json` 版本号已更新（如 `1.0.0`）
- [ ] `CHANGELOG.md` 已新增对应 `[1.0.0] - YYYY-MM-DD` 段落
- [ ] 本地 `pnpm typecheck && pnpm test` 全部通过
- [ ] 本地 `pnpm package:mac` / `pnpm package:win` 至少在一种平台成功
- [ ] 已经 push 到 `main` 并 PR 合并

## 2. 打标签（CI 自动出包）

```bash
git checkout main
git pull origin main
git tag v1.0.0
git push origin v1.0.0
```

CI 工作流 `.github/workflows/release.yml` 会：

1. 校验 `package.json` 版本与 tag 一致
2. 在 macOS 和 Windows 上分别 typecheck + test + 构建
3. 通过 `electron-builder --publish always` 把 `.dmg` (mac x64/arm64) 与 `.exe` (win x64/arm64) 上传到对应的 GitHub Release 草稿
4. `latest-mac.yml` / `latest.yml` 会被同步上传，`electron-updater` 据此识别新版

## 3. 编辑 Release Notes

CI 跑完后，进入 [Releases](https://github.com/Mark7766/codex-switch/releases) 页面：

- 找到刚生成的 `v1.0.0` Release（草稿状态）
- 把 `CHANGELOG.md` 中的 `[1.0.0]` 段落复制进 Release 描述
- 确认资产齐全（4 个安装包 + `latest-mac.yml` + `latest.yml`）
- 点击 **Publish release**

## 4. 验证自动更新

- 在已经安装 `1.0.0-rc` 的机器上启动 Codex Switch
- 启动 5 秒内右上角应出现「↑ 新版本 v1.0.0」徽标
- 点下载，进度条走完后点「立即安装」会自动重启到新版

## 5. 离线/手工出包（无 CI 时）

```bash
# macOS（双架构）
pnpm package:mac

# Windows（双架构，需先解锁 app-builder.exe，脚本已内置）
pnpm package:win
```

包产物在 `release/` 目录下。

## 6. 紧急回滚

- 在 GitHub Release 中把出问题的版本设置为 **Pre-release**（不再被 electron-updater 视为最新）
- 重新打 patch 版本（如 `1.0.1`）走流程 2

## 7. 本地降版

电脑上有多个版本想测试时：

- macOS：删除 `~/Library/Application Support/codex-switch/` 后用旧版重新装
- Windows：通过控制面板卸载，再装旧 `.exe`
