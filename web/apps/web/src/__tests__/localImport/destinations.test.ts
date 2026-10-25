/**
 * Where each kind of file goes (`lib/localImport/destinations.ts`).
 *
 * The options are deliberately few and honest: every photo is a Drive file and
 * every Drive image is in Photos, so "Photos only" cannot be offered; a
 * `text/markdown` Drive file *is* a note, so Markdown into Drive is offered as
 * plain text. These pin both the menu and what each choice does to a file.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DESTINATIONS,
  DESTINATION_OPTIONS,
  KIND_LABELS,
  routeFiles,
  plannedBytes,
  type DestinationChoice,
} from '@/lib/localImport/destinations';
import type { LocalImportFile } from '@/lib/localImport/scan';
import type { ImportKind } from '@/lib/localImport/classify';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function local(path: string, kind: ImportKind, mimeType: string, size = 1): LocalImportFile {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { file: new File([new Uint8Array(size)], name, { type: mimeType }), path, kind, mimeType };
}

const photo = local('Trip/IMG_1.jpg', 'media', 'image/jpeg', 10);
const doc = local('Trip/report.docx', 'office', DOCX, 20);
const note = local('Trip/ideas.md', 'markdown', 'text/markdown', 30);
const pdf = local('Trip/paper.pdf', 'other', 'application/pdf', 40);
const all = [photo, doc, note, pdf];

describe('DEFAULT_DESTINATIONS', () => {
  it('sends each kind where it opens', () => {
    expect(DEFAULT_DESTINATIONS).toEqual({
      media: 'photos-drive',
      office: 'drive',
      markdown: 'notes',
      other: 'drive',
    });
  });

  it('only defaults to an option the kind offers', () => {
    for (const kind of Object.keys(DEFAULT_DESTINATIONS) as ImportKind[]) {
      expect(DESTINATION_OPTIONS[kind].map((o) => o.value)).toContain(DEFAULT_DESTINATIONS[kind]);
    }
  });
});

describe('DESTINATION_OPTIONS', () => {
  it('offers media Photos and Drive, or nothing', () => {
    expect(DESTINATION_OPTIONS.media).toEqual([
      { value: 'photos-drive', label: 'Photos and Drive' },
      { value: 'skip', label: "Don't import" },
    ]);
  });

  it('offers office files Drive, naming the editors that open them', () => {
    expect(DESTINATION_OPTIONS.office.map((o) => o.value)).toEqual(['drive', 'skip']);
    expect(DESTINATION_OPTIONS.office[0].label).toBe('Drive — opens in Docs, Sheets, Slides');
    expect(DESTINATION_OPTIONS.office[1].label).toBe("Don't import");
  });

  it('offers Markdown Notes, plain-text Drive files, or nothing', () => {
    expect(DESTINATION_OPTIONS.markdown).toEqual([
      { value: 'notes', label: 'Notes' },
      { value: 'drive-plain', label: 'Drive, as plain text files' },
      { value: 'skip', label: "Don't import" },
    ]);
  });

  it('offers everything else Drive, or nothing', () => {
    expect(DESTINATION_OPTIONS.other.map((o) => o.value)).toEqual(['drive', 'skip']);
    expect(DESTINATION_OPTIONS.other[0].label).toBe('Drive');
  });
});

describe('KIND_LABELS', () => {
  it('names each kind for the summary rows', () => {
    expect(KIND_LABELS).toEqual({
      media: 'Photos & videos',
      office: 'Word, Excel, PowerPoint',
      markdown: 'Markdown notes',
      other: 'Everything else',
    });
  });
});

describe('routeFiles', () => {
  it('routes every kind by the defaults', () => {
    const planned = routeFiles(all, DEFAULT_DESTINATIONS);
    expect(planned.map((p) => [p.source.path, p.product, p.mimeType])).toEqual([
      ['Trip/IMG_1.jpg', 'Photos', 'image/jpeg'],
      ['Trip/report.docx', 'Drive', DOCX],
      ['Trip/ideas.md', 'Notes', 'text/markdown'],
      ['Trip/paper.pdf', 'Drive', 'application/pdf'],
    ]);
  });

  it('keeps the source file on each planned file', () => {
    const [first] = routeFiles([photo], DEFAULT_DESTINATIONS);
    expect(first.source).toBe(photo);
  });

  it('uploads a .md as a Notes note with text/markdown, whatever the browser said', () => {
    const odd = local('x/odd.md', 'markdown', 'application/octet-stream');
    const [planned] = routeFiles([odd], DEFAULT_DESTINATIONS);
    expect(planned.product).toBe('Notes');
    expect(planned.mimeType).toBe('text/markdown');
  });

  it('sends Markdown to Drive as text/plain when chosen, so it is not a note', () => {
    const choice: DestinationChoice = { ...DEFAULT_DESTINATIONS, markdown: 'drive-plain' };
    const [planned] = routeFiles([note], choice);
    expect(planned.product).toBe('Drive');
    expect(planned.mimeType).toBe('text/plain');
  });

  it('leaves out every kind set to skip', () => {
    const choice: DestinationChoice = { media: 'skip', office: 'drive', markdown: 'skip', other: 'skip' };
    const planned = routeFiles(all, choice);
    expect(planned.map((p) => p.source.path)).toEqual(['Trip/report.docx']);
  });

  it('returns nothing when everything is skipped', () => {
    const choice: DestinationChoice = { media: 'skip', office: 'skip', markdown: 'skip', other: 'skip' };
    expect(routeFiles(all, choice)).toEqual([]);
  });
});

describe('plannedBytes', () => {
  it('sums the size of every planned file', () => {
    expect(plannedBytes(routeFiles(all, DEFAULT_DESTINATIONS))).toBe(100);
  });

  it('does not count skipped files', () => {
    const choice: DestinationChoice = { ...DEFAULT_DESTINATIONS, other: 'skip' };
    expect(plannedBytes(routeFiles(all, choice))).toBe(60);
  });

  it('is zero for nothing', () => {
    expect(plannedBytes([])).toBe(0);
  });
});
