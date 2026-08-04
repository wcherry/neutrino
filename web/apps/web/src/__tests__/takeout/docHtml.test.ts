/**
 * Tests for the HTML → document JSON converter (`lib/takeout/docHtml.ts`).
 *
 * The input is what mammoth makes of a `.docx` (semantic tags) or what Google
 * writes into an HTML export (divs and inline styles); the output has to be
 * ProseMirror JSON the docs editor can load, which means the right node names,
 * marks in the right place, and never a structure ProseMirror would reject —
 * an empty text node, or a list item with no block inside it.
 */

import { describe, it, expect } from 'vitest';
import { htmlToDocJson, textToDocJson, type PmNode } from '@/lib/takeout/docHtml';

const body = (html: string) => htmlToDocJson(html).content ?? [];
const first = (html: string) => body(html)[0];

/** The text of a node tree, ignoring structure — for asserting nothing is lost. */
function textOf(node: PmNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(textOf).join('');
}

describe('htmlToDocJson', () => {
  it('wraps the result as a doc node', () => {
    expect(htmlToDocJson('<p>Hello</p>')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    });
  });

  it('gives an empty document a paragraph to put the cursor in', () => {
    expect(htmlToDocJson('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(htmlToDocJson('   ')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('converts headings with their level', () => {
    expect(first('<h2>Title</h2>')).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(first('<h6>Deep</h6>')).toMatchObject({ type: 'heading', attrs: { level: 6 } });
  });

  it('keeps an empty paragraph, which is deliberate spacing', () => {
    expect(body('<p>a</p><p></p><p>b</p>')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
    ]);
  });

  it('does not turn the whitespace between blocks into paragraphs', () => {
    expect(body('<p>a</p>\n  \n<p>b</p>')).toHaveLength(2);
  });

  it('trims the whitespace the markup indented text with', () => {
    expect(first('<p>\n  Hello\n</p>')).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Hello' }],
    });
  });

  it('converts the semantic tags mammoth emits into marks', () => {
    const marksOf = (html: string) => (first(html).content![0].marks ?? []).map((m) => m.type);

    expect(marksOf('<p><strong>x</strong></p>')).toEqual(['bold']);
    expect(marksOf('<p><b>x</b></p>')).toEqual(['bold']);
    expect(marksOf('<p><em>x</em></p>')).toEqual(['italic']);
    expect(marksOf('<p><u>x</u></p>')).toEqual(['underline']);
    expect(marksOf('<p><s>x</s></p>')).toEqual(['strike']);
    expect(marksOf('<p><code>x</code></p>')).toEqual(['code']);
    expect(marksOf('<p><mark>x</mark></p>')).toEqual(['highlight']);
  });

  it('nests marks through nested elements', () => {
    const node = first('<p><strong>bold <em>and italic</em></strong></p>');
    expect(node.content).toEqual([
      { type: 'text', text: 'bold ', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'and italic', marks: [{ type: 'bold' }, { type: 'italic' }] },
    ]);
  });

  it('reads formatting Google expressed as an inline style', () => {
    const marksOf = (style: string) =>
      (first(`<p><span style="${style}">x</span></p>`).content![0].marks ?? []).map((m) => m.type);

    expect(marksOf('font-weight:700')).toEqual(['bold']);
    expect(marksOf('font-style: italic')).toEqual(['italic']);
    expect(marksOf('text-decoration: underline')).toEqual(['underline']);
    expect(marksOf('text-decoration: line-through')).toEqual(['strike']);
  });

  it('carries colour and highlight over as their marks', () => {
    const coloured = first('<p><span style="color: #ff0000">x</span></p>').content![0];
    expect(coloured.marks).toEqual([{ type: 'textStyle', attrs: { color: '#ff0000' } }]);

    const highlighted = first('<p><span style="background-color: yellow">x</span></p>').content![0];
    expect(highlighted.marks).toEqual([{ type: 'highlight', attrs: { color: 'yellow' } }]);
  });

  it('ignores a transparent background, which is Word saying "no highlight"', () => {
    expect(first('<p><span style="background-color: transparent">x</span></p>').content![0].marks).toBeUndefined();
  });

  it('keeps both attributes when one element sets colour and another sets a font', () => {
    const node = first('<p><span style="color: red"><span style="font-weight: bold">x</span></span></p>');
    expect(node.content![0].marks).toEqual([
      { type: 'textStyle', attrs: { color: 'red' } },
      { type: 'bold' },
    ]);
  });

  it('does not leak one span’s colour onto its siblings', () => {
    const node = first('<p><span style="color: red">a</span><span>b</span></p>');
    expect(node.content![1].marks).toBeUndefined();
  });

  it('converts links into a link mark on their text', () => {
    const node = first('<p>see <a href="https://example.com">this</a></p>');
    expect(node.content![1]).toEqual({
      type: 'text',
      text: 'this',
      marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
    });
  });

  it('keeps the text of a link with no href', () => {
    expect(textOf(first('<p><a>bare</a></p>'))).toBe('bare');
  });

  it('converts a bullet list', () => {
    expect(first('<ul><li>one</li><li>two</li></ul>')).toEqual({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
      ],
    });
  });

  it('nests a list inside the item it belongs to', () => {
    const list = first('<ul><li>outer<ul><li>inner</li></ul></li></ul>');
    const item = list.content![0];
    expect(item.content!.map((n) => n.type)).toEqual(['paragraph', 'bulletList']);
    expect(textOf(item.content![1])).toBe('inner');
  });

  it('gives an empty list item a paragraph, which ProseMirror requires', () => {
    expect(first('<ul><li></li></ul>').content![0]).toEqual({
      type: 'listItem',
      content: [{ type: 'paragraph' }],
    });
  });

  it('keeps an ordered list’s starting number when it is not 1', () => {
    expect(first('<ol start="3"><li>x</li></ol>')).toMatchObject({ type: 'orderedList', attrs: { start: 3 } });
    expect(first('<ol start="1"><li>x</li></ol>').attrs).toBeUndefined();
  });

  it('converts blockquotes, rules and code blocks', () => {
    expect(first('<blockquote><p>quoted</p></blockquote>')).toEqual({
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }],
    });
    expect(first('<hr>')).toEqual({ type: 'horizontalRule' });
    // Whitespace is content in a code block, so it is taken verbatim.
    expect(first('<pre>  indented\n  lines\n</pre>')).toEqual({
      type: 'codeBlock',
      content: [{ type: 'text', text: '  indented\n  lines' }],
    });
  });

  it('converts a line break into a hardBreak', () => {
    expect(first('<p>a<br>b</p>').content!.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text']);
  });

  it('converts a table, marking header cells', () => {
    const table = first('<table><tr><th>H</th></tr><tr><td>C</td></tr></table>');
    expect(table.type).toBe('table');
    expect(table.content!.map((row) => row.content![0].type)).toEqual(['tableHeader', 'tableCell']);
    expect(table.content![1].content![0]).toEqual({
      type: 'tableCell',
      attrs: { colspan: 1, rowspan: 1, colwidth: null },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'C' }] }],
    });
  });

  it('reads spans off a merged cell', () => {
    const cell = first('<table><tr><td colspan="2" rowspan="3">x</td></tr></table>').content![0].content![0];
    expect(cell.attrs).toMatchObject({ colspan: 2, rowspan: 3 });
  });

  it('finds rows the parser tucked into a tbody', () => {
    const table = first('<table><tbody><tr><td>a</td></tr></tbody></table>');
    expect(table.content).toHaveLength(1);
  });

  it('embeds images, which mammoth hands over as data URIs', () => {
    const node = first('<p><img src="data:image/png;base64,AAA" alt="a logo"></p>');
    expect(node.content![0]).toEqual({
      type: 'image',
      attrs: { src: 'data:image/png;base64,AAA', alt: 'a logo' },
    });
  });

  it('drops an image with no source rather than emitting an unloadable node', () => {
    expect(body('<p><img alt="broken"></p>')).toEqual([{ type: 'paragraph' }]);
  });

  it('reads through the divs an HTML export wraps everything in', () => {
    expect(body('<div><div><p>deep</p></div></div>')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'deep' }] },
    ]);
  });

  it('puts loose text into a paragraph of its own', () => {
    expect(body('<div>loose<p>wrapped</p></div>')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'loose' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'wrapped' }] },
    ]);
  });

  it('carries paragraph alignment over', () => {
    expect(first('<p style="text-align: center">x</p>').attrs).toEqual({ textAlign: 'center' });
    expect(first('<p align="right">x</p>').attrs).toEqual({ textAlign: 'right' });
    expect(first('<p>x</p>').attrs).toBeUndefined();
  });

  it('ignores script and style, which an HTML export carries', () => {
    expect(body('<style>.c1 { font-weight: 700 }</style><p>text</p>')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'text' }] },
    ]);
  });

  it('keeps the text of a superscript even though the mark is flag-gated', () => {
    expect(textOf(first('<p>x<sup>2</sup></p>'))).toBe('x2');
  });
});

describe('textToDocJson', () => {
  it('makes a paragraph per line', () => {
    expect(textToDocJson('one\ntwo')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
      ],
    });
  });

  it('keeps blank lines as empty paragraphs but not the trailing newline', () => {
    expect(textToDocJson('one\n\ntwo\n').content!.map((n) => n.type === 'paragraph' && !n.content)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(textToDocJson('one\r\ntwo').content).toHaveLength(2);
  });

  it('gives an empty file a paragraph', () => {
    expect(textToDocJson('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});
