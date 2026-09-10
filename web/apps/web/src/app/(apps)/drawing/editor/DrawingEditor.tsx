'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft } from 'lucide-react';
import { Spinner, useToast } from '@neutrino/ui';
import { drawingApi, extractDrawingText } from '@neutrino/api-drawing';
import { driveReadBytes, isMissingEncryptionKey } from '@neutrino/api-drive';
import { useUser } from '@neutrino/auth';

import { readStoredBody } from '@/lib/storedBody';
import { indexOnSave } from '@/lib/searchIndexUpdate';
import { useContentVersionGuard } from '@/hooks/useContentVersionGuard';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { ENCRYPTION_WARNING_MESSAGE } from '@/components/EncryptionWarningMessage';
import type { ImagePickerResult } from '@/components/InsertImageDialog';

import { createDocument, createRasterLayer, DEFAULT_VECTOR_STYLE } from './document/factory';
import { parseDocument, serializeDocument } from './document/serialize';
import {
  findNode,
  flattenTree,
  groupNodes,
  isDocumentEmpty,
  reorderWithinParent,
  ungroupNode,
} from './document/tree';
import {
  addNode,
  addObjects,
  cloneNode,
  deleteNode,
  duplicateNode,
  newGroup,
  offsetCopies,
  patchObjects,
  removeObjects,
  setGrid,
  setLayerObjects,
  setNodesProps,
  setTitle,
} from './document/edits';
import { loadDocumentBitmaps } from './render/renderDocument';
import { createCanvasRenderer, writeOra } from './io/ora';
import { DrawingCanvas, type DrawingCanvasHandle } from './DrawingCanvas';
import { DrawingToolbar } from './DrawingToolbar';
import { DrawingMenuBar } from './DrawingMenuBar';
import { StatusBar } from './StatusBar';
import { StylePanel } from './StylePanel';
import { LayersPanel } from './LayersPanel';
import { ExportDialog, type OraExportOptions, type PngExportOptions, type SvgExportOptions } from './ExportDialog';
import {
  selectionCount,
  type DrawingDocument,
  type DrawingNode,
  type Selection,
  type ToolType,
  type Transform,
  type VectorObject,
  type VectorStyle,
} from './types';
import styles from './page.module.css';

const VersionHistoryPanel = dynamic(
  () => import('@/components/VersionHistoryPanel').then((m) => ({ default: m.VersionHistoryPanel })),
  { ssr: false },
);

/**
 * Loaded on demand, like the version history panel.
 *
 * Not only for the bundle: the picker reaches Drive through `@/lib/api`, the
 * barrel that re-exports every `@neutrino/api-*` package, so importing it at
 * module scope pulls the whole API surface into the editor's graph for a dialog
 * most sessions never open.
 */
const InsertImageDialog = dynamic(
  () => import('@/components/InsertImageDialog').then((m) => ({ default: m.InsertImageDialog })),
  { ssr: false },
);

const AUTOSAVE_DELAY = 1000;
const HISTORY_DELAY = 500;
const HISTORY_LIMIT = 100;

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The stored drawing as text, and whether the server was holding it in the
 * clear — the body seeded at creation, or one saved before drawings were
 * encrypted.
 *
 * Which one it is comes off the bytes rather than off a session flag: a drawing
 * created and then reloaded before anything encrypted it has a key reference
 * *and* a plaintext body, and trusting the flag there means decrypting
 * plaintext, failing, and opening the drawing empty.
 */
interface StoredDrawing {
  raw: string;
  wasPlaintext: boolean;
  /**
   * The file held bytes that would not open with this key.
   *
   * Kept separate from an empty `raw`, and the distinction is the whole point:
   * a *zero-byte* file is a newly created drawing that the editor should seed
   * and save, while bytes that failed to decrypt are somebody's content that
   * saving would destroy. Collapsing the two — as returning `''` for both does
   * — means the first autosave writes a blank canvas over a drawing whose key
   * was merely unavailable.
   */
  unreadable: boolean;
}

async function readStoredDrawing(drawingId: string, dek: Uint8Array): Promise<StoredDrawing> {
  // `driveReadBytes`, not `storageApi.downloadFile`: a drawing is created with
  // no body at all (see `native_types.rs`), and the download endpoint answers a
  // row with no blob with 409 `NO_CONTENT` rather than with zero bytes. Reading
  // that as an error meant every newly created drawing opened on "Failed to
  // load drawing" — the same bug the OOXML editors had, which is what this
  // helper was written for. It still throws `CONTENT_MISSING`, so a row that
  // outlived its blob stays a real failure and not an empty canvas.
  const stored = await driveReadBytes(drawingId);
  if (stored.length === 0) return { raw: '', wasPlaintext: false, unreadable: false };

  try {
    const { text, wasPlaintext } = readStoredBody(stored, dek);
    return { raw: text, wasPlaintext, unreadable: false };
  } catch {
    return { raw: '', wasPlaintext: false, unreadable: true };
  }
}

/**
 * An image as pixels on the canvas.
 *
 * The picker hands back a URL — a Drive download, a remote link, or a data URL
 * for an encrypted file it already decrypted. A raster layer needs the bytes
 * themselves, so the image is decoded and re-encoded as a PNG data URL: the
 * document is one encrypted blob, and a layer pointing at a URL would be a
 * second thing to fetch, keep in step and lose.
 */
async function rasterSourceFromImage(
  src: string,
  canvas: { width: number; height: number },
): Promise<ReturnType<typeof createRasterLayer>['source'] | null> {
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image();
    element.crossOrigin = 'anonymous';
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = src;
  });
  if (!image || !image.naturalWidth || !image.naturalHeight) return null;

  // Fitted inside the canvas and centred, never enlarged — an image dropped in
  // at 4000px on a 1920px canvas should arrive usable, not mostly off-page.
  const scale = Math.min(1, canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const surface = document.createElement('canvas');
  surface.width = width;
  surface.height = height;
  const ctx = surface.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, width, height);

  return {
    dataUrl: surface.toDataURL('image/png'),
    width,
    height,
    x: Math.round((canvas.width - width) / 2),
    y: Math.round((canvas.height - height) / 2),
  };
}

type Clipboard =
  | { kind: 'objects'; objects: VectorObject[] }
  | { kind: 'nodes'; nodes: DrawingNode[] }
  | null;

export function DrawingEditor() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const drawingId = searchParams.get('id');
  const currentUser = useUser();
  const toast = useToast();
  const versionGuard = useContentVersionGuard();

  const { dekRef, dekResolved, awaitDek } = useEncryptedDocumentContent({
    id: drawingId ?? '',
    filename: 'drawing.json',
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitleState] = useState('Untitled drawing');
  const [doc, setDoc] = useState<DrawingDocument>(() => createDocument());
  const [selection, setSelection] = useState<Selection>(null);
  const [activeLayerId, setActiveLayerId] = useState('');
  const [tool, setTool] = useState<ToolType>('select');
  const [newObjectStyle, setNewObjectStyle] = useState<VectorStyle>({ ...DEFAULT_VECTOR_STYLE });
  const [bitmaps, setBitmaps] = useState<ReadonlyMap<string, CanvasImageSource>>(new Map());
  const [zoom, setZoom] = useState(100);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [clipboard, setClipboard] = useState<Clipboard>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const docRef = useRef(doc);
  const selectionRef = useRef(selection);
  const activeLayerRef = useRef(activeLayerId);
  const clipboardRef = useRef(clipboard);
  docRef.current = doc;
  selectionRef.current = selection;
  activeLayerRef.current = activeLayerId;
  clipboardRef.current = clipboard;

  // ── History ───────────────────────────────────────────────────────
  //
  // Snapshots of the whole document. The tree is persistent — every edit
  // rewrites only the path to the node it touched — so a snapshot shares almost
  // all of its structure with the one before it, and the cost is a pointer per
  // step rather than a copy of the drawing.
  const historyRef = useRef<DrawingDocument[]>([]);
  const historyIndexRef = useRef(-1);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipHistoryRef = useRef(false);

  const pushHistory = useCallback((next: DrawingDocument) => {
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      historyTimerRef.current = null;
      const trimmed = historyRef.current.slice(0, historyIndexRef.current + 1);
      trimmed.push(next);
      // A long session should not grow without bound; the oldest steps go first.
      const overflow = Math.max(0, trimmed.length - HISTORY_LIMIT);
      historyRef.current = trimmed.slice(overflow);
      historyIndexRef.current = historyRef.current.length - 1;
      setCanUndo(historyIndexRef.current > 0);
      setCanRedo(false);
    }, HISTORY_DELAY);
  }, []);

  const isDirtyRef = useRef(false);

  /** The single entry point for changing the drawing. */
  const applyDocument = useCallback((next: DrawingDocument) => {
    setDoc((prev) => {
      if (next === prev) return prev;
      isDirtyRef.current = true;
      if (skipHistoryRef.current) skipHistoryRef.current = false;
      else pushHistory(next);
      return next;
    });
  }, [pushHistory]);

  const restore = useCallback((step: number) => {
    // A pending debounced snapshot would land after the restore and re-push the
    // state being undone, so it is flushed into history first.
    if (historyTimerRef.current) {
      clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
      historyRef.current = [...historyRef.current.slice(0, historyIndexRef.current + 1), docRef.current];
      historyIndexRef.current = historyRef.current.length - 1;
    }
    const index = historyIndexRef.current + step;
    if (index < 0 || index >= historyRef.current.length) return;
    historyIndexRef.current = index;
    skipHistoryRef.current = true;
    isDirtyRef.current = true;
    setDoc(historyRef.current[index]);
    setSelection(null);
    setCanUndo(index > 0);
    setCanRedo(index < historyRef.current.length - 1);
  }, []);

  const handleUndo = useCallback(() => restore(-1), [restore]);
  const handleRedo = useCallback(() => restore(1), [restore]);

  // ── Load ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!drawingId) {
      setError('No drawing ID provided');
      setLoading(false);
      return;
    }
    if (!dekResolved) return;

    let cancelled = false;

    async function load() {
      try {
        const drawing = await drawingApi.getDrawing(drawingId!);
        if (cancelled) return;
        setTitleState(drawing.title);
        versionGuard.observe(drawing.contentVersion);

        const { raw, wasPlaintext, unreadable } = dekRef.current
          ? await readStoredDrawing(drawingId!, dekRef.current)
          : { raw: '', wasPlaintext: false, unreadable: false };
        if (cancelled) return;

        // Bytes this key cannot open. Nothing is rendered and nothing is
        // written: opening a blank canvas here would let the first autosave
        // replace a drawing whose key is merely unavailable — a locked vault,
        // a rotated key, a file shared before it was resealed.
        if (unreadable) {
          setError('This drawing could not be decrypted. Unlock your encryption key and reload.');
          return;
        }

        // Seal it: nothing else will. Autosave only fires on an edit, so a
        // drawing opened and closed untouched would keep its plaintext body.
        if (wasPlaintext && raw && dekRef.current) {
          drawingApi
            .autosaveEncryptedContent(
              drawingId!, raw, 'drawing.json', dekRef.current, { title: drawing.title },
              versionGuard.check(),
            )
            .then((meta) => versionGuard.observe(meta.contentVersion))
            .catch(() => {});
        }

        const stored = parseDocument(raw);

        // Bytes that are not a drawing this build understands. They are still
        // somebody's bytes: opening a blank canvas over them would let the very
        // next autosave overwrite the file, and a body that failed to decrypt
        // looks exactly like this. So the editor refuses rather than opens —
        // the same rule the diagrams canvas applies to a foreign SVG.
        if (!stored && raw) {
          setError('This file is not a drawing this version can open.');
          return;
        }

        // A newly created drawing is a zero-byte file: the server writes no seed
        // (see `native_types.rs`), so the first body is this one, and it has to
        // be written even if nothing is drawn — otherwise the drawing has no
        // content at all until somebody happens to touch it.
        const loaded = stored ?? createDocument({ title: drawing.title });
        if (!stored) isDirtyRef.current = true;
        historyRef.current = [loaded];
        historyIndexRef.current = 0;
        setCanUndo(false);
        setCanRedo(false);
        setDoc(loaded);

        const firstVectorLayer = flattenTree(loaded.root).find((f) => f.node.type === 'vector');
        setActiveLayerId(firstVectorLayer?.node.id ?? '');
      } catch {
        if (!cancelled) setError('Failed to load drawing');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingId, dekResolved]);

  // Raster layers and masks hold PNG data URLs; decoding is asynchronous while
  // painting a frame is not, so they are decoded here and handed to the canvas.
  useEffect(() => {
    let cancelled = false;
    loadDocumentBitmaps(doc).then((next) => {
      if (!cancelled) setBitmaps(next);
    });
    return () => { cancelled = true; };
  }, [doc]);

  // ── Autosave ──────────────────────────────────────────────────────

  const saveInProgress = useRef(false);

  /**
   * Everything the save needs that is not part of *what* is being saved.
   *
   * These are read through a ref rather than listed as dependencies because
   * several of them — `awaitDek`, `versionGuard`, `toast` — are rebuilt on
   * every render. Depending on them re-runs the effect whenever anything at all
   * re-renders, and since the effect's cleanup clears the pending timer, the
   * save is pushed a further second into the future each time. The history
   * debounce alone (a `setCanUndo` half a second after every edit) is enough to
   * do it, and on a canvas that re-renders as the pointer moves the save would
   * never land at all.
   */
  const saveDepsRef = useRef({ awaitDek, versionGuard, toast, userId: currentUser?.id });
  saveDepsRef.current = { awaitDek, versionGuard, toast, userId: currentUser?.id };

  useEffect(() => {
    if (loading || !drawingId || !isDirtyRef.current) return;

    const timer = setTimeout(() => {
      if (saveInProgress.current || !isDirtyRef.current) return;
      isDirtyRef.current = false;
      saveInProgress.current = true;

      const { awaitDek: resolveDek, versionGuard: guard, toast: notify, userId } = saveDepsRef.current;
      const body = serializeDocument(setTitle(docRef.current, title));

      // `awaitDek`, not `dekRef.current`: the first autosave after a reload
      // routinely lands while the key is still resolving, and reading the ref
      // there reports "no key" for a drawing that has one.
      resolveDek()
        .then((dek) => {
          if (!dek) throw new Error('no-dek');
          return drawingApi.autosaveEncryptedContent(
            drawingId, body, 'drawing.json', dek, { title }, guard.check(),
          );
        })
        .then((meta) => {
          guard.observe(meta.contentVersion);
          indexOnSave(userId, {
            id: drawingId,
            type: 'drawing',
            title,
            content: extractDrawingText(body),
          });
        })
        .catch((err) => {
          if (isMissingEncryptionKey(err)) {
            notify.warning(ENCRYPTION_WARNING_MESSAGE);
            return;
          }
          if (guard.handleError(err)) {
            notify.warning(
              'This document changed elsewhere since you opened it. Reload to get the ' +
              'latest version, or save again to keep your copy.',
            );
          }
        })
        .finally(() => { saveInProgress.current = false; });
    }, AUTOSAVE_DELAY);

    return () => clearTimeout(timer);
  }, [doc, title, drawingId, loading]);

  // ── Selection-derived actions ─────────────────────────────────────

  const selectedNodes = useMemo(
    () => (selection?.kind === 'nodes'
      ? selection.ids.map((id) => findNode(doc.root, id)).filter((n): n is DrawingNode => n !== null)
      : []),
    [doc.root, selection],
  );

  const canGroup = selectedNodes.length > 1;
  const canUngroup = selectedNodes.length === 1 && selectedNodes[0].type === 'stack';

  const handleDelete = useCallback(() => {
    const current = selectionRef.current;
    if (!current) return;
    if (current.kind === 'objects') {
      applyDocument(removeObjects(docRef.current, current.layerId, current.ids));
    } else {
      let next = docRef.current;
      for (const id of current.ids) next = deleteNode(next, id);
      applyDocument(next);
    }
    setSelection(null);
  }, [applyDocument]);

  const handleDuplicate = useCallback(() => {
    const current = selectionRef.current;
    const document_ = docRef.current;
    if (!current) return;

    if (current.kind === 'objects') {
      const layer = findNode(document_.root, current.layerId);
      if (layer?.type !== 'vector') return;
      const copies = offsetCopies(layer.objects.filter((o) => current.ids.includes(o.id)));
      applyDocument(addObjects(document_, current.layerId, copies));
      setSelection({ kind: 'objects', layerId: current.layerId, ids: copies.map((c) => c.id) });
      return;
    }

    let next = document_;
    const ids: string[] = [];
    for (const id of current.ids) {
      const result = duplicateNode(next, id);
      next = result.doc;
      if (result.newId) ids.push(result.newId);
    }
    applyDocument(next);
    if (ids.length) setSelection({ kind: 'nodes', ids });
  }, [applyDocument]);

  const handleCopy = useCallback(() => {
    const current = selectionRef.current;
    const document_ = docRef.current;
    if (!current) return;
    if (current.kind === 'objects') {
      const layer = findNode(document_.root, current.layerId);
      if (layer?.type !== 'vector') return;
      setClipboard({ kind: 'objects', objects: layer.objects.filter((o) => current.ids.includes(o.id)) });
      return;
    }
    setClipboard({
      kind: 'nodes',
      nodes: current.ids.map((id) => findNode(document_.root, id)).filter((n): n is DrawingNode => n !== null),
    });
  }, []);

  const handleCut = useCallback(() => {
    handleCopy();
    handleDelete();
  }, [handleCopy, handleDelete]);

  const handlePaste = useCallback(() => {
    const board = clipboardRef.current;
    const document_ = docRef.current;
    if (!board) return;

    if (board.kind === 'objects') {
      const layerId = activeLayerRef.current;
      const layer = findNode(document_.root, layerId);
      if (layer?.type !== 'vector') return;
      const copies = offsetCopies(board.objects);
      applyDocument(addObjects(document_, layerId, copies));
      setSelection({ kind: 'objects', layerId, ids: copies.map((c) => c.id) });
      return;
    }

    // Cloned rather than inserted as-is: the clipboard holds the nodes that
    // were copied, and pasting twice must not put the same ids in the tree
    // twice — nor must cutting and pasting resurrect a node the delete removed.
    let next = document_;
    const ids: string[] = [];
    for (const node of board.nodes) {
      const copy = cloneNode(node);
      next = addNode(next, copy);
      ids.push(copy.id);
    }
    applyDocument(next);
    if (ids.length) setSelection({ kind: 'nodes', ids });
  }, [applyDocument]);

  const handleSelectAll = useCallback(() => {
    const document_ = docRef.current;
    const layer = findNode(document_.root, activeLayerRef.current);
    if (layer?.type === 'vector' && layer.objects.length > 0) {
      setSelection({ kind: 'objects', layerId: layer.id, ids: layer.objects.map((o) => o.id) });
      return;
    }
    const ids = document_.root.children.map((c) => c.id);
    setSelection(ids.length ? { kind: 'nodes', ids } : null);
  }, []);

  const handleToggleLock = useCallback(() => {
    const current = selectionRef.current;
    const document_ = docRef.current;
    if (!current) return;
    if (current.kind === 'objects') {
      const layer = findNode(document_.root, current.layerId);
      if (layer?.type !== 'vector') return;
      const anyLocked = layer.objects.some((o) => current.ids.includes(o.id) && o.locked);
      applyDocument(patchObjects(document_, current.layerId, current.ids, { locked: !anyLocked }));
      return;
    }
    const anyLocked = current.ids.some((id) => findNode(document_.root, id)?.locked);
    applyDocument(setNodesProps(document_, current.ids, { locked: !anyLocked }));
  }, [applyDocument]);

  const handleGroup = useCallback(() => {
    const current = selectionRef.current;
    if (current?.kind !== 'nodes' || current.ids.length < 2) return;
    const group = newGroup();
    applyDocument({ ...docRef.current, root: groupNodes(docRef.current.root, current.ids, group) });
    setSelection({ kind: 'nodes', ids: [group.id] });
  }, [applyDocument]);

  const handleUngroup = useCallback(() => {
    const current = selectionRef.current;
    if (current?.kind !== 'nodes' || current.ids.length !== 1) return;
    const group = findNode(docRef.current.root, current.ids[0]);
    if (group?.type !== 'stack') return;
    const childIds = group.children.map((c) => c.id);
    applyDocument({ ...docRef.current, root: ungroupNode(docRef.current.root, group.id) });
    setSelection(childIds.length ? { kind: 'nodes', ids: childIds } : null);
  }, [applyDocument]);

  /**
   * Reordering means two different things depending on what is selected: a
   * layer moves within its parent stack, and an object moves within its layer.
   * `delta` is negative for "forward", because index 0 is the top.
   */
  const reorder = useCallback((delta: number) => {
    const current = selectionRef.current;
    const document_ = docRef.current;
    if (!current) return;

    if (current.kind === 'nodes') {
      let next = document_;
      for (const id of current.ids) {
        next = { ...next, root: reorderWithinParent(next.root, id, delta) };
      }
      applyDocument(next);
      return;
    }

    const layer = findNode(document_.root, current.layerId);
    if (layer?.type !== 'vector') return;
    const objects = [...layer.objects];
    const indices = current.ids
      .map((id) => objects.findIndex((o) => o.id === id))
      .filter((i) => i >= 0)
      .sort((a, b) => (delta < 0 ? a - b : b - a));
    for (const from of indices) {
      const to = Math.max(0, Math.min(objects.length - 1, from + delta));
      if (to === from) continue;
      const [moved] = objects.splice(from, 1);
      objects.splice(to, 0, moved);
    }
    applyDocument(setLayerObjects(document_, layer.id, objects));
  }, [applyDocument]);

  // ── Keyboard ──────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.metaKey || e.ctrlKey;

      if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        handleDelete();
        return;
      }
      if (!mod) {
        const shortcuts: Record<string, ToolType> = {
          s: 'select', p: 'pen', l: 'line', r: 'rectangle', e: 'ellipse', t: 'text',
        };
        const next = shortcuts[e.key.toLowerCase()];
        if (next) {
          setTool(next);
          return;
        }
      }
      if (!mod) return;

      switch (e.key.toLowerCase()) {
        case 'z':
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
          break;
        case 'y':
          e.preventDefault();
          handleRedo();
          break;
        case 'a': e.preventDefault(); handleSelectAll(); break;
        case 'c': e.preventDefault(); handleCopy(); break;
        case 'x': e.preventDefault(); handleCut(); break;
        case 'v': e.preventDefault(); handlePaste(); break;
        case 'd': e.preventDefault(); handleDuplicate(); break;
        case 'g':
          e.preventDefault();
          if (e.shiftKey) handleUngroup();
          else handleGroup();
          break;
        case ']': e.preventDefault(); reorder(-1); break;
        case '[': e.preventDefault(); reorder(1); break;
        case "'":
          e.preventDefault();
          applyDocument(setGrid(docRef.current, { visible: !docRef.current.grid.visible }));
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    applyDocument, handleCopy, handleCut, handleDelete, handleDuplicate, handleGroup,
    handlePaste, handleRedo, handleSelectAll, handleUndo, handleUngroup, reorder,
  ]);

  // ── Viewport ──────────────────────────────────────────────────────

  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });

  const handleTransformChange = useCallback((t: Transform) => {
    transformRef.current = t;
    setZoom(Math.round(t.scale * 100));
  }, []);

  const handleZoomChange = useCallback((percent: number) => {
    const next = { ...transformRef.current, scale: percent / 100 };
    canvasRef.current?.setTransform(next);
  }, []);

  const handleFitToScreen = useCallback(() => canvasRef.current?.fitToScreen(), []);
  const handleZoomIn = useCallback(() => handleZoomChange(Math.min(1600, Math.round(zoom / 0.9))), [handleZoomChange, zoom]);
  const handleZoomOut = useCallback(() => handleZoomChange(Math.max(5, Math.round(zoom * 0.9))), [handleZoomChange, zoom]);

  // ── Images ────────────────────────────────────────────────────────

  const handleInsertImage = useCallback(async (result: ImagePickerResult) => {
    setShowImagePicker(false);
    const source = await rasterSourceFromImage(result.src, docRef.current.canvas);
    if (!source) {
      toast.error('That image could not be read.');
      return;
    }
    const layer = createRasterLayer(source, result.name ?? 'Image');
    applyDocument(addNode(docRef.current, layer));
    setSelection({ kind: 'nodes', ids: [layer.id] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyDocument]);

  // ── Export ────────────────────────────────────────────────────────

  const handleExportPNG = useCallback(async (options: PngExportOptions) => {
    const blob = await canvasRef.current?.exportPNG({ scale: options.scale, background: options.background });
    if (blob) triggerDownload(blob, `${options.filename || 'drawing'}.png`);
  }, []);

  const handleExportSVG = useCallback((options: SvgExportOptions) => {
    const svg = canvasRef.current?.exportSVG({ background: options.background });
    if (svg) triggerDownload(new Blob([svg], { type: 'image/svg+xml' }), `${options.filename || 'drawing'}.svg`);
  }, []);

  const handleExportORA = useCallback(async (options: OraExportOptions) => {
    try {
      const renderer = createCanvasRenderer(docRef.current, {
        bitmaps,
        background: options.background,
      });
      const blob = await writeOra(docRef.current, renderer);
      triggerDownload(blob, `${options.filename || 'drawing'}.ora`);
    } catch {
      toast.error('That drawing could not be exported as OpenRaster.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bitmaps]);

  // ── Title ─────────────────────────────────────────────────────────

  const handleTitleBlur = useCallback(() => {
    if (!drawingId || !title.trim()) return;
    drawingApi.saveDrawing(drawingId, { title }).catch(() => {});
    applyDocument(setTitle(docRef.current, title.trim()));
  }, [applyDocument, drawingId, title]);

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
        <p style={{ color: '#6b7280' }}>{error}</p>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)' }}>
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => router.back()} aria-label="Go back">
          <ArrowLeft size={18} />
        </button>
        <DrawingMenuBar
          tool={tool}
          onToolChange={setTool}
          selectedCount={selectionCount(selection)}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          onSelectAll={handleSelectAll}
          onCut={handleCut}
          onCopy={handleCopy}
          onPaste={handlePaste}
          hasClipboard={clipboard !== null}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={() => handleZoomChange(100)}
          onFitToScreen={handleFitToScreen}
          onToggleLock={handleToggleLock}
          onExport={() => setShowExport(true)}
          onVersionHistory={() => setShowVersionHistory(true)}
          onAddImage={() => setShowImagePicker(true)}
          onGroup={handleGroup}
          onUngroup={handleUngroup}
          canGroup={canGroup}
          canUngroup={canUngroup}
          onBringForward={() => reorder(-1)}
          onSendBackward={() => reorder(1)}
          showGrid={doc.grid.visible}
          onToggleGrid={() => applyDocument(setGrid(doc, { visible: !doc.grid.visible }))}
          titleInputRef={titleInputRef}
        />
        <input
          ref={titleInputRef}
          className={styles.titleInput}
          value={title}
          onChange={(e) => setTitleState(e.target.value)}
          onBlur={handleTitleBlur}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          aria-label="Drawing title"
        />
      </div>

      <div className={styles.editorBody}>
        <DrawingToolbar tool={tool} onToolChange={setTool} onAddImage={() => setShowImagePicker(true)} />
        <LayersPanel
          doc={doc}
          onDocumentChange={applyDocument}
          selection={selection}
          onSelectionChange={setSelection}
          activeLayerId={activeLayerId}
          onActiveLayerChange={setActiveLayerId}
          onAddImageLayer={() => setShowImagePicker(true)}
        />
        <div className={styles.canvasArea}>
          <DrawingCanvas
            ref={canvasRef}
            doc={doc}
            onDocumentChange={applyDocument}
            tool={tool}
            onToolChange={setTool}
            selection={selection}
            onSelectionChange={setSelection}
            activeLayerId={activeLayerId}
            newObjectStyle={newObjectStyle}
            onTransformChange={handleTransformChange}
            bitmaps={bitmaps}
          />
        </div>
        <StylePanel
          doc={doc}
          onDocumentChange={applyDocument}
          selection={selection}
          newObjectStyle={newObjectStyle}
          onNewObjectStyleChange={setNewObjectStyle}
        />
        {showVersionHistory && drawingId && (
          <div className={styles.versionHistoryPanel}>
            <VersionHistoryPanel
              fileId={drawingId}
              onClose={() => setShowVersionHistory(false)}
              onRestore={() => {
                setShowVersionHistory(false);
                window.location.reload();
              }}
            />
          </div>
        )}
      </div>

      <StatusBar
        zoom={zoom}
        onZoomChange={handleZoomChange}
        onFitToScreen={handleFitToScreen}
        canvasSize={`${doc.canvas.width} × ${doc.canvas.height}`}
        empty={isDocumentEmpty(doc)}
      />

      {showExport && (
        <ExportDialog
          doc={doc}
          onClose={() => setShowExport(false)}
          onExportPNG={handleExportPNG}
          onExportSVG={handleExportSVG}
          onExportORA={handleExportORA}
        />
      )}

      {showImagePicker && (
        <InsertImageDialog
          onInsert={handleInsertImage}
          onClose={() => setShowImagePicker(false)}
          title="Insert image layer"
          confirmLabel="Add layer"
        />
      )}
    </div>
  );
}
