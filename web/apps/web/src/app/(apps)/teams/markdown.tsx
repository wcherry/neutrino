/**
 * The markdown a team page is rendered with.
 *
 * Written here rather than pulled in as a dependency, for two reasons. The app builds with
 * `output: 'export'`, so everything ships to the browser and a general-purpose parser is a large
 * thing to add for one surface. And a wiki page needs a *known* subset — the design doc names it
 * exactly: headings, images, embedded files, links, code blocks, tables and task lists — so a
 * parser that also does footnotes and directives is answering a question nobody asked.
 *
 * It emits React elements, never HTML. `dangerouslySetInnerHTML` over a page anyone in the team can
 * edit is a stored-XSS hole aimed at everyone else in the team, and no amount of sanitising is as
 * reliable as never producing a string of markup in the first place. That is also why a link's
 * href is filtered: `javascript:` and `data:` are script delivery, and a page body is untrusted
 * input written by another person.
 */

import React from 'react';

// ── Inline ───────────────────────────────────────────────────────────────────

/**
 * Whether a link target is safe to put in an `href`.
 *
 * Allowing only the schemes a wiki page has a reason to use, rather than blocking the dangerous
 * ones — a blocklist has to anticipate every scheme a browser will ever execute, including the
 * ones spelled with control characters or unusual case.
 */
export function isSafeHref(href: string): boolean {
  const trimmed = href.trim().toLowerCase();
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return true;
  if (/^[a-z][a-z0-9+.-]*:/.test(trimmed)) {
    return (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('mailto:')
    );
  }
  // A relative path with no scheme.
  return true;
}

const INLINE = /(!?\[[^\]]*\]\([^)]*\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;

/** Bold, italic, inline code, links and images inside one line of text. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let index = 0;
  let key = 0;

  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > index) out.push(text.slice(index, start));
    const token = match[0];
    const k = `${keyPrefix}-i${key++}`;

    const link = /^(!?)\[([^\]]*)\]\(([^)]*)\)$/.exec(token);
    if (link) {
      const [, bang, label, rawHref] = link;
      const href = rawHref.trim();
      if (bang) {
        out.push(
          isSafeHref(href) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={k} src={href} alt={label} />
          ) : (
            <span key={k}>{label}</span>
          )
        );
      } else if (isSafeHref(href)) {
        out.push(
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            {label || href}
          </a>
        );
      } else {
        // The label survives; the target does not. Silently dropping the whole thing would hide
        // that something was there.
        out.push(<span key={k}>{label}</span>);
      }
    } else if (token.startsWith('`')) {
      out.push(<code key={k}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<strong key={k}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={k}>{token.slice(1, -1)}</em>);
    }
    index = start + token.length;
  }

  if (index < text.length) out.push(text.slice(index));
  return out;
}

// ── Blocks ───────────────────────────────────────────────────────────────────

const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const RULE = /^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * Render a markdown document as React elements.
 *
 * A line-at-a-time block scanner rather than a two-pass parser: a wiki page is small, and keeping
 * the whole thing in one readable loop is worth more here than the generality a real AST would buy.
 */
export function renderMarkdown(source: string): React.ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  const nextKey = () => `b${key++}`;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code. Everything up to the closing fence is literal, including anything that would
    // otherwise look like a heading or a list.
    if (/^\s*```/.test(line)) {
      const language = line.trim().slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // the closing fence
      out.push(
        <pre key={nextKey()} data-language={language || undefined}>
          <code>{body.join('\n')}</code>
        </pre>
      );
      continue;
    }

    if (RULE.test(line)) {
      out.push(<hr key={nextKey()} />);
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${Math.min(level, 6)}` as 'h1';
      const k = nextKey();
      out.push(<Tag key={k}>{renderInline(heading[2], k)}</Tag>);
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      const k = nextKey();
      out.push(<blockquote key={k}>{renderMarkdown(body.join('\n'))}</blockquote>);
      continue;
    }

    // A table needs its divider row to be a table at all; without one this is a paragraph that
    // happens to contain pipes.
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      const k = nextKey();
      out.push(
        <table key={k}>
          <thead>
            <tr>
              {header.map((cell, c) => (
                <th key={c}>{renderInline(cell, `${k}-h${c}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>{renderInline(cell, `${k}-${r}-${c}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }

    // A task list is a bullet list whose items all start with a checkbox, and it renders
    // differently enough to be its own block. Mixed lists fall through to the bullet branch, where
    // the `[ ]` is just text.
    if (TASK.test(line)) {
      const items: Array<{ done: boolean; text: string }> = [];
      while (i < lines.length && TASK.test(lines[i])) {
        const m = TASK.exec(lines[i])!;
        items.push({ done: m[1].toLowerCase() === 'x', text: m[2] });
        i += 1;
      }
      const k = nextKey();
      out.push(
        <ul key={k} data-task-list="">
          {items.map((item, n) => (
            <li key={n} data-checked={item.done ? '' : undefined}>
              {/* Read-only: editing a task means editing the page, which is where the change is
                  recorded as a version. A checkbox that wrote through would be an untracked edit. */}
              <input type="checkbox" checked={item.done} readOnly tabIndex={-1} />
              <span>{renderInline(item.text, `${k}-${n}`)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (UNORDERED.test(line) || ORDERED.test(line)) {
      const ordered = !UNORDERED.test(line);
      const pattern = ordered ? ORDERED : UNORDERED;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i]) && !TASK.test(lines[i])) {
        items.push(pattern.exec(lines[i])![1]);
        i += 1;
      }
      const k = nextKey();
      const ListTag = ordered ? 'ol' : 'ul';
      out.push(
        <ListTag key={k}>
          {items.map((item, n) => (
            <li key={n}>{renderInline(item, `${k}-${n}`)}</li>
          ))}
        </ListTag>
      );
      continue;
    }

    // A paragraph runs to the next blank line or the next line that starts a different block.
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !HEADING.test(lines[i]) &&
      !UNORDERED.test(lines[i]) &&
      !ORDERED.test(lines[i]) &&
      !RULE.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i])
    ) {
      body.push(lines[i]);
      i += 1;
    }
    const k = nextKey();
    out.push(<p key={k}>{renderInline(body.join(' '), k)}</p>);
  }

  return out;
}

/** The first paragraph of a page, for a list subtitle. */
export function markdownExcerpt(source: string, max = 140): string {
  const text = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>|#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
