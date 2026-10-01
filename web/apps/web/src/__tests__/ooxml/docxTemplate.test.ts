/**
 * Word templates are the same package as a document (issue #128).
 *
 * What makes a `.dotx` one is a single content type in `[Content_Types].xml`,
 * and Word checks it against the extension — so the rewrite has to land, has
 * to be reversible, and must not disturb anything the parser reads.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { DEFAULT_PAGE_SETUP } from '@neutrino/api-docs';
import { writeDocx } from '@/lib/ooxml/docx/write';
import { readDocx } from '@/lib/ooxml/docx/read';
import { readDocxPackageKind, setDocxPackageKind } from '@/lib/ooxml/docx/packageKind';
import type { DocModel } from '@/lib/ooxml/docx/mapping';
import type { LayoutMeta } from '@/lib/docBody';

const TEMPLATE_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml';
const DOCUMENT_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

function model(text: string): DocModel {
  return {
    doc: { type: 'doc', content: [{ type: 'paragraph', attrs: {}, content: [{ type: 'text', text }] }] },
    meta: {
      headerFooter: {
        differentFirstPage: false, differentEvenOdd: false, headerMargin: 36, footerMargin: 36,
        variants: {
          default: { header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: 'Footer' } },
          first: { header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' } },
          even: { header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' } },
        },
      },
      headerText: '', footerText: '', showPageNumbers: false,
      watermarkText: '', bgColor: '', docTheme: 'default',
      properties: { author: '', subject: '', company: '', category: '', keywords: '', manager: '', custom: {} },
      pageSetup: { ...DEFAULT_PAGE_SETUP, orientation: 'landscape' },
    } as LayoutMeta,
  };
}

async function contentTypes(pkg: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(pkg);
  return zip.file('[Content_Types].xml')!.async('string');
}

describe('setDocxPackageKind', () => {
  it('declares the main part a template', async () => {
    const docx = await writeDocx(model('Dear customer'), { title: 'Letter' });
    expect(await readDocxPackageKind(docx)).toBe('document');

    const dotx = await setDocxPackageKind(docx, 'template');
    expect(await readDocxPackageKind(dotx)).toBe('template');
    const xml = await contentTypes(dotx);
    expect(xml).toContain(TEMPLATE_MAIN);
    expect(xml).not.toContain(DOCUMENT_MAIN);
  });

  it('leaves everything the parser reads untouched', async () => {
    const docx = await writeDocx(model('Dear customer'), { title: 'Letter' });
    const fromDocx = await readDocx(docx);
    const fromDotx = await readDocx(await setDocxPackageKind(docx, 'template'));
    expect(fromDotx).toEqual(fromDocx);
  });

  it('turns a template back into a document', async () => {
    const dotx = await setDocxPackageKind(
      await writeDocx(model('x'), { title: 'T' }),
      'template',
    );
    const docx = await setDocxPackageKind(dotx, 'document');
    expect(await readDocxPackageKind(docx)).toBe('document');
    expect(await contentTypes(docx)).toContain(DOCUMENT_MAIN);
  });

  it('returns the same bytes when the package already says so', async () => {
    // The autosave path calls this on every save of a template; re-zipping
    // an unchanged package would be a full deflate for nothing.
    const docx = await writeDocx(model('x'), { title: 'T' });
    expect(await setDocxPackageKind(docx, 'document')).toBe(docx);
  });

  it('refuses something that is not a Word package', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    const notDocx = await zip.generateAsync({ type: 'uint8array' });
    await expect(setDocxPackageKind(notDocx, 'template')).rejects.toThrow('not-a-docx');
    expect(await readDocxPackageKind(notDocx)).toBeNull();
  });
});
