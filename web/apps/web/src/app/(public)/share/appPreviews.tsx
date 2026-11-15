'use client';

/**
 * Previews of the app's own file types on a folder link (#321): Word documents, spreadsheets,
 * presentations, notes, diagrams and drawings.
 *
 * Each reads the decrypted bytes with the reader its editor uses and draws them with the view
 * Drive's preview uses (`DocumentPreviewModal/previewViews`), so a file looks the same wherever it
 * is previewed. Imported only when one of these files is opened: the readers pull in the OOXML
 * layer, the formula engine and the drawing renderer, none of which the share page needs to list
 * a folder.
 */

import React from 'react';
import { bodyTextFromStored } from '@/lib/documentContent';
import {
  DiagramView,
  DocView,
  DrawingView,
  NoteView,
  SheetView,
  SlideView,
} from '@/components/DocumentPreviewModal/previewViews';
import type { SlidePresentation } from '@/app/(apps)/slides/editor/slideEditorTypes';

export type AppKind = 'doc' | 'sheet' | 'slide' | 'note' | 'diagram' | 'drawing';

/** Which app opens a file, by MIME type first and then by name. */
export function appKindOf(mimeType: string, name: string): AppKind | null {
  const mime = mimeType.toLowerCase();
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (mime.includes('wordprocessingml') || ext === 'docx' || ext === 'dotx') return 'doc';
  if (mime.includes('spreadsheetml') || ext === 'xlsx' || ext === 'xltx') return 'sheet';
  if (mime.includes('presentationml') || ext === 'pptx' || ext === 'potx') return 'slide';
  if (mime === 'text/markdown' || ext === 'md' || ext === 'markdown') return 'note';
  if (mime === 'application/x-neutrino-diagram') return 'diagram';
  if (mime === 'application/x-neutrino-drawing') return 'drawing';
  return null;
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** The preview for one file of the app's own types. Throws when the file cannot be read. */
export async function renderAppPreview(
  kind: AppKind,
  bytes: Uint8Array,
  name: string,
): Promise<React.ReactElement> {
  switch (kind) {
    case 'doc':
      return <DocView content={await bodyTextFromStored(bytes, 'docs')} />;
    case 'sheet':
      return <SheetView content={await bodyTextFromStored(bytes, 'sheets')} />;
    case 'slide': {
      // A deck saved before decks were plain `.pptx` carries the editor's model; every other one is
      // read the way the Slides editor opens a `.pptx`.
      const model = await bodyTextFromStored(bytes, 'slides');
      let presentation: SlidePresentation | null = null;
      if (model) {
        try {
          presentation = JSON.parse(model) as SlidePresentation;
        } catch {
          presentation = null;
        }
      }
      if (!presentation) {
        const { importFromPptx } = await import('@/app/(apps)/slides/editor/pptxImport');
        presentation = await importFromPptx(
          new File([bytes.buffer as ArrayBuffer], name, {
            type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          }),
        );
      }
      return <SlideView presentation={presentation} />;
    }
    case 'note':
      return <NoteView content={decode(bytes)} />;
    case 'diagram':
      return <DiagramView content={decode(bytes)} />;
    case 'drawing':
      return <DrawingView content={decode(bytes)} />;
  }
}
