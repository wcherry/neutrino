/**
 * The `.docx` an import writes has to be one the editor opens (issue #169).
 *
 * This is about the `.html`/`.txt` half of the import — the only half that
 * writes a document rather than storing the exported `.docx` as it is. The
 * converted document goes through the real `writeDocx` and comes back through
 * the real `readDocx`, the pair `DocEditor` uses to store and open a document.
 * A converter that emitted a node the writer does not know would fail here and
 * nowhere else: `importDocs.test.ts` stands the writer in for the bytes because
 * what it tests is the sequencing, so the import would report every document as
 * imported and none of them would open.
 */

import { describe, it, expect } from 'vitest';

import { htmlToDocJson, textToDocJson } from '@/lib/takeout/docHtml';
import { writeDocx } from '@/lib/ooxml/docx/write';
import { readDocx } from '@/lib/ooxml/docx/read';
import type { DocModel, DocNode } from '@/lib/ooxml/docx/mapping';
import { DEFAULT_PAGE_SETUP } from '@neutrino/api-docs';
import { emptyDocProperties } from '@/lib/docFields';
import { defaultHeaderFooterConfig } from '@/lib/docHeaderFooter';

/** The same package `importDocs.ts` builds, read back. */
async function roundTrip(doc: DocNode): Promise<DocNode> {
  const model: DocModel = {
    doc,
    meta: {
      headerFooter: defaultHeaderFooterConfig(),
      headerText: '', footerText: '', showPageNumbers: false,
      watermarkText: '', bgColor: '', docTheme: 'default',
      properties: emptyDocProperties(),
      pageSetup: DEFAULT_PAGE_SETUP,
    },
  };
  const bytes = await writeDocx(model, { title: 'A' });
  return (await readDocx(bytes)).doc as DocNode;
}

/** Every text node in the document, in order. */
function texts(node: DocNode): string[] {
  if (node.type === 'text') return [node.text ?? ''];
  return (node.content ?? []).flatMap(texts);
}

describe('the .docx an import stores', () => {
  it('opens as the document that was converted', async () => {
    const converted = htmlToDocJson(
      '<h1>Quarterly plan</h1><p>Revenue is <strong>up</strong>.</p><ul><li>One</li><li>Two</li></ul>',
    ) as DocNode;

    const reopened = await roundTrip(converted);

    // Joined with nothing: a styled word is its own run, so "Revenue is " and
    // the bold "up" arrive as two of them.
    expect(texts(reopened).join('')).toContain('Quarterly plan');
    expect(texts(reopened).join('')).toContain('Revenue is up.');
    expect(texts(reopened)).toEqual(expect.arrayContaining(['One', 'Two']));
    expect(reopened.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
  });

  it('opens a plain-text export as its own lines', async () => {
    const reopened = await roundTrip(textToDocJson('one\ntwo') as DocNode);
    expect(texts(reopened)).toEqual(['one', 'two']);
  });
});
