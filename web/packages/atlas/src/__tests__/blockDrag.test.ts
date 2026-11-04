// AtlasKit's BlockDragTests, ported.
import { describe, expect, it } from 'vitest';
import { dragBlocks, moveBlock } from '../editing/blockDrag';
import { applyEdit } from '../editing/markdownEditing';
import { pageSyntax } from '../syntax/pageSyntax';

const blocks = (text: string) => dragBlocks(text, pageSyntax(text)).map((b) => text.slice(b.from, b.to));

/** Drags block number `from` to before block number `to` (null: the end); the result has `|` at the cursor. */
function drag(text: string, from: number, to: number | null): string | null {
  const all = dragBlocks(text, pageSyntax(text));
  const edit = moveBlock(all[from], to === null ? null : all[to].from, text);
  if (!edit) return null;
  const out = applyEdit(text, edit);
  return out.slice(0, edit.selection.from) + '|' + out.slice(edit.selection.from);
}

const nonBlank = (text: string) => text.split('\n').filter((l) => l.trim() !== '').sort();

describe('dragging blocks', () => {
  it('finds the blocks a handle moves', () => {
    const page = '---\ntitle: A\n---\n# Plan\n\nIntro line one\nline two\n\n- a\n  - a1\n- b\n\n```\ncode\n```\n';
    expect(blocks(page), "the frontmatter stays; a list's items move one by one, with their nested items").toEqual([
      '# Plan', 'Intro line one\nline two', '- a\n  - a1', '- b', '```\ncode\n```',
    ]);
  });

  it('keeps a blank line each side of a paragraph', () => {
    const page = 'One\n\nTwo\n\nThree';
    expect(drag(page, 2, 0)).toBe('|Three\n\nOne\n\nTwo');
    expect(drag(page, 0, null)).toBe('Two\n\nThree\n\n|One');
    expect(drag(page, 0, 2)).toBe('Two\n\n|One\n\nThree');
    expect(drag('One\n\nTwo\n', 0, null), 'the final newline stays last').toBe('Two\n\n|One\n');
    expect(drag(page, 1, 1), 'onto itself').toBeNull();
    expect(drag(page, 1, 2), 'where it already is').toBeNull();
  });

  it('moves list items among their siblings', () => {
    const list = '- a\n  - a1\n- b\n- c';
    expect(drag(list, 0, null)).toBe('- b\n- c\n|- a\n  - a1');
    expect(drag(list, 2, 0)).toBe('|- c\n- a\n  - a1\n- b');
    expect(drag('Intro\n\n- a\n- b', 2, 0), "out of the list, it's set apart").toBe('|- b\n\nIntro\n\n- a');
    expect(drag('Intro\n\n- a\n- b', 1, 0), 'nothing left joined together').toBe('|- a\n\nIntro\n\n- b');
  });

  it('moves code whole', () => {
    expect(drag('Text\n\n```\nx\n\ny\n```', 1, 0)).toBe('|```\nx\n\ny\n```\n\nText');
  });

  it('edits only what changed', () => {
    const page = 'Keep\n\nOne\n\nTwo';
    const all = dragBlocks(page, pageSyntax(page));
    const edit = moveBlock(all[2], all[1].from, page)!;
    expect(edit.from, '"Keep" is untouched').toBeGreaterThanOrEqual(6);
    expect(applyEdit(page, edit)).toBe('Keep\n\nTwo\n\nOne');
  });

  it('keeps every line, whatever moves where', () => {
    const pages = [
      '# A\n\nOne\ntwo\n\n- x\n  - x1\n- y\n\n> quote\n\n```\nc\n```\n',
      '---\nt: 1\n---\nP\n\n1. a\n2. b\n\n| h |\n| - |\n| v |',
      '- [ ] task\n- [x] done\n\nAfter',
    ];
    for (const page of pages) {
      const all = dragBlocks(page, pageSyntax(page));
      for (let from = 0; from < all.length; from++) {
        for (const to of [...all.keys(), null]) {
          const edit = moveBlock(all[from], to === null ? null : all[to].from, page);
          if (!edit) continue;
          const moved = applyEdit(page, edit);
          expect(nonBlank(moved), `${from} → ${to} in ${page}`).toEqual(nonBlank(page));
          expect(moved.includes('\n\n\n'), `no doubled blank lines: ${moved}`).toBe(false);
          expect(dragBlocks(moved, pageSyntax(moved)), `nothing ran together: ${moved}`).toHaveLength(all.length);
        }
      }
    }
  });
});
