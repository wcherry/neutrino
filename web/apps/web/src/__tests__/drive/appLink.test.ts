/**
 * Unit tests for the web half of the Neutrino Universal Link format
 * (`/open/<kind>/<file id>`).
 *
 * These links are minted by three separately shipped iOS apps (`NeutrinoAppLink.swift`) and routed
 * by `static/apple-app-site-association`. A `kind` that stops resolving here is a link that opens
 * an error page for every recipient who does not have the app — and nothing else in the codebase
 * would notice.
 */

import { describe, it, expect } from 'vitest';
import {
  APP_LINK_KINDS,
  MIME_FOR_KIND,
  drivePreviewHref,
  hrefForKind,
  hrefForMime,
  isAppLinkKind,
} from '../../app/(apps)/open/appLink';

describe('isAppLinkKind', () => {
  it('accepts every kind the apps mint', () => {
    for (const kind of APP_LINK_KINDS) {
      expect(isAppLinkKind(kind)).toBe(true);
    }
  });

  it('rejects an unknown kind', () => {
    expect(isAppLinkKind('spreadsheet')).toBe(false);
    expect(isAppLinkKind('')).toBe(false);
  });
});

describe('MIME_FOR_KIND', () => {
  /** The MIME types the backend actually writes — see `src/notes/service.rs` and friends. */
  it('matches the types the server stores', () => {
    expect(MIME_FOR_KIND.note).toBe('application/x-neutrino-note');
    expect(MIME_FOR_KIND.doc).toBe('application/x-neutrino-doc');
    expect(MIME_FOR_KIND.sheet).toBe('application/x-neutrino-sheet');
    expect(MIME_FOR_KIND.slide).toBe('application/x-neutrino-slide');
    expect(MIME_FOR_KIND.diagram).toBe('application/x-neutrino-diagram');
    expect(MIME_FOR_KIND.drawing).toBe('application/x-neutrino-drawing');
  });

  it('covers every kind except file', () => {
    const covered = Object.keys(MIME_FOR_KIND).sort();
    const expected = APP_LINK_KINDS.filter((k) => k !== 'file').slice().sort();
    expect(covered).toEqual(expected);
  });
});

describe('hrefForKind', () => {
  it('routes each editable kind to its editor', () => {
    expect(hrefForKind('note', 'f1')).toBe('/notes/editor?id=f1');
    expect(hrefForKind('doc', 'f1')).toBe('/docs/editor?id=f1');
    expect(hrefForKind('sheet', 'f1')).toBe('/sheets/editor?id=f1');
    expect(hrefForKind('slide', 'f1')).toBe('/slides/editor?id=f1');
    expect(hrefForKind('diagram', 'f1')).toBe('/diagrams/editor?id=f1');
    expect(hrefForKind('drawing', 'f1')).toBe('/drawing/editor?id=f1');
  });

  /** `file` carries no format, so only the server can say where it goes. */
  it('defers on the generic file kind', () => {
    expect(hrefForKind('file', 'f1')).toBeNull();
  });

  it('resolves every non-file kind to somewhere', () => {
    for (const kind of APP_LINK_KINDS) {
      if (kind === 'file') continue;
      expect(hrefForKind(kind, 'f1')).toBeTruthy();
    }
  });
});

describe('hrefForMime', () => {
  it('routes a native type to its editor', () => {
    expect(hrefForMime('f1', 'application/x-neutrino-doc')).toBe('/docs/editor?id=f1');
  });

  it('routes an image to the photo editor', () => {
    expect(hrefForMime('f1', 'image/jpeg')).toBe('/photos/editor?fileId=f1');
  });

  /**
   * The point of the preview parameter: a PDF has no editor, and landing the recipient on an
   * unfiltered listing would lose the file the link named.
   */
  it('previews a file that has no editor, rather than dropping the id', () => {
    expect(hrefForMime('f1', 'application/pdf')).toBe('/drive?preview=f1');
  });

  it('escapes the id it puts in the query', () => {
    expect(hrefForMime('a b&c', 'application/pdf')).toBe('/drive?preview=a%20b%26c');
  });
});

describe('drivePreviewHref', () => {
  it('addresses the drive listing with a preview open', () => {
    expect(drivePreviewHref('f1')).toBe('/drive?preview=f1');
  });
});
