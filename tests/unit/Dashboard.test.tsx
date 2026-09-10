/**
 * Dashboard（工具接入状态页）测试。
 *
 * v3.0.0 重写：该页原先展示代理状态、端口、请求数、累计时长与 token，这些已随本地代理
 * 删除。现在它只回答一个问题——四个工具是否已安装、配置是否已写入。
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAppStore } from '../../src/lib/store';
import { Dashboard } from '../../src/pages/Dashboard';

const DETECT: DetectResult = {
  codexDesktop: { installed: true, configApplied: true },
  codexCli: { installed: true, configApplied: true },
  claudeCli: { installed: true, configApplied: true },
  claudeDesktop: { installed: false, configApplied: false },
};

beforeEach(() => {
  useAppStore.setState({ toasts: [] });
  (window as unknown as { codexSwitch: Record<string, unknown> }).codexSwitch = {
    claudeDetect: vi.fn().mockResolvedValue(DETECT),
    claudeApplyAll: vi.fn().mockResolvedValue(DETECT),
  };
});

describe('Dashboard page', () => {
  it('renders the four tool cards', async () => {
    render(<Dashboard />);
    expect(await screen.findByText('Codex Desktop')).toBeDefined();
    expect(screen.getByText('Codex CLI')).toBeDefined();
    expect(screen.getByText('Claude Code CLI')).toBeDefined();
    expect(screen.getByText('Claude Desktop')).toBeDefined();
  });

  it('shows configured vs not-installed state per tool', async () => {
    render(<Dashboard />);
    expect(await screen.findByText('Codex Desktop')).toBeDefined();
    // 前三个已配置，最后一个是未安装
    expect(screen.getAllByText('已配置')).toHaveLength(3);
    expect(screen.getByText('未安装')).toBeDefined();
  });

  it('no longer renders any proxy status, port or request stats', async () => {
    render(<Dashboard />);
    await screen.findByText('Codex Desktop');
    // v3.0.0 代理已删除，这些内容不该出现
    expect(screen.queryByText(/代理运行中/)).toBeNull();
    expect(screen.queryByText(/127\.0\.0\.1/)).toBeNull();
    expect(screen.queryByText(/累计请求/)).toBeNull();
    expect(screen.queryByText(/token/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /代理/ })).toBeNull();
  });

  it('offers a refresh action', async () => {
    render(<Dashboard />);
    expect(await screen.findByRole('button', { name: '刷新检测' })).toBeDefined();
  });
});
