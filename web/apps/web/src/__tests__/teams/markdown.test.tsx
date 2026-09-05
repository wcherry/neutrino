/**
 * The team page markdown renderer (issue #185, phases 2–3).
 *
 * The security-relevant assertions come first: a page body is written by another member of the
 * team and rendered to everyone else in it, so the renderer is an untrusted-input boundary.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { isSafeHref, markdownExcerpt, renderMarkdown } from '@/app/(apps)/teams/markdown';

function draw(source: string) {
  return render(<div data-testid="out">{renderMarkdown(source)}</div>);
}

describe('link safety', () => {
  it('allows the schemes a wiki page has a reason to use', () => {
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('http://example.com')).toBe(true);
    expect(isSafeHref('mailto:someone@example.com')).toBe(true);
    expect(isSafeHref('/teams/space?id=t1')).toBe(true);
    expect(isSafeHref('#heading')).toBe(true);
    expect(isSafeHref('notes/meeting.md')).toBe(true);
  });

  it('refuses script delivery, however it is spelled', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('JavaScript:alert(1)')).toBe(false);
    expect(isSafeHref('  javascript:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHref('vbscript:msgbox(1)')).toBe(false);
  });

  /** The label survives so the reader can see something was there; the target does not. */
  it('renders a refused link as plain text', () => {
    const { container } = draw('[click me](javascript:alert(1))');
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('click me')).toBeTruthy();
  });

  it('never produces raw HTML from the source', () => {
    const { container } = draw('<img src=x onerror="alert(1)"> and <script>alert(1)</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    // It is text, and it is shown as text.
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });
});

describe('blocks', () => {
  it('renders headings at their level', () => {
    const { container } = draw('# One\n\n### Three');
    expect(container.querySelector('h1')?.textContent).toBe('One');
    expect(container.querySelector('h3')?.textContent).toBe('Three');
  });

  it('renders bullet and numbered lists', () => {
    const { container } = draw('- a\n- b\n\n1. one\n2. two');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('renders a task list with its checked state', () => {
    const { container } = draw('- [x] done\n- [ ] not done');
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
    // Read-only: editing a task means editing the page, which is what records a version.
    expect(boxes[0].readOnly).toBe(true);
  });

  it('treats a fenced block as literal', () => {
    const { container } = draw('```rust\n# not a heading\n- not a list\n```');
    const code = container.querySelector('pre code');
    expect(code?.textContent).toBe('# not a heading\n- not a list');
    expect(container.querySelector('h1')).toBeNull();
  });

  it('renders a table when it has a divider row', () => {
    const { container } = draw('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(container.querySelectorAll('th')).toHaveLength(2);
    expect(container.querySelectorAll('tbody td')).toHaveLength(2);
  });

  /** Pipes in prose are prose. Without a divider row this is a paragraph. */
  it('does not turn a pipe in a sentence into a table', () => {
    const { container } = draw('Use grep | head to see the first lines.');
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('p')).toBeTruthy();
  });

  it('renders inline emphasis, code and links', () => {
    const { container } = draw('**bold** _italic_ `code` [link](https://example.com)');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('italic');
    expect(container.querySelector('code')?.textContent).toBe('code');
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.getAttribute('rel')).toContain('noopener');
  });

  it('renders images and blockquotes', () => {
    const { container } = draw('![alt](https://example.com/a.png)\n\n> quoted');
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('alt');
    expect(container.querySelector('blockquote')?.textContent).toContain('quoted');
  });

  it('renders a horizontal rule', () => {
    const { container } = draw('above\n\n---\n\nbelow');
    expect(container.querySelector('hr')).toBeTruthy();
  });

  it('renders nothing for an empty page', () => {
    const { container } = draw('');
    expect(container.querySelector('[data-testid="out"]')?.textContent).toBe('');
  });
});

describe('markdownExcerpt', () => {
  it('strips markup and collapses whitespace', () => {
    expect(markdownExcerpt('# Title\n\nSome **bold** text here.')).toBe('Some bold text here.');
  });

  it('truncates with an ellipsis', () => {
    expect(markdownExcerpt('a'.repeat(200), 20)).toHaveLength(20);
    expect(markdownExcerpt('a'.repeat(200), 20).endsWith('…')).toBe(true);
  });
});
