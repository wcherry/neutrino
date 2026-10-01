/**
 * Mime types and file naming for the OOXML formats (issue #127).
 *
 * The extension lives on the Drive file's *name* so a download opens on a
 * double-click, and comes back off for the title the UI shows. Getting either
 * direction wrong is quiet: a document called "Report.docx" everywhere, or a
 * Word file saved as "Report" that nothing on the user's machine recognises.
 */

import { describe, it, expect } from 'vitest';
import {
  OOXML_MIME,
  OOXML_TEMPLATE_MIME,
  isOoxmlTemplateMime,
  ooxmlTemplateMimeFor,
  ooxmlMimeFor,
  ooxmlAppForMime,
  isOoxmlMime,
  withOoxmlExtension,
  stripOoxmlExtension,
} from '@neutrino/api-core';

describe('ooxmlMimeFor / ooxmlAppForMime', () => {
  it.each([
    ['docs', OOXML_MIME.docx],
    ['sheets', OOXML_MIME.xlsx],
    ['slides', OOXML_MIME.pptx],
  ] as const)('round-trips %s through its mime type', (app, mime) => {
    expect(ooxmlMimeFor(app)).toBe(mime);
    expect(ooxmlAppForMime(mime)).toBe(app);
  });

  it('does not claim a mime type it does not own', () => {
    expect(ooxmlAppForMime('application/pdf')).toBeNull();
    expect(ooxmlAppForMime('')).toBeNull();
  });

  it('never matches the legacy binary Office formats', () => {
    // Nothing in the browser can parse these, so a file that claims to be one
    // must stay a download rather than opening into an editor.
    expect(isOoxmlMime('application/msword')).toBe(false);
    expect(isOoxmlMime('application/vnd.ms-excel')).toBe(false);
    expect(isOoxmlMime('application/vnd.ms-powerpoint')).toBe(false);
  });
});

describe('withOoxmlExtension', () => {
  it.each([
    ['docs', 'Report', 'Report.docx'],
    ['sheets', 'Budget', 'Budget.xlsx'],
    ['slides', 'Kickoff', 'Kickoff.pptx'],
  ] as const)('adds the %s extension', (app, title, expected) => {
    expect(withOoxmlExtension(title, app)).toBe(expected);
  });

  it('does not double up on a name that already has it', () => {
    // Renames pass through here every time, so this is the common path, not an
    // edge case: without it a document gains a suffix per rename.
    expect(withOoxmlExtension('Report.docx', 'docs')).toBe('Report.docx');
  });

  it('matches the extension case-insensitively', () => {
    expect(withOoxmlExtension('REPORT.DOCX', 'docs')).toBe('REPORT.DOCX');
  });

  it('leaves an unrelated extension in place and appends after it', () => {
    expect(withOoxmlExtension('Q3.report', 'docs')).toBe('Q3.report.docx');
  });
});

describe('stripOoxmlExtension', () => {
  it.each([
    ['Report.docx', 'Report'],
    ['Budget.xlsx', 'Budget'],
    ['Kickoff.pptx', 'Kickoff'],
    ['REPORT.DOCX', 'REPORT'],
  ])('takes the extension off %s', (name, expected) => {
    expect(stripOoxmlExtension(name)).toBe(expected);
  });

  it('leaves a name with no extension alone', () => {
    expect(stripOoxmlExtension('Untitled document')).toBe('Untitled document');
  });

  it('leaves an extension that is not one of ours alone', () => {
    // A document genuinely called "Q3.report" keeps its name, and so does a
    // legacy .doc — which is a different file the editors never write.
    expect(stripOoxmlExtension('Q3.report')).toBe('Q3.report');
    expect(stripOoxmlExtension('legacy.doc')).toBe('legacy.doc');
  });

  it('survives a round trip with withOoxmlExtension', () => {
    expect(stripOoxmlExtension(withOoxmlExtension('Q1 plan', 'sheets'))).toBe('Q1 plan');
  });
});

/**
 * Word templates (issue #128). A template is the same package as a document
 * and opens in the same editor; the name and the mime type are what keep it a
 * template, so both directions are pinned here.
 */
describe('Word templates', () => {
  it('opens in Docs', () => {
    expect(ooxmlAppForMime(OOXML_TEMPLATE_MIME.dotx)).toBe('docs');
    expect(isOoxmlMime(OOXML_TEMPLATE_MIME.dotx)).toBe(true);
  });

  it('is told apart from a document', () => {
    expect(isOoxmlTemplateMime(OOXML_TEMPLATE_MIME.dotx)).toBe(true);
    expect(isOoxmlTemplateMime(OOXML_MIME.docx)).toBe(false);
    expect(ooxmlTemplateMimeFor('docs')).toBe(OOXML_TEMPLATE_MIME.dotx);
  });

  it('has no template type for the editors that cannot keep one yet', () => {
    // An entry here before the editor preserves the template content type on
    // save would turn every template into a document on its first autosave.
    expect(ooxmlTemplateMimeFor('sheets')).toBeNull();
    expect(ooxmlTemplateMimeFor('slides')).toBeNull();
  });

  it('is named with .dotx, and only when asked', () => {
    expect(withOoxmlExtension('Letterhead', 'docs', { template: true })).toBe('Letterhead.dotx');
    expect(withOoxmlExtension('Letterhead.dotx', 'docs', { template: true })).toBe('Letterhead.dotx');
    expect(withOoxmlExtension('Letterhead', 'docs')).toBe('Letterhead.docx');
  });

  it('falls back to the document extension for an app with no template type', () => {
    expect(withOoxmlExtension('Budget', 'sheets', { template: true })).toBe('Budget.xlsx');
  });

  it('has its extension taken off for the title', () => {
    expect(stripOoxmlExtension('Letterhead.dotx')).toBe('Letterhead');
    expect(stripOoxmlExtension(withOoxmlExtension('Memo', 'docs', { template: true }))).toBe('Memo');
  });
});

describe('isTemplateFile', () => {
  it('knows a template by its mime type or, failing that, its name', async () => {
    const { isTemplateFile } = await import('@/lib/officeFormats');
    expect(isTemplateFile(OOXML_TEMPLATE_MIME.dotx, 'Letterhead.dotx')).toBe(true);
    // What a browser that does not know the extension reports for an upload.
    expect(isTemplateFile('application/octet-stream', 'Letterhead.dotx')).toBe(true);
    expect(isTemplateFile(OOXML_MIME.docx, 'Report.docx')).toBe(false);
  });
});
