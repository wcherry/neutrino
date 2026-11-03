import { describe, expect, it } from 'vitest';
import { MarkdownDocument } from '../document';
import { parse } from '../parse';
import { isReserved } from '../preprocess';
import { LinkResolver } from '../resolve';
import { deepEqual, serializeBlock } from '../serialize';
import { childrenOf, type MarkdownNode } from '../tree';

/**
 * Deterministic fuzzing, ported from AtlasKit's ParserFuzzTests with the same generator, so both
 * implementations run on exactly the same inputs.
 */
class Generator {
  private state: bigint;
  constructor(seed: number) { this.state = BigInt(seed); }
  next(bound: number): number {
    this.state = (this.state * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    return Number((this.state >> 33n) % BigInt(bound));
  }
}

const PIECES = [...Array.from('[[]]!#=^$|\\`*_~<>-+.:() \t\n'),
  'a', 'x', '1', '```', '``', '$$', '[!note]', '==', '#t', '<b>', '[^', '[^1]', '^[',
  '', '', '', '', '',
  '⸼', '⸽', '⸾', '⸿', '⹀', '⹁', '⹂'];

function allText(node: MarkdownNode): string {
  switch (node.type) {
    case 'text': case 'inlineCode': case 'html': case 'yaml': case 'inlineMath': return node.value;
    case 'code': return (node.lang ?? '') + (node.meta ?? '') + node.value;
    case 'math': return node.value;
    case 'link': return node.url + (node.title ?? '') + node.children.map(allText).join('');
    case 'image': return node.url + (node.title ?? '') + node.alt;
    case 'wikiLink': case 'embed': return node.target + (node.heading ?? '') + (node.blockId ?? '') + (node.alias ?? '');
    case 'tag': return node.name;
    case 'callout': return node.calloutType + (node.title ?? []).map(allText).join('') + node.children.map(allText).join('');
    case 'footnoteReference': return node.identifier + (node.label ?? '');
    case 'footnoteDefinition': return node.identifier + (node.label ?? '') + node.children.map(allText).join('');
    default: return childrenOf(node).map(allText).join('');
  }
}

const containsFootnoteReference = (n: MarkdownNode): boolean => n.type === 'footnoteReference' || childrenOf(n).some(containsFootnoteReference);

describe('parser fuzzing', () => {
  it('saving is exact, and the exact flag is truthful', () => {
    const rng = new Generator(0x5a7e);
    const pieces = [...PIECES, 'www.x.com', 'http://a.b', '- ', '1. ', '> ', '---', '| a |', '\n\n', '&amp;', '&#10;', '^id'];
    for (let n = 0; n < 1500; n++) {
      const source = Array.from({ length: rng.next(60) }, () => pieces[rng.next(pieces.length)]).join('');
      const doc = new MarkdownDocument(source);
      expect(doc.serialized(), `saving without edits changed ${JSON.stringify(source)}`).toBe(source);
      let previousText: string | null = null;
      doc.blocks.forEach((block, i) => {
        const { text, exact } = serializeBlock(block, i > 0 ? doc.blocks[i - 1] : null, previousText, i === 0);
        if (exact && block.type !== 'yaml' && block.type !== 'footnoteDefinition' && !containsFootnoteReference(block)) {
          const context = (previousText !== null ? previousText + '\n\n' : '') + text + '\n';
          const offset = previousText !== null ? childrenOf(parse(previousText + '\n')).length : 0;
          const parsed = childrenOf(parse(context));
          expect(offset < parsed.length && deepEqual(parsed[offset], block), `exact claimed for ${JSON.stringify(text)} from ${JSON.stringify(source)}`).toBe(true);
        }
        previousText = text;
      });
    }
  });

  it('in-place edits are minimal and honest', () => {
    const rng = new Generator(0x7a5c);
    const pieces = [...Array.from('[]!#=^$|\\`*_~<>-+.:() \t\n'),
      'a', 'x', '- [ ] ', '- [x] ', '> ', '* [X] ', '1. [ ] ', '[[P]]', '[[ P |a]]', '![[P]]', '[[P#h]]',
      '[t](P.md)', '[r]: P.md\n', '[r]', '`[[P]]`', '```\n', '| [[P\\|x]] |\n|-|\n'];
    for (let n = 0; n < 1500; n++) {
      const source = Array.from({ length: rng.next(40) }, () => pieces[rng.next(pieces.length)]).join('');
      const doc = new MarkdownDocument(source);
      for (let i = 0; i < doc.taskCount; i++) {
        const before = new TextEncoder().encode(doc.serialized());
        const result = doc.setTask(i, rng.next(2) === 0);
        const after = new TextEncoder().encode(doc.serialized());
        if (result.inPlace) {
          expect(after.length, `toggle changed the length of ${JSON.stringify(source)}`).toBe(before.length);
          expect(before.filter((b, k) => b !== after[k]).length).toBeLessThanOrEqual(1);
        }
        if (result.exact) expect(doc.isExact, `toggle claimed exact for ${JSON.stringify(source)}`).toBe(true);
      }
      const result = doc.rewriteLinksToRenamed('P.md', 'Q R.md', 'Inbox.md', new LinkResolver(['P.md', 'Inbox.md']), new LinkResolver(['Q R.md', 'Inbox.md']));
      if (result.exact) expect(doc.isExact, `rename claimed exact for ${JSON.stringify(source)}`).toBe(true);
    }
  });

  it('never throws, and keeps reserved characters', () => {
    const rng = new Generator(0xa71a5);
    for (let n = 0; n < 5000; n++) {
      const source = Array.from({ length: rng.next(80) }, () => PIECES[rng.next(PIECES.length)]).join('');
      const text = allText(parse(source));
      if (source.includes(']:') || source.includes('|')) continue;
      for (const c of new Set(Array.from(source).filter((c) => isReserved(c.codePointAt(0)!)))) {
        const want = Array.from(source).filter((x) => x === c).length;
        const got = Array.from(text).filter((x) => x === c).length;
        expect(got, `lost U+${c.codePointAt(0)!.toString(16).toUpperCase()} from ${JSON.stringify(source)}`).toBeGreaterThanOrEqual(want);
      }
    }
  });
});
