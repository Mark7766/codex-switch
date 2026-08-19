import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMarkdown } from '../../src/components/ChangelogModal';

function html(md: string): string {
  return renderToStaticMarkup(<>{renderMarkdown(md)}</>);
}

describe('renderMarkdown — blockquote support', () => {
  it('renders `> ` lines as a blockquote without the literal marker', () => {
    const md = `# 更新记录\n\n> 这是引述段落，不应出现字面 \`>\` 符号。\n\n- 列表项 A\n- 列表项 B`;
    const out = html(md);
    expect(out).toContain('<blockquote');
    expect(out).toContain('这是引述段落');
    // 不出现裸 `>` 被当作文本渲染
    expect(out).not.toMatch(/<p[^>]*>>/);
  });

  it('merges consecutive `> ` lines into one blockquote', () => {
    const md = `> 第一行\n> 第二行`;
    const out = html(md);
    expect(out).toContain('<blockquote');
    expect(out).toContain('第一行');
    expect(out).toContain('第二行');
    expect((out.match(/<blockquote/g) ?? []).length).toBe(1);
  });

  it('keeps headings and lists rendering normally', () => {
    const md = `## [2.0.0] - 2026-08-19\n\n### 重磅变更\n\n- 条目一\n- 条目二`;
    const out = html(md);
    expect(out).toContain('<h2');
    expect(out).toContain('重磅变更');
    expect(out).toContain('<ul');
    expect(out).toContain('条目一');
  });
});
