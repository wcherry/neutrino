/**
 * Writer and parser agree (issue #127).
 *
 * The property that matters is not "the writer emits a header" or "the parser
 * reads one" — either can be true while the pair still loses data. It is that
 * `read(write(model))` is `model`. This file asserts that over a document
 * carrying one of everything the editor can hold, and then over each feature
 * on its own so a failure says which mapping broke rather than just "not
 * equal".
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_PAGE_SETUP } from '@neutrino/api-docs';
import { writeDocx } from '@/lib/ooxml/docx/write';
import { readDocx } from '@/lib/ooxml/docx/read';
import type { DocModel, DocNode } from '@/lib/ooxml/docx/mapping';
import type { LayoutMeta } from '@/lib/docBody';

function baseMeta(over: Partial<LayoutMeta> = {}): LayoutMeta {
  return {
    headerFooter: {
      differentFirstPage: false, differentEvenOdd: false, headerMargin: 36, footerMargin: 36,
      variants: {
        default: { header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' } },
        first: { header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' } },
        even: { header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' } },
      },
    },
    headerText: '', footerText: '', showPageNumbers: false,
    watermarkText: '', bgColor: '', docTheme: 'default',
    properties: { author: '', subject: '', company: '', category: '', keywords: '', manager: '', custom: {} },
    pageSetup: { ...DEFAULT_PAGE_SETUP },
    ...over,
  } as LayoutMeta;
}

const para = (...content: DocNode[]): DocNode => ({ type: 'paragraph', attrs: {}, content });
const text = (t: string, marks?: DocNode['marks']): DocNode => marks ? { type: 'text', text: t, marks } : { type: 'text', text: t };

async function roundTrip(model: DocModel): Promise<DocModel> {
  const bytes = await writeDocx(model, { title: 'RT' });
  return readDocx(bytes);
}

/** The body only, for tests that are not about layout metadata. */
async function bodyRoundTrip(content: DocNode[]): Promise<DocNode[]> {
  const out = await roundTrip({ doc: { type: 'doc', content }, meta: baseMeta() });
  return out.doc.content ?? [];
}

describe('marks survive a round trip', () => {
  it.each([
    ['bold', [{ type: 'bold' }]],
    ['italic', [{ type: 'italic' }]],
    ['underline', [{ type: 'underline' }]],
    ['strike', [{ type: 'strike' }]],
    ['superscript', [{ type: 'superscript' }]],
    ['subscript', [{ type: 'subscript' }]],
    ['code', [{ type: 'code' }]],
  ] as const)('%s', async (_label, marks) => {
    const out = await bodyRoundTrip([para(text('x', marks as never))]);
    expect(out[0].content?.[0].marks).toEqual(marks);
  });

  it('colour, size and family', async () => {
    const marks = [{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: '18pt', fontFamily: 'Georgia' } }];
    const out = await bodyRoundTrip([para(text('x', marks as never))]);
    expect(out[0].content?.[0].marks).toEqual(marks);
  });

  it('a highlight outside OOXML’s sixteen colours', async () => {
    const marks = [{ type: 'highlight', attrs: { color: '#abcdef' } }];
    const out = await bodyRoundTrip([para(text('x', marks as never))]);
    expect(out[0].content?.[0].marks).toEqual(marks);
  });

  it('a link', async () => {
    const marks = [{ type: 'link', attrs: { href: 'https://example.com/a' } }];
    const out = await bodyRoundTrip([para(text('x', marks as never))]);
    expect(out[0].content?.[0].marks).toEqual(marks);
  });

  it('a tracked insertion keeps its author', async () => {
    const marks = [{ type: 'trackedInsertion', attrs: { author: 'Ada' } }];
    const out = await bodyRoundTrip([para(text('x', marks as never))]);
    expect(out[0].content?.[0].marks).toEqual(marks);
  });

  /**
   * Link and tracked change are both containers in OOXML rather than run
   * properties — `w:hyperlink` and `w:del` — so they have to nest rather than
   * one winning. Whichever is dropped, the text still reads correctly, which
   * is why this needs a test rather than an eye.
   */
  it('a link inside a tracked deletion keeps both', async () => {
    const marks = [
      { type: 'link', attrs: { href: 'https://example.com/a' } },
      { type: 'trackedDeletion', attrs: { author: 'Grace' } },
    ];
    const out = await bodyRoundTrip([para(text('x', marks as never))]);
    const got = (out[0].content?.[0].marks ?? []).map((m) => m.type).sort();
    expect(got).toEqual(['link', 'trackedDeletion']);
  });
});

describe('blocks survive a round trip', () => {
  it('headings keep their level', async () => {
    const out = await bodyRoundTrip([
      { type: 'heading', attrs: { level: 3 }, content: [text('H')] },
    ]);
    expect(out[0].type).toBe('heading');
    expect(out[0].attrs?.level).toBe(3);
  });

  it('alignment and indent', async () => {
    const out = await bodyRoundTrip([
      { type: 'paragraph', attrs: { textAlign: 'center', indent: 3 }, content: [text('x')] },
    ]);
    expect(out[0].attrs).toMatchObject({ textAlign: 'center', indent: 3 });
  });

  it('a bullet list keeps its glyph style', async () => {
    const out = await bodyRoundTrip([{
      type: 'bulletList', attrs: { listStyleType: 'square' },
      content: [{ type: 'listItem', content: [para(text('one'))] }],
    }]);
    expect(out[0].type).toBe('bulletList');
    expect(out[0].attrs?.listStyleType).toBe('square');
  });

  it('an ordered list keeps its numbering style', async () => {
    const out = await bodyRoundTrip([{
      type: 'orderedList', attrs: { listStyleType: 'lower-roman' },
      content: [{ type: 'listItem', content: [para(text('first'))] }],
    }]);
    expect(out[0].type).toBe('orderedList');
    expect(out[0].attrs?.listStyleType).toBe('lower-roman');
  });

  it('a nested list keeps its shape', async () => {
    const out = await bodyRoundTrip([{
      type: 'bulletList', attrs: { listStyleType: 'disc' },
      content: [{
        type: 'listItem',
        content: [
          para(text('outer')),
          { type: 'bulletList', attrs: { listStyleType: 'disc' }, content: [
            { type: 'listItem', content: [para(text('inner'))] },
          ]},
        ],
      }],
    }]);
    const inner = out[0].content?.[0].content?.[1];
    expect(inner?.type).toBe('bulletList');
    expect(inner?.content?.[0].content?.[0].content?.[0].text).toBe('inner');
  });

  /**
   * A numbered sub-list under a bulleted one. The two get different numbering
   * definitions, so a parser that ends a list at the first change of `w:numId`
   * unnests this into two sibling lists — which is what it used to do.
   */
  it('a nested list of a different kind stays nested', async () => {
    const out = await bodyRoundTrip([{
      type: 'bulletList', attrs: { listStyleType: 'disc' },
      content: [{
        type: 'listItem',
        content: [
          para(text('outer')),
          { type: 'orderedList', attrs: { listStyleType: 'decimal' }, content: [
            { type: 'listItem', content: [para(text('inner'))] },
          ]},
        ],
      }],
    }]);
    expect(out).toHaveLength(1);
    const inner = out[0].content?.[0].content?.[1];
    expect(inner?.type).toBe('orderedList');
    expect(inner?.attrs?.listStyleType).toBe('decimal');
  });

  it('a table keeps its cell shading and span', async () => {
    const out = await bodyRoundTrip([{
      type: 'table',
      content: [{ type: 'tableRow', content: [
        { type: 'tableCell', attrs: { backgroundColor: '#ddeeff', colspan: 2, rowspan: 1, colwidth: null },
          content: [para(text('cell'))] },
      ]}],
    }]);
    const cell = out[0].content?.[0].content?.[0];
    expect(out[0].type).toBe('table');
    expect(cell?.attrs).toMatchObject({ backgroundColor: '#ddeeff', colspan: 2 });
  });

  it('a blockquote', async () => {
    const out = await bodyRoundTrip([{ type: 'blockquote', content: [para(text('quoted'))] }]);
    expect(out[0].type).toBe('blockquote');
    expect(out[0].content?.[0].content?.[0].text).toBe('quoted');
  });

  // A quote is paragraphs carrying the quote style, so a multi-paragraph one
  // arrives as several one-paragraph quotes unless they are folded back
  // together — the same shape of problem as a list, and left alone it would
  // splinter a quote a little further on every save.
  it('a blockquote of several paragraphs stays one blockquote', async () => {
    const quote: DocNode = {
      type: 'blockquote',
      content: [
        { type: 'paragraph', attrs: { textAlign: 'right' }, content: [text('first')] },
        para(text('second')),
      ],
    };
    const out = await bodyRoundTrip([quote]);
    expect(out).toEqual([quote]);
  });

  it('a code block', async () => {
    const out = await bodyRoundTrip([{ type: 'codeBlock', content: [text('const x = 1;')] }]);
    expect(out[0].type).toBe('codeBlock');
    expect(out[0].content?.[0].text).toBe('const x = 1;');
  });

  it('a section break', async () => {
    const out = await bodyRoundTrip([para(text('a')), { type: 'sectionBreak' }, para(text('b'))]);
    expect(out.map((n) => n.type)).toEqual(['paragraph', 'sectionBreak', 'paragraph']);
  });

  it('a table of contents', async () => {
    const out = await bodyRoundTrip([{ type: 'tableOfContents' }]);
    expect(out.some((n) => n.type === 'tableOfContents')).toBe(true);
  });

  it('a column layout keeps its column count and children', async () => {
    const out = await bodyRoundTrip([
      { type: 'columnLayout', attrs: { columns: 3 }, content: [para(text('a')), para(text('b'))] },
    ]);
    expect(out[0].type).toBe('columnLayout');
    expect(out[0].attrs?.columns).toBe(3);
    expect(out[0].content).toHaveLength(2);
  });

  it('a hard break', async () => {
    const out = await bodyRoundTrip([para(text('a'), { type: 'hardBreak' }, text('b'))]);
    expect(out[0].content?.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text']);
  });
});

describe('nodes with no OOXML equivalent', () => {
  it('a footnote keeps its text', async () => {
    const out = await bodyRoundTrip([para(text('x'), { type: 'footnote', attrs: { id: 'f1', text: 'The note.' } })]);
    const fn = out[0].content?.find((n) => n.type === 'footnote');
    expect(fn?.attrs?.text).toBe('The note.');
  });

  it('a cross-reference keeps its target and its text', async () => {
    const out = await bodyRoundTrip([
      { type: 'heading', attrs: { level: 1 }, content: [text('Chapter One')] },
      para(text('see it', [{ type: 'crossRef', attrs: { headingText: 'Chapter One' } }] as never)),
    ]);
    const ref = out[1].content?.[0];
    expect(ref?.text).toBe('see it');
    expect(ref?.marks?.[0]).toEqual({ type: 'crossRef', attrs: { headingText: 'Chapter One' } });
  });

  it('a field code stays a field', async () => {
    const out = await bodyRoundTrip([para({ type: 'docField', attrs: { code: 'page', arg: null, showCode: false } })]);
    expect(out[0].content?.[0]).toEqual({ type: 'docField', attrs: { code: 'page', arg: null, showCode: false } });
  });

  it('a custom field keeps its argument', async () => {
    const out = await bodyRoundTrip([para({ type: 'docField', attrs: { code: 'custom', arg: 'client', showCode: true } })]);
    expect(out[0].content?.[0]).toEqual({ type: 'docField', attrs: { code: 'custom', arg: 'client', showCode: true } });
  });

  it('a Drive image reference comes back a reference, not inlined bytes', async () => {
    const out = await bodyRoundTrip([
      para({ type: 'image', attrs: { src: 'neutrino-drive:file-7', width: '320', shadow: 'md', caption: 'Fig 1' } }),
    ]);
    expect(out[0].content?.[0].attrs).toMatchObject({
      src: 'neutrino-drive:file-7', shadow: 'md', caption: 'Fig 1',
    });
  });

  // A block node in the editor's schema, so it is written as a paragraph of
  // its own and the whole paragraph is what the parser puts back.
  it('a sheet embed keeps its attributes', async () => {
    const attrs = { spreadsheetId: 's1', sheetId: 'sh1', namedRangeId: 'r1', title: 'Q1', cachedData: null, cachedAt: null };
    const out = await bodyRoundTrip([para(text('before')), { type: 'sheetEmbed', attrs }]);
    expect(out[1]).toEqual({ type: 'sheetEmbed', attrs });
  });

  it('a diagram embed keeps its attributes', async () => {
    const attrs = { diagramId: 'd1', title: 'Flow', cachedSvg: null };
    const out = await bodyRoundTrip([{ type: 'diagramEmbed', attrs }, para(text('after'))]);
    expect(out[0]).toEqual({ type: 'diagramEmbed', attrs });
  });

  /**
   * A placeholder is written as italic text, and so is the italic text a user
   * typed next to it — which makes them one run in the package, `[Fig 1]about`
   * on the way back, and no placeholder to restore. That misses *this*
   * placeholder and every later one, since they are matched in order. The
   * placeholder character style is what keeps the two runs apart.
   */
  it('a placeholder beside italic text is still found', async () => {
    const image: DocNode = { type: 'image', attrs: { src: 'neutrino-drive:file-1', width: '200' } };
    const embed: DocNode = { type: 'sheetEmbed', attrs: { spreadsheetId: 's9', title: 'Later' } };
    const out = await bodyRoundTrip([
      para(image, text('about that', [{ type: 'italic' }] as never)),
      embed,
    ]);
    expect(out[0].content?.[0]).toEqual(image);
    expect(out[0].content?.[1]).toEqual(text('about that', [{ type: 'italic' }] as never));
    expect(out[1]).toEqual(embed);
  });
});

describe('layout metadata survives a round trip', () => {
  it('page setup', async () => {
    const pageSetup = { pageSize: 'a4', orientation: 'landscape', marginTop: 90, marginBottom: 54, marginLeft: 108, marginRight: 36 } as const;
    const out = await roundTrip({ doc: { type: 'doc', content: [para(text('x'))] }, meta: baseMeta({ pageSetup }) });
    expect(out.meta.pageSetup).toEqual(pageSetup);
  });

  it('header and footer slots, with fields left as fields', async () => {
    const meta = baseMeta();
    meta.headerFooter.variants.default = {
      header: { left: 'Acme', center: 'Report', right: '{{date}}' },
      footer: { left: '', center: 'Page {{page}} of {{pages}}', right: 'v2' },
    };
    const out = await roundTrip({ doc: { type: 'doc', content: [para(text('x'))] }, meta });
    expect(out.meta.headerFooter.variants.default.header).toEqual({ left: 'Acme', center: 'Report', right: '{{date}}' });
    expect(out.meta.headerFooter.variants.default.footer).toEqual({ left: '', center: 'Page {{page}} of {{pages}}', right: 'v2' });
  });

  it('a different first page', async () => {
    const meta = baseMeta();
    meta.headerFooter.differentFirstPage = true;
    meta.headerFooter.variants.first = {
      header: { left: 'First', center: '', right: '' }, footer: { left: '', center: '', right: '' },
    };
    const out = await roundTrip({ doc: { type: 'doc', content: [para(text('x'))] }, meta });
    expect(out.meta.headerFooter.differentFirstPage).toBe(true);
    expect(out.meta.headerFooter.variants.first.header.left).toBe('First');
  });

  it('different odd and even pages', async () => {
    const meta = baseMeta();
    meta.headerFooter.differentEvenOdd = true;
    meta.headerFooter.variants.even = {
      header: { left: 'Even', center: '', right: '' },
      footer: { left: '', center: '', right: '' },
    };
    const out = await roundTrip({ doc: { type: 'doc', content: [para(text('x'))] }, meta });
    expect(out.meta.headerFooter.differentEvenOdd).toBe(true);
    expect(out.meta.headerFooter.variants.even.header.left).toBe('Even');
  });

  it('the header and footer margins', async () => {
    const meta = baseMeta();
    meta.headerFooter.headerMargin = 54;
    meta.headerFooter.footerMargin = 27;
    const out = await roundTrip({ doc: { type: 'doc', content: [para(text('x'))] }, meta });
    expect(out.meta.headerFooter.headerMargin).toBe(54);
    expect(out.meta.headerFooter.footerMargin).toBe(27);
  });

  it('a watermark', async () => {
    const out = await roundTrip({ doc: { type: 'doc', content: [para(text('x'))] }, meta: baseMeta({ watermarkText: 'CONFIDENTIAL' }) });
    expect(out.meta.watermarkText).toBe('CONFIDENTIAL');
  });

  it('background colour', async () => {
    const out = await roundTrip({ doc: { type: 'doc', content: [para(text('x'))] }, meta: baseMeta({ bgColor: '#fafafa' }) });
    expect(out.meta.bgColor).toBe('#fafafa');
  });

  it('the theme name', async () => {
    const out = await roundTrip({ doc: { type: 'doc', content: [para(text('x'))] }, meta: baseMeta({ docTheme: 'serif' as never }) });
    expect(out.meta.docTheme).toBe('serif');
  });

  it('document properties', async () => {
    const properties = { author: 'Ada', subject: 'Engines', company: '', category: 'Notes', keywords: 'a,b', manager: '', custom: {} };
    const out = await roundTrip({ doc: { type: 'doc', content: [para(text('x'))] }, meta: baseMeta({ properties }) });
    expect(out.meta.properties).toMatchObject({ author: 'Ada', subject: 'Engines', category: 'Notes', keywords: 'a,b' });
  });

  /**
   * `docProps/core.xml` has nowhere to put a company, a manager or anything
   * user-defined, so these go to `docProps/custom.xml` — which is also where a
   * `DOCPROPERTY` field looks, so a `{{custom:client}}` field resolves in Word.
   */
  it('company, manager and user-defined properties', async () => {
    const properties = {
      author: '', subject: '', category: '', keywords: '',
      company: 'Acme', manager: 'Grace', custom: { client: 'Initech', ref: 'R-42' },
    };
    const out = await roundTrip({ doc: { type: 'doc', content: [para(text('x'))] }, meta: baseMeta({ properties }) });
    expect(out.meta.properties).toEqual(properties);
  });

  /**
   * The `docx` package writes "Un-named" for a document with no `creator`. Read
   * back, that is an author nobody set, on every document created here.
   */
  it('a document with no author does not acquire one', async () => {
    const out = await roundTrip({ doc: { type: 'doc', content: [para(text('x'))] }, meta: baseMeta() });
    expect(out.meta.properties.author).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The whole thing at once
// ---------------------------------------------------------------------------

/**
 * Per-feature tests can all pass while the pair still loses data — a mapping
 * that only works when its feature is alone is not a mapping. This asserts
 * deep equality over a document carrying one of everything, which is the
 * property `read(write(m)) === m` in full.
 */
describe('a document with one of everything', () => {
  it('comes back deeply equal', async () => {
    const meta = baseMeta({
      watermarkText: 'DRAFT',
      bgColor: '#fdfdfd',
      docTheme: 'serif' as never,
      properties: { author: 'Ada', subject: 'Engines', company: '', category: 'Notes', keywords: 'a,b', manager: '', custom: {} },
      pageSetup: { pageSize: 'a4', orientation: 'landscape', marginTop: 90, marginBottom: 54, marginLeft: 108, marginRight: 36 },
    });
    meta.headerFooter.differentFirstPage = true;
    meta.headerFooter.variants.default = {
      header: { left: 'Acme', center: 'Report', right: '{{date}}' },
      footer: { left: '', center: 'Page {{page}} of {{pages}}', right: 'v2' },
    };
    meta.headerFooter.variants.first = {
      header: { left: 'Cover', center: '', right: '' },
      footer: { left: '', center: '', right: '' },
    };
    meta.headerText = 'Report';
    meta.footerText = 'Page {{page}} of {{pages}}';
    meta.showPageNumbers = true;

    const content: DocNode[] = [
      { type: 'heading', attrs: { level: 1 }, content: [text('Chapter One')] },
      { type: 'paragraph', attrs: { textAlign: 'center', indent: 2 }, content: [
        text('plain '),
        text('bold', [{ type: 'bold' }] as never),
        text(' and ', undefined),
        text('coloured', [{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: '18pt', fontFamily: 'Georgia' } }] as never),
        { type: 'footnote', attrs: { id: 'fn-1', text: 'A note.' } },
      ]},
      { type: 'bulletList', attrs: { listStyleType: 'square' }, content: [
        { type: 'listItem', content: [para(text('one'))] },
        { type: 'listItem', content: [para(text('two'))] },
      ]},
      { type: 'orderedList', attrs: { listStyleType: 'upper-roman' }, content: [
        { type: 'listItem', content: [para(text('first'))] },
      ]},
      { type: 'blockquote', content: [{ type: 'paragraph', attrs: {}, content: [text('quoted')] }] },
      { type: 'codeBlock', content: [text('const x = 1;')] },
      { type: 'table', content: [{ type: 'tableRow', content: [
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, backgroundColor: '#ddeeff', borderColor: null, borderWidth: null }, content: [para(text('cell'))] },
      ]}]},
      { type: 'tableOfContents' },
      { type: 'sectionBreak' },
      { type: 'paragraph', attrs: {}, content: [
        text('see it', [{ type: 'crossRef', attrs: { headingText: 'Chapter One' } }] as never),
        { type: 'docField', attrs: { code: 'page', arg: null, showCode: false } },
      ]},
      { type: 'sheetEmbed', attrs: { spreadsheetId: 's1', title: 'Q1' } },
    ];

    const out = await roundTrip({ doc: { type: 'doc', content }, meta });

    expect(out.doc.content).toEqual(content);
    expect(out.meta).toEqual(meta);
  });
});

// ---------------------------------------------------------------------------
// A document written by something else
// ---------------------------------------------------------------------------

/**
 * The parser has to read `.docx` files that know nothing of Neutrino's
 * conventions — no extras part, no `NeutrinoQuote` style, styles and constructs
 * it has never seen. The requirement there is not fidelity, which is
 * impossible, but that nothing is *lost*: an unrecognised construct degrades
 * to its text instead of vanishing, which is the failure mode that makes a
 * parser worse than no parser.
 */
describe('a .docx from elsewhere', () => {
  async function foreignDocx(): Promise<Uint8Array> {
    const d = await import('docx');
    const doc = new d.Document({
      sections: [{
        properties: { page: { size: { orientation: d.PageOrientation.LANDSCAPE, width: 15840, height: 12240 } } },
        children: [
          new d.Paragraph({ text: 'Foreign Title', heading: d.HeadingLevel.HEADING_1 }),
          new d.Paragraph({ children: [new d.TextRun({ text: 'body text', bold: true })] }),
          // A style this codebase never writes.
          new d.Paragraph({ style: 'IntenseQuote', children: [new d.TextRun('styled oddly')] }),
          new d.Table({ rows: [new d.TableRow({ children: [
            new d.TableCell({ children: [new d.Paragraph('c1')] }),
            new d.TableCell({ children: [new d.Paragraph('c2')] }),
          ]})]}),
        ],
      }],
    });
    return new Uint8Array(await d.Packer.toBuffer(doc));
  }

  it('reads its structure without an extras part', async () => {
    const { doc, meta } = await readDocx(await foreignDocx());
    const types = (doc.content ?? []).map((n) => n.type);
    expect(types).toContain('heading');
    expect(types).toContain('table');
    expect(meta.pageSetup.orientation).toBe('landscape');
    expect(meta.docTheme).toBe('default');
  });

  it('keeps the text of a paragraph whose style it does not know', async () => {
    const { doc } = await readDocx(await foreignDocx());
    const all = JSON.stringify(doc);
    expect(all).toContain('styled oddly');
    expect(all).toContain('Foreign Title');
    expect(all).toContain('c1');
    expect(all).toContain('c2');
  });

  it('keeps run formatting a foreign writer applied', async () => {
    const { doc } = await readDocx(await foreignDocx());
    const body = (doc.content ?? []).find((n) => n.content?.[0]?.text === 'body text');
    expect(body?.content?.[0].marks).toEqual([{ type: 'bold' }]);
  });
});
