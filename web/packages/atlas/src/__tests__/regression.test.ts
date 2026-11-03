import { describe, expect, it } from 'vitest';
import { parse, parseLayout } from '../parse';
import { childrenOf, type MarkdownNode } from '../tree';

/** Ported from AtlasKit's ParserRegressionTests: cases beyond the corpus that both parsers must agree on. */
function text(source: string): string {
  const collect = (n: MarkdownNode): string => {
    switch (n.type) {
      case 'text': case 'inlineCode': case 'html': return n.value;
      case 'code': return n.value;
      default: return childrenOf(n).map(collect).join('');
    }
  };
  return collect(parse(source));
}
const root = (...children: MarkdownNode[]): MarkdownNode => ({ type: 'root', children });
const para = (...children: MarkdownNode[]): MarkdownNode => ({ type: 'paragraph', blockId: null, children });
const t = (value: string): MarkdownNode => ({ type: 'text', value });

describe('parser regressions', () => {
  it("footnote-like openers don't lose text", () => {
    expect(text('[^[x]]y\n')).toBe('[^[x]]y');
    expect(text('a [^[^b]] c\n')).toBe('a [^[^b]] c');
    expect(text('```\n[^[x]]y\n```\n')).toBe('[^[x]]y');
    expect(text('[^a\nb]x\n')).toBe('[^a\nb]x');
    expect(text('p [^ q] r\n')).toBe('p [^ q] r');
    expect(text('[^```]```\nz]\n')).toBe('[^]\nz]');
    expect(text('``[^[`]x]\n')).toBe('``[^[`]x]');
    expect(parse('A[^n].\n\n[^n]: B.\n')).toEqual(root(
      para(t('A'), { type: 'footnoteReference', identifier: 'n', label: 'n' }, t('.')),
      { type: 'footnoteDefinition', identifier: 'n', label: 'n', children: [para(t('B.'))] }));
    expect(parse('[^a b](u)\n')).toEqual(root(para({ type: 'link', url: 'u', title: null, children: [t('^a b')] })));
  });

  it('keeps private-use characters', () => {
    expect(text('^\n')).toBe('^');
    expect(text('ab\n')).toBe('ab');
    expect(text('`` #x\n')).toBe(' #x');
    expect(text('`⸾` ⸼⸽ ⹁#x\n')).toBe('⸾ ⸼⸽ ⹁#x');
  });

  it('decodes references to reserved characters as characters', () => {
    expect(text('a &#11838; b &#x2E3E; &#57344;x\n')).toBe('a ⸾ b ⸾ x');
    expect(text('`&#11838;`\n')).toBe('&#11838;');
  });

  it('markers flank like the punctuation they replace', () => {
    expect(parse('*]*\\^\n')).toEqual(root(para({ type: 'emphasis', children: [t(']')] }, t('^'))));
    const x = { type: 'wikiLink' as const, target: 'x', heading: null, blockId: null, alias: null };
    expect(parse('a*[[x]]*b\n')).toEqual(root(para(t('a*'), x, t('*b'))));
    expect(parse('*[[x]]*\n')).toEqual(root(para({ type: 'emphasis', children: [x] })));
  });

  it('has no inline attributes, smart punctuation or table spans', () => {
    expect(text('^[text](a: 1) after\n')).toBe('^[text](a: 1) after');
    expect(text('^[][1]\n')).toBe('^[][1]');
    expect(text('"quoted" -- dash --- \'single\'\n')).toBe('"quoted" -- dash --- \'single\'');
    const table = childrenOf(parse('| a | b |\n| --- | --- |\n| x |  |\n| ^ | y |\n'))[0];
    expect(childrenOf(table).map((r) => childrenOf(r).length)).toEqual([2, 2, 2]);
    expect(childrenOf(childrenOf(table)[2])[0]).toEqual({ type: 'tableCell', children: [t('^')] });
  });

  it('ends a list where an HTML line lifted out of it starts', () => {
    // cmark-gfm ends the list at the unindented `</content>`; micromark reads it into the item.
    // The list's lines stop before it, as AtlasKit's do, so the two blocks don't overlap.
    expect(parseLayout('- one\n  two\n</content>\n</invoke>\n').map((b) => [b.node.type, b.lines])).toEqual([
      ['list', [1, 2]],
      ['html', [3, 4]],
    ]);
  });
});
