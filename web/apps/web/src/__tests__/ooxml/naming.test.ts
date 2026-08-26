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
    expect(ooxmlAppForMime('application/x-neutrino-doc')).toBeNull();
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
