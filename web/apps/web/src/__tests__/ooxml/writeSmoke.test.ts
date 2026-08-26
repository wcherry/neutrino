import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { writeDocx } from '@/lib/ooxml/docx/write';
import { DEFAULT_PAGE_SETUP } from '@neutrino/api-docs';

const meta = {
  headerFooter: {
    differentFirstPage: false, differentEvenOdd: false, headerMargin: 36, footerMargin: 36,
    variants: {
      default: { header: { left: 'Left', center: 'Mid', right: '{{page}}' }, footer: { left: '', center: 'Page {{page}} of {{pages}}', right: '' } },
      first: { header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' } },
      even: { header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' } },
    },
  },
  headerText: '', footerText: '', showPageNumbers: false,
  watermarkText: 'DRAFT', bgColor: '#fafafa', docTheme: 'default',
  properties: { author: 'Ada', subject: 'Subj', company: 'Co', category: 'Cat', keywords: 'k1', manager: 'M', custom: {} },
  pageSetup: { ...DEFAULT_PAGE_SETUP, orientation: 'landscape' as const, pageSize: 'a4' as const, marginTop: 90 },
} as never;

const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'paragraph', attrs: { indent: 2, textAlign: 'right' }, content: [
      { type: 'text', text: 'red big ', marks: [{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: '18pt', fontFamily: 'Georgia' } }, { type: 'bold' }] },
      { type: 'text', text: 'note', marks: [{ type: 'italic' }] },
      { type: 'footnote', attrs: { id: 'f1', text: 'The note body.' } },
    ]},
    { type: 'bulletList', attrs: { listStyleType: 'square' }, content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
    ]},
    { type: 'orderedList', attrs: { listStyleType: 'lower-roman' }, content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
    ]},
    { type: 'table', content: [
      { type: 'tableRow', content: [
        { type: 'tableCell', attrs: { backgroundColor: '#ddeeff', colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cell' }] }] },
      ]},
    ]},
    { type: 'paragraph', content: [
      { type: 'text', text: 'see above', marks: [{ type: 'crossRef', attrs: { headingText: 'Title' } }] },
      { type: 'image', attrs: { src: 'neutrino-drive:file-9', width: '320', shadow: 'md', caption: 'A caption', imageFilter: 'sepia' } },
      { type: 'sheetEmbed', attrs: { spreadsheetId: 's1', namedRangeId: 'r1', title: 'Q1' } },
    ]},
    { type: 'tableOfContents' },
    { type: 'sectionBreak' },
    { type: 'paragraph', content: [
      { type: 'text', text: 'linked', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
      { type: 'docField', attrs: { code: 'page', arg: null, showCode: false } },
      { type: 'text', text: 'ins', marks: [{ type: 'trackedInsertion', attrs: { author: 'Ada' } }] },
    ]},
  ],
} as never;

describe('writeDocx', () => {
  it('produces a package with the parts the model needs', async () => {
    const bytes = await writeDocx({ doc, meta }, { title: 'Probe' });
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    expect(names).toContain('word/document.xml');
    expect(names).toContain('word/footnotes.xml');
    expect(names).toContain('word/numbering.xml');
    expect(names.some((n) => /word\/header\d*\.xml/.test(n))).toBe(true);
    expect(names.some((n) => /word\/footer\d*\.xml/.test(n))).toBe(true);
    expect(names).toContain('customXml/item1.xml');

    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('w:sectPr');
    expect(xml).toContain('w:pgSz');
    expect(xml).toContain('landscape');
    expect(xml).toMatch(/PAGE|NUMPAGES/);
    expect(xml).toContain('w:ins');
    expect(xml).toContain('TOC');

    const fn = await zip.file('word/footnotes.xml')!.async('string');
    expect(fn).toContain('The note body.');

    const hdr = await zip.file(names.find((n) => /word\/header\d*\.xml/.test(n))!)!.async('string');
    expect(hdr).toContain('NeutrinoWatermark');

    // The extras part carries only what OOXML cannot: the Drive reference, the
    // presentational image attributes, the cross-reference target, the embed.
    const extras = JSON.parse(
      /<neutrino[^>]*>([\s\S]*)<\/neutrino>/.exec(await zip.file('customXml/item1.xml')!.async('string'))![1]
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
    );
    expect(extras.crossRefs[0]).toBe('Title');
    // The image has no resolved bytes here, so it goes out as a placeholder
    // carrying its whole attribute set — the same ordered channel the embed
    // uses, since neither is distinguishable from the other in the document.
    expect(extras.placeholders).toEqual([
      { kind: 'image', attrs: { src: 'neutrino-drive:file-9', width: '320', shadow: 'md', caption: 'A caption', imageFilter: 'sepia' } },
      { kind: 'sheetEmbed', attrs: { spreadsheetId: 's1', namedRangeId: 'r1', title: 'Q1' } },
    ]);

    // …and a REF field points at the bookmark the heading carries, so the
    // cross-reference resolves in Word too.
    expect(xml).toContain('REF _Nx0');
    expect(xml).toContain('w:bookmarkStart');
  });
});
