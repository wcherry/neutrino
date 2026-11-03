import { describe, expect, it } from 'vitest';
import { MarkdownDocument } from '../document';
import { parse } from '../parse';
import { LinkResolver } from '../resolve';
import type { MarkdownNode } from '../tree';

/** Ported from AtlasKit's DocumentEditingTests and InPlaceEditTests: both implementations agree on edits. */
const paragraph = (text: string): MarkdownNode => ({ type: 'paragraph', blockId: null, children: [{ type: 'text', value: text }] });

describe('source preservation while editing (§8.1)', () => {
  it('replacing a block changes only that block', () => {
    const doc = new MarkdownDocument('Title\n=====\n\n* one\n\t* nested\n\n\nOld _text_ here.\n\nLast.\n');
    expect(doc.blocks).toHaveLength(4);
    expect(doc.replaceBlock(2, paragraph('New text.'))).toBe(true);
    expect(doc.serialized()).toBe('Title\n=====\n\n* one\n\t* nested\n\n\nNew text.\n\nLast.\n');
  });

  it("uses the file's line endings and keeps its BOM", () => {
    const doc = new MarkdownDocument('﻿# A\r\n\r\nold\r\n');
    expect(doc.lineEnding).toBe('\r\n');
    doc.replaceBlock(0, { type: 'heading', depth: 1, children: [{ type: 'text', value: 'B' }] });
    doc.replaceBlock(1, paragraph('one\ntwo'));
    expect(doc.serialized()).toBe('﻿# B\r\n\r\none\r\ntwo\r\n');
  });

  it('a paragraph a table interrupts keeps its lines', () => {
    let doc = new MarkdownDocument('a\\\nb  \nc\n| x | y |\n|---|---|\n');
    expect(doc.replaceBlock(0, paragraph('Z'))).toBe(true);
    expect(doc.serialized()).toBe('Z\n\n| x | y |\n|---|---|\n');
    doc = new MarkdownDocument('one\ntwo\n\nthree\n| x | y |\n|---|---|\n');
    expect(doc.replaceBlock(0, paragraph('Z'))).toBe(true);
    expect(doc.serialized()).toBe('Z\n\nthree\n| x | y |\n|---|---|\n');
  });

  it('an unclosed fence keeps its blank lines', () => {
    const doc = new MarkdownDocument('```\nx\n\n');
    expect(doc.replaceBlock(0, { type: 'code', lang: null, meta: null, value: 'y', blockId: null })).toBe(true);
    expect(doc.serialized()).toBe('```\ny\n```\n');
  });

  it('inserts and removes', () => {
    const doc = new MarkdownDocument('A\n\nB\n');
    doc.insertBlock(paragraph('Middle'), 1);
    expect(doc.serialized()).toBe('A\n\nMiddle\n\nB\n');
    doc.insertBlock(paragraph('End'), 3);
    expect(doc.serialized()).toBe('A\n\nMiddle\n\nB\n\nEnd\n');
    doc.removeBlock(1);
    expect(doc.serialized()).toBe('A\n\nB\n\nEnd\n');
    doc.removeBlock(2);
    expect(doc.serialized()).toBe('A\n\nB\n');
    expect(doc.tree).toEqual(parse(doc.serialized()));
  });

  it('inserts into an empty page', () => {
    const doc = new MarkdownDocument('');
    doc.insertBlock(paragraph('First'), 0);
    expect(doc.serialized()).toBe('First\n');
  });

  it('a list inserted after a list uses the other marker', () => {
    const doc = new MarkdownDocument('- a\n');
    doc.insertBlock({ type: 'list', ordered: false, start: null, spread: false, blockId: null, children: [{ type: 'listItem', checked: null, spread: false, children: [paragraph('b')] }] }, 1);
    expect(doc.serialized()).toBe('- a\n\n* b\n');
    expect((parse(doc.serialized()) as { children: unknown[] }).children).toHaveLength(2);
  });

  it('escapes edited text only where needed', () => {
    const doc = new MarkdownDocument('x\n');
    doc.replaceBlock(0, paragraph('Literal [[Page]], #tag, ==mark==, $5$ and 2 * 3 * 4.'));
    expect(doc.serialized()).toBe('Literal \\[[Page]], \\#tag, \\==mark==, \\$5$ and 2 * 3 * 4.\n');
  });

  it('keeps reference definitions in gaps', () => {
    const doc = new MarkdownDocument('See [it][r].\n\n[r]: https://example.com\n\nEdit me.\n');
    expect(doc.blocks).toHaveLength(2);
    doc.replaceBlock(1, paragraph('Edited.'));
    expect(doc.serialized()).toBe('See [it][r].\n\n[r]: https://example.com\n\nEdited.\n');
  });

  it('removing the block between two lists keeps them apart', () => {
    const doc = new MarkdownDocument('- a\n\nBetween.\n\n- b\n');
    expect(doc.removeBlock(1)).toBe(true);
    expect(doc.serialized()).toBe('- a\n\n* b\n');
    expect(doc.blocks).toHaveLength(2);
  });

  it('a thematic break inserted at the top is not frontmatter', () => {
    const doc = new MarkdownDocument('Text\n\n---\n');
    doc.insertBlock({ type: 'thematicBreak' }, 0);
    expect(doc.serialized()).toBe('***\n\nText\n\n---\n');
    expect(doc.tree).toEqual(parse(doc.serialized()));
  });
});

describe('in-place edits (§8.2)', () => {
  it('toggling a task changes one character', () => {
    const doc = new MarkdownDocument('* [ ] one\n*   [X] two\n\n> 1) [ ] quoted\n\n- parent\n\t- [ ] tab-indented child\n');
    expect(doc.taskCount).toBe(4);
    expect(doc.setTask(0, true)).toEqual({ inPlace: true, exact: true });
    expect(doc.serialized()).toBe('* [x] one\n*   [X] two\n\n> 1) [ ] quoted\n\n- parent\n\t- [ ] tab-indented child\n');
    expect(doc.setTask(1, false)).toEqual({ inPlace: true, exact: true });
    expect(doc.setTask(2, true)).toEqual({ inPlace: true, exact: true });
    expect(doc.setTask(3, true)).toEqual({ inPlace: true, exact: true });
    expect(doc.serialized()).toBe('* [x] one\n*   [ ] two\n\n> 1) [x] quoted\n\n- parent\n\t- [x] tab-indented child\n');
    expect(doc.tree).toEqual(parse(doc.serialized()));
  });

  it('keeps CRLF, and does nothing when already set', () => {
    const doc = new MarkdownDocument('- [x] done\r\n- [ ] open\r\n');
    expect(doc.setTask(0, true)).toEqual({ inPlace: true, exact: true });
    expect(doc.setTask(1, true)).toEqual({ inPlace: true, exact: true });
    expect(doc.serialized()).toBe('- [x] done\r\n- [x] open\r\n');
  });

  it("takes a task's state from its checkbox", () => {
    const root = parse('- [ ] see [x] here\n> - [X] quoted\n') as Extract<MarkdownNode, { type: 'root' }>;
    expect(root.children[0]).toMatchObject({ type: 'list', children: [{ checked: false, children: [{ children: [{ type: 'text', value: 'see [x] here' }] }] }] });
    expect(root.children[1]).toMatchObject({ type: 'blockquote', children: [{ type: 'list', children: [{ checked: true, children: [{ children: [{ value: 'quoted' }] }] }] }] });
    expect((parse('> - \\[ ] escaped\n') as Extract<MarkdownNode, { type: 'root' }>).children[0])
      .toMatchObject({ children: [{ children: [{ checked: null, children: [{ children: [{ value: '[ ] escaped' }] }] }] }] });
  });

  it('toggles tasks inside callouts and across blocks', () => {
    const doc = new MarkdownDocument('Intro.\n\n> [!todo] Week\n> - [ ] plan\n> - [ ] ship\n\nEnd.\n');
    expect(doc.taskCount).toBe(2);
    expect(doc.setTask(1, true)).toEqual({ inPlace: true, exact: true });
    expect(doc.serialized()).toBe('Intro.\n\n> [!todo] Week\n> - [ ] plan\n> - [x] ship\n\nEnd.\n');
  });

  const renameRoadmap = (source: string, newPath = 'Plans/Roadmap 2027.md', files = ['Roadmap.md', 'Inbox.md', 'Other.md']) => {
    const doc = new MarkdownDocument(source);
    const after = files.map((f) => (f === 'Roadmap.md' ? newPath : f));
    const result = doc.rewriteLinksToRenamed('Roadmap.md', newPath, 'Inbox.md', new LinkResolver(files), new LinkResolver(after));
    expect(doc.tree).toEqual(parse(doc.serialized()));
    return [doc.serialized(), result] as const;
  };

  it('wiki links keep everything but the target', () => {
    const [out, result] = renameRoadmap('See [[ Roadmap #Phase 2| the plan ]], [[roadmap#^summary]], ![[Roadmap]] and [[Other]].\n');
    expect(out).toBe('See [[ Roadmap 2027 #Phase 2| the plan ]], [[Roadmap 2027#^summary]], ![[Roadmap 2027]] and [[Other]].\n');
    expect(result).toEqual({ rewritten: 3, inPlace: true, exact: true });
  });

  it('leaves same-page links, code and other blocks alone', () => {
    const source = '# Roadmap\n\nJump to [[#Roadmap]]. Code: `[[Roadmap]]`.\n\n```\n[[Roadmap]]\n```\n\n* untouched _list_\n\nLink [[Roadmap]].\n';
    const [out, result] = renameRoadmap(source);
    expect(out).toBe(source.replace('Link [[Roadmap]].', 'Link [[Roadmap 2027]].'));
    expect(result.rewritten).toBe(1);
    expect(result.inPlace).toBe(true);
  });

  it('keeps the escaped separator in tables', () => {
    const [out] = renameRoadmap('| Page | Why |\n|:-|-|\n| [[Roadmap\\|plan]] | x |\n');
    expect(out).toBe('| Page | Why |\n|:-|-|\n| [[Roadmap 2027\\|plan]] | x |\n');
  });

  it('markdown links keep their style and fragment', () => {
    const [out, result] = renameRoadmap('[a](Roadmap.md#Phase%202) [b](<Roadmap.md>) [c](Road%6Dap.md) [d](https://x.com/Roadmap.md) [e](Old/../Roadmap.md)\n', undefined, ['Roadmap.md', 'Inbox.md']);
    expect(out).toBe('[a](<Roadmap 2027.md#Phase%202>) [b](<Roadmap 2027.md>) [c](Roadmap%202027.md) [d](https://x.com/Roadmap.md) [e](Old/../Roadmap.md)\n');
    expect(result.rewritten).toBe(3);
    expect(result.inPlace).toBe(true);
  });

  it('rewrites reference definitions in gaps', () => {
    const [out, result] = renameRoadmap('See [the plan][r] and [[Roadmap]].\n\n[r]: Roadmap.md "Plan"\n\nEnd.\n');
    expect(out).toBe('See [the plan][r] and [[Roadmap 2027]].\n\n[r]: <Roadmap 2027.md> "Plan"\n\nEnd.\n');
    expect(result).toEqual({ rewritten: 2, inPlace: true, exact: true });
  });

  it("handles definitions at a paragraph's start, and stray brackets", () => {
    const [out, result] = renameRoadmap('[r]:Roadmap.md\n[r] and ](Roadmap.md) then [x](Roadmap.md)\n');
    expect(out).toBe('[r]:<Roadmap 2027.md>\n[r] and ](Roadmap.md) then [x](<Roadmap 2027.md>)\n');
    expect(result).toEqual({ rewritten: 2, inPlace: true, exact: true });
  });

  it('gives ambiguous names the shortest unique target', () => {
    const doc = new MarkdownDocument('[[Projects/Roadmap]]\n');
    doc.rewriteLinksToRenamed('Projects/Roadmap.md', 'Archive/Roadmap.md', 'Inbox.md',
      new LinkResolver(['Projects/Roadmap.md', 'Inbox.md']), new LinkResolver(['Archive/Roadmap.md', 'Roadmap.md', 'Inbox.md']));
    expect(doc.serialized()).toBe('[[Archive/Roadmap]]\n');
  });
});
