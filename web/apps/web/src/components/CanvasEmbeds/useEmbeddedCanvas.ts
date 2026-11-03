'use client';

/**
 * Loading a diagram or a drawing to show inside another document.
 *
 * Both are E2EE like every document, so an embed reads the file with its own
 * key — the same sequence the preview modal uses — and a document embedding a
 * file the viewer cannot open shows an error in that spot rather than failing
 * the whole document. Docs and Slides share these so the two cannot drift: the
 * slide diagram element used to fetch the body as plaintext, and every
 * encrypted diagram on a slide drew as an empty box.
 */

import { useEffect, useState } from 'react';
import { diagramsApi } from '@neutrino/api-diagrams';
import { driveReadBytes } from '@neutrino/api-drive';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { readStoredBody } from '@/lib/storedBody';
import { encryptionApi, openFileKey } from '@/lib/api';
import { currentUserId } from '@/lib/driveImages';
import type { DiagramDocument, DiagramPage } from '@/app/(apps)/diagrams/types';
import type { DrawingDocument } from '@/app/(apps)/drawing/editor/document/types';

/**
 * The drawing engine, loaded on first use. A document or deck with no drawing in
 * it should not pay for the compositor, filters and adjustments in its first
 * load — Docs and Slides each have a route budget, and the engine alone broke both.
 */
async function readDrawing(text: string): Promise<EmbeddedDrawing | null> {
  const [{ parseDocument }, { loadDocumentBitmaps }] = await Promise.all([
    import('@/app/(apps)/drawing/editor/document/serialize'),
    import('@/app/(apps)/drawing/editor/render/renderDocument'),
  ]);
  const doc = parseDocument(text);
  return doc ? { doc, bitmaps: await loadDocumentBitmaps(doc) } : null;
}

type Loaded<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: T };

/** Bytes as text, decrypting when the key is there and the bytes are ciphertext. */
async function readText(fileId: string, dek: Uint8Array | null): Promise<string> {
  const stored = await driveReadBytes(fileId);
  if (stored.length === 0) return '';
  return readStoredBody(stored, dek ?? new Uint8Array(32)).text;
}

/**
 * A file's key outside React — the same lookup `useEncryptedDocumentContent`
 * makes, for callers with no component to hold a hook (the PDF export). Null
 * for a plaintext file; a key that cannot be opened is an error.
 */
async function fileKey(fileId: string): Promise<Uint8Array | null> {
  const ref = await encryptionApi.getFileKey(fileId);
  if (!ref) return null;
  const userId = currentUserId();
  if (!userId) throw new Error('Not signed in');
  return openFileKey(userId, fileId, ref);
}

/** One diagram page, decrypted — the non-hook form of `useEmbeddedDiagramPage`. */
export async function loadDiagramPage(diagramId: string, pageIndex: number): Promise<DiagramPage | null> {
  const doc = await diagramFromBody(await readText(diagramId, await fileKey(diagramId)));
  return doc?.pages[pageIndex] ?? doc?.pages[0] ?? null;
}

/** A drawing with its bitmaps decoded — the non-hook form of `useEmbeddedDrawing`. */
export async function loadDrawing(drawingId: string): Promise<EmbeddedDrawing | null> {
  return readDrawing(await readText(drawingId, await fileKey(drawingId)));
}

/** One page of a diagram — the page an embed shows. */
export function useEmbeddedDiagramPage(diagramId: string | null, pageIndex: number): Loaded<DiagramPage> {
  const { dekRef, dekResolved } = useEncryptedDocumentContent({ id: diagramId ?? '', filename: 'diagram.json' });
  const [state, setState] = useState<Loaded<DiagramPage>>({ status: 'loading' });

  useEffect(() => {
    if (!diagramId || !dekResolved) return;
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      // The metadata read is what turns "no access" into an error here rather than a 403
      // from the content read, and what an SVG-stored diagram's mime type would come from.
      await diagramsApi.getDiagram(diagramId);
      const raw = await readText(diagramId, dekRef.current);
      const doc = await diagramFromBody(raw);
      const page = doc?.pages[pageIndex] ?? doc?.pages[0] ?? null;
      if (cancelled) return;
      setState(page ? { status: 'ready', value: page } : { status: 'error', message: 'Could not load diagram' });
    })().catch(() => {
      if (!cancelled) setState({ status: 'error', message: 'Could not load diagram' });
    });
    return () => { cancelled = true; };
  }, [diagramId, pageIndex, dekResolved, dekRef]);

  return state;
}

/** A diagram body in either stored format: the native JSON, or an SVG carrying it. */
async function diagramFromBody(raw: string): Promise<DiagramDocument | null> {
  const text = raw.trimStart();
  if (text.startsWith('<')) {
    const { parseSvgDiagram } = await import('@/app/(apps)/diagrams/editor/io/svgFormat');
    return parseSvgDiagram(text);
  }
  try {
    const doc = JSON.parse(text) as DiagramDocument;
    return Array.isArray(doc?.pages) ? doc : null;
  } catch {
    return null;
  }
}

export interface EmbeddedDrawing {
  doc: DrawingDocument;
  bitmaps: ReadonlyMap<string, CanvasImageSource>;
}

/** A whole drawing with its raster layers decoded, ready to render. */
export function useEmbeddedDrawing(drawingId: string | null): Loaded<EmbeddedDrawing> {
  const { dekRef, dekResolved } = useEncryptedDocumentContent({ id: drawingId ?? '', filename: 'drawing.json' });
  const [state, setState] = useState<Loaded<EmbeddedDrawing>>({ status: 'loading' });

  useEffect(() => {
    if (!drawingId || !dekResolved) return;
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      const drawing = await readDrawing(await readText(drawingId, dekRef.current));
      if (!drawing) throw new Error('unreadable');
      if (!cancelled) setState({ status: 'ready', value: drawing });
    })().catch(() => {
      if (!cancelled) setState({ status: 'error', message: 'Could not load drawing' });
    });
    return () => { cancelled = true; };
  }, [drawingId, dekResolved, dekRef]);

  return state;
}
