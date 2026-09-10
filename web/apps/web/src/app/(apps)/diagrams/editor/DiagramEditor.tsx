'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ExportFormat, RasterSize } from './io/ExportDialog';
import { RASTER_SIZE_SCALE } from './io/ExportDialog';
import { exportPNGCropped, exportJPEGCropped, exportSVGCropped, triggerDownload, withDiagramSource } from './io/exportUtils';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Spinner, useToast, Modal, ModalHeader, ModalBody, ModalFooter, Button } from '@neutrino/ui';
import {
  diagramsApi,
  extractDiagramText,
  DIAGRAM_CONTENT_FILENAME,
  type DiagramFormat,
} from '@neutrino/api-diagrams';
import { authApi, useUser } from '@neutrino/auth';
import { readStoredBody } from '@/lib/storedBody';
import { storageApi, encryptionApi, type FileItem } from '@/lib/api';
import { ShareDialog } from '@/app/(apps)/drive/ShareDialog';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { indexOnSave } from '@/lib/searchIndexUpdate';
import { useContentVersionGuard } from '@/hooks/useContentVersionGuard';
import { useDiagramEditor } from './hooks/useDiagramEditor';
import { useDiagramCollab } from './hooks/useDiagramCollab';
import { DiagramCanvas } from './DiagramCanvas';
import { DiagramToolbar } from './DiagramToolbar';
import { ShapePanel } from './ShapePanel';
import { PropertiesPanel } from './PropertiesPanel';
import { PagePanel } from './PagePanel';
import { CommentsPanel } from './collab/CommentsPanel';
import { DataPanel } from './data/DataPanel';
import { ExportDialog } from './io/ExportDialog';
import { ImportDialog } from './io/ImportDialog';
import {
  diagramDocumentToSvg,
  looksLikeSvg,
  parseSvgDiagram,
  svgAsImageDocument,
  svgDataUrl,
  svgPictureIndex,
  type SvgBackedDocument,
} from './io/svgFormat';
import { resolveFillImages } from './utils/fillImages';
import { SaveAsDialog, type SaveAsOptions } from '@/components/SaveAsDialog';
import { MermaidPanel } from './developer/MermaidPanel';
import { AiDiagramPanel } from './ai/AiDiagramPanel';
import { ENCRYPTION_WARNING_MESSAGE } from '@/components/EncryptionWarningMessage';
import type { DiagramDocument, EditorSelection, SelectionMode, FreehandStroke, DiagramShape, DiagramConnector } from '../types';
import type { LayoutAlgorithm } from './layout/layoutEngine';
import styles from './DiagramEditor.module.css';
import { useAccessRevocation } from '@/hooks/useAccessRevocation';

// ---------------------------------------------------------------------------
// Empty diagram document
// ---------------------------------------------------------------------------

function makeEmptyDocument(): DiagramDocument {
  return {
    version: 1,
    pages: [
      {
        id: 'page-1',
        name: 'Page 1',
        shapes: [],
        connectors: [],
        gridEnabled: true,
        gridSize: 20,
        snapEnabled: true,
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

/**
 * A stored body as a document, in either format.
 *
 * An SVG body is one this editor wrote, so its embedded source is the document;
 * an SVG *without* one is not something to guess at here — the file is
 * somebody's picture and this editor is about to save over it, so it opens
 * blank rather than as an import. Dropping a foreign SVG onto the canvas
 * through the Import dialog is the path that turns one into a diagram.
 */
function parseDocument(raw: string): DiagramDocument {
  if (looksLikeSvg(raw)) return parseSvgDiagram(raw) ?? makeEmptyDocument();
  try {
    const parsed = JSON.parse(raw) as DiagramDocument;
    if (!parsed.pages || !Array.isArray(parsed.pages)) {
      return makeEmptyDocument();
    }
    return parsed;
  } catch {
    return makeEmptyDocument();
  }
}

/**
 * The bytes to store for a document, in the format the file is held in.
 *
 * An SVG document is one canvas, so its picture is the page that was open when
 * it was saved, recorded as `svgPageIndex` so reopening the file lands back on
 * it. Every page is in the embedded source either way — the choice is only
 * about what a reader outside Neutrino sees.
 *
 * Image fills are resolved to data URLs so the file stands alone: an
 * `<image href>` pointing at a Drive object is a hole in every renderer outside
 * this app, and outside this app is the reason to save as SVG at all.
 * `resolveFillImages` caches per session, so this is one fetch per image rather
 * than one per save.
 */
async function serializeDocument(
  doc: DiagramDocument,
  format: DiagramFormat,
  activePageIndex: number,
): Promise<string> {
  if (format !== 'svg') return JSON.stringify(doc, null, 0);
  const backed: SvgBackedDocument = { ...doc, svgPageIndex: activePageIndex };
  const page = backed.pages[svgPictureIndex(backed)];
  const images = await resolveFillImages(page?.shapes ?? []);
  return diagramDocumentToSvg(backed, { images });
}

// ---------------------------------------------------------------------------
// Export region selection overlay
// ---------------------------------------------------------------------------

interface ExportRegionOverlayProps {
  onRegionSelected: (rect: { x: number; y: number; width: number; height: number }) => void;
  onCancel: () => void;
}

function ExportRegionOverlay({ onRegionSelected, onCancel }: ExportRegionOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [selRect, setSelRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const getPos = (e: React.MouseEvent) => {
    const el = overlayRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    dragStart.current = getPos(e);
    setSelRect(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const pos = getPos(e);
    setSelRect({
      x: Math.min(dragStart.current.x, pos.x),
      y: Math.min(dragStart.current.y, pos.y),
      width: Math.abs(pos.x - dragStart.current.x),
      height: Math.abs(pos.y - dragStart.current.y),
    });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const pos = getPos(e);
    const rect = {
      x: Math.min(dragStart.current.x, pos.x),
      y: Math.min(dragStart.current.y, pos.y),
      width: Math.abs(pos.x - dragStart.current.x),
      height: Math.abs(pos.y - dragStart.current.y),
    };
    dragStart.current = null;
    if (rect.width > 4 && rect.height > 4) {
      onRegionSelected(rect);
    }
  };

  return (
    <div
      ref={overlayRef}
      className={styles.exportOverlay}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div className={styles.exportOverlayHint}>
        Draw a rectangle to define the export area · Esc to cancel
      </div>
      {selRect && selRect.width > 0 && selRect.height > 0 && (
        <div
          className={styles.exportSelectionRect}
          style={{ left: selRect.x, top: selRect.y, width: selRect.width, height: selRect.height }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DiagramEditor() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const diagramId = searchParams.get('id') ?? '';
  useAccessRevocation(diagramId);
  const queryClient = useQueryClient();
  const currentUser = useUser();

  const [selection, setSelection] = useState<EditorSelection>({
    shapeIds: new Set(),
    connectorIds: new Set(),
  });
  const [mode, setMode] = useState<SelectionMode>('select');
  const [showComments, setShowComments] = useState(false);
  const [showData, setShowData] = useState(false);
  const [showDeveloper, setShowDeveloper] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [pendingExport, setPendingExport] = useState<{ format: ExportFormat; filename: string; size: RasterSize; showGrid: boolean; bgColor: string } | null>(null);
  const [presentationMode, setPresentationMode] = useState(false);
  const [drawColor, setDrawColor] = useState('#1e293b');
  const [textDefaults, setTextDefaults] = useState({ fontSize: 14, fontFamily: 'Inter', textColor: '#111827' });
  const [title, setTitle] = useState('Untitled diagram');
  const [titleEditing, setTitleEditing] = useState(false);
  /**
   * Which format the open file is stored in. Set from its mime type on load and
   * never changed after: saving must write back what the file already is, or a
   * `.svg` in Drive would quietly start holding JSON.
   */
  const [format, setFormat] = useState<DiagramFormat>('diagram');
  const [saveAsFormat, setSaveAsFormat] = useState<DiagramFormat | null>(null);
  /**
   * The markup of an SVG that this editor did not write, when that is what the
   * open file turned out to be. Set means "do not write to this file" — see the
   * load below and the guards on autosave.
   */
  const [foreignSvg, setForeignSvg] = useState<string | null>(null);
  // The same fact where the save mutation can read it. `mutationFn` closes over
  // the render that created it, and a save can be in flight before the state
  // update from the load has re-rendered — which is exactly the save that must
  // not land, so the ref is written by the load itself rather than by a render.
  const foreignSvgRef = useRef<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  const { dekRef, dekResolved, isNewEncryption } = useEncryptedDocumentContent({
    id: diagramId,
    filename: DIAGRAM_CONTENT_FILENAME[format],
  });
  const toast = useToast();
  // Rejects a save that would overwrite a revision written elsewhere since this
  // diagram was loaded. See `useContentVersionGuard`.
  const versionGuard = useContentVersionGuard();

  // Load auth token for collab WebSocket
  useEffect(() => {
    const stored = localStorage.getItem('access_token');
    if (stored) setAuthToken(stored);
    authApi.getProfile().then((p) => setUserName(p.name)).catch(() => {});
  }, []);

  // ── Editor state ───────────────────────────────────────────────────────────

  const editor = useDiagramEditor(makeEmptyDocument());

  // ── Remote collaboration ───────────────────────────────────────────────────

  const collab = useDiagramCollab({
    diagramId,
    userName,
    authToken,
    enabled: !!diagramId,
    onRemoteDocument: useCallback((doc: DiagramDocument) => {
      editor.setDocument(doc);
    }, [editor]),
  });

  // ── Load diagram from server ───────────────────────────────────────────────

  // Set by the read below when the server turns out to be holding this diagram
  // in the clear; cleared by the effect that writes it back encrypted.
  const sealPlaintextRef = useRef(false);

  // Opening another diagram is a navigation, not a remount — `/diagrams/editor`
  // is one route and only the `id` changes — so everything the last file left
  // behind has to be cleared by hand. Missing this is not cosmetic: `foreignSvg`
  // set from the previous file would show its refusal screen over the new
  // diagram and its ref would block every save to it, which is exactly the path
  // "Create a diagram from this image" takes.
  useEffect(() => {
    foreignSvgRef.current = null;
    setForeignSvg(null);
    setFormat('diagram');
    sealPlaintextRef.current = false;
  }, [diagramId]);

  const { isLoading: contentLoading } = useQuery({
    queryKey: ['diagram', diagramId, dekResolved],
    queryFn: async () => {
      // Cleared here too, and not only in the effect above: an effect runs after
      // the render that scheduled it, and this can be in flight by then.
      foreignSvgRef.current = null;
      const diagram = await diagramsApi.getDiagram(diagramId);
      setTitle(diagram.title);
      setFormat(diagram.format);
      versionGuard.observe(diagram.contentVersion);
      if (diagram.contentUrl) {
        try {
          let raw: string;
          if (dekRef.current) {
            const blob = await storageApi.downloadFile(diagramId);
            const stored = new Uint8Array(await blob.arrayBuffer());
            // Plaintext-or-ciphertext is decided from the bytes rather than from
            // `isNewEncryption` — see `readStoredBody`. A diagram created and
            // then reloaded before anything encrypted it has a key ref and a
            // plaintext body, and the session flag calls that ciphertext. Bytes
            // that neither decrypt nor look like a diagram throw out of here,
            // into the catch below that leaves the canvas empty.
            //
            // An SVG-stored diagram is not JSON, so the plaintext test has to
            // know that — otherwise an unencrypted `.svg` reads as ciphertext
            // that failed to open and the file appears empty.
            const read = readStoredBody(
              stored,
              dekRef.current,
              diagram.format === 'svg' ? looksLikeSvg : undefined,
            );
            raw = read.text;
            if (read.wasPlaintext) sealPlaintextRef.current = true;
          } else {
            // Read token directly from storage — the authToken state may still be
            // null on first render since it's set by an async useEffect.
            const token = localStorage.getItem('access_token') ?? '';
            const res = await fetch(diagram.contentUrl, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return diagram;
            raw = await res.text();
          }
          // An SVG with no diagram inside it is somebody's picture, not a
          // document this editor owns — a logo, an icon, an export from another
          // tool. Opening it as a blank canvas would be the last thing that ever
          // happened to it: the seal below, or the first autosave, would write
          // an empty diagram over the file. So the editor refuses it and offers
          // to build a new diagram around it instead (`foreignSvg`).
          //
          // A *zero-byte* SVG is not that: it is a file this editor created and
          // has not written a body to yet, and it opens blank as it should.
          if (diagram.format === 'svg' && raw!.trim() && !parseSvgDiagram(raw!)) {
            sealPlaintextRef.current = false;
            foreignSvgRef.current = raw!;
            setForeignSvg(raw!);
            return diagram;
          }
          const doc = parseDocument(raw!);
          editor.setDocument(doc);
          // An SVG shows one page, and that is the page to reopen on — the
          // file's picture and the editor's canvas then agree.
          if (diagram.format === 'svg') {
            editor.setActivePage(svgPictureIndex(doc as SvgBackedDocument));
          }
        } catch {
          // Use empty document on fetch failure
        }
      }
      return diagram;
    },
    enabled: !!diagramId && dekResolved,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // The read above is gated on `dekResolved`, and React Query reports a query
  // it has not started as "not loading" — so without counting that the canvas
  // was interactive before the diagram it is about to show had been read, and
  // `editor.setDocument` then replaced whatever had been drawn in the meantime.
  // A page added in that window simply vanished.
  const isLoading = contentLoading || (!!diagramId && !dekResolved);

  // ── Save / autosave ────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!diagramId) return null;
      // The one write this component makes to the open file, so this is where
      // "never overwrite an SVG we did not author" is enforced — not only in
      // the callers, which are three effects and two buttons.
      if (foreignSvgRef.current) return null;
      if (!dekRef.current) throw new Error('no-dek');
      const content = await serializeDocument(editor.document, format, editor.activePageIndex);
      const meta = await diagramsApi.autosaveEncryptedContent(
        diagramId,
        content,
        DIAGRAM_CONTENT_FILENAME[format],
        dekRef.current,
        { title },
        versionGuard.check(),
      );
      return { content, contentVersion: meta.contentVersion };
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['diagrams'] });
      if (!saved) return;
      const { content } = saved;
      versionGuard.observe(saved.contentVersion);
      indexOnSave(currentUser?.id, {
        id: diagramId,
        type: 'diagram',
        title,
        content: extractDiagramText(content),
      });
    },
    onError: (err) => {
      if (err instanceof Error && err.message === 'no-dek') {
        toast.warning(ENCRYPTION_WARNING_MESSAGE);
        return;
      }
      if (versionGuard.handleError(err)) {
        toast.warning(
          'This document changed elsewhere since you opened it. Reload to get the ' +
            'latest version, or save again to keep your copy.',
        );
      }
    },
  });

  // ── Save a copy, in either format ──────────────────────────────────────────
  //
  // A copy rather than a conversion: the open file keeps the format it is
  // stored in. Turning a `.svg` into a native diagram in place would rewrite a
  // file other things may be pointing at — a README, a shared link, an <img>
  // somewhere — and there is no route back from a mime type once the link is
  // broken. Saving beside it leaves both.

  const handleSaveAs = useCallback(
    async (target: DiagramFormat, opts: SaveAsOptions) => {
      const extension = target === 'svg' ? '.svg' : '.json';
      const filename = opts.filename.endsWith(extension)
        ? opts.filename
        : `${opts.filename}${extension}`;
      const content = await serializeDocument(editor.document, target, editor.activePageIndex);

      if (opts.location === 'local') {
        triggerDownload(
          new Blob([content], {
            type: target === 'svg' ? 'image/svg+xml' : 'application/json',
          }),
          filename,
        );
        setSaveAsFormat(null);
        return;
      }

      // A copy is a new file, so it gets a key of its own rather than the open
      // file's — sharing a DEK between two files means revoking one revokes
      // both. Minted and registered here, and not left to the copy's own editor
      // to mint on first open (which is how `Duplicate` does it), because
      // nothing navigates to it: the body is written now or never.
      const { initSodium, loadKeyPair, generateFileKey, encryptFileKey, activeKeyVersion } =
        await import('@neutrino/e2e-crypto');
      await initSodium();
      const keyPair = currentUser?.id ? loadKeyPair(currentUser.id) : null;
      if (!keyPair || !currentUser?.id) {
        // Writing it in the clear is not the fallback: a copy of an encrypted
        // diagram is still the diagram.
        toast.warning(ENCRYPTION_WARNING_MESSAGE);
        return;
      }

      const copy = await diagramsApi.createDiagram({
        title: filename,
        folderId: opts.folderId ?? null,
        format: target,
      });
      const dek = generateFileKey();
      await encryptionApi.setFileKey(copy.id, {
        encryptedFileKey: encryptFileKey(dek, keyPair.publicKey),
        keyVersion: activeKeyVersion(currentUser.id) ?? undefined,
      });
      // `createDiagram` seeds a native file with a blank page and an SVG one
      // with nothing at all, so the real body is this write either way — and it
      // goes through the encrypted path, which is the only one that can seal it.
      await diagramsApi.autosaveEncryptedContent(
        copy.id,
        content,
        DIAGRAM_CONTENT_FILENAME[target],
        dek,
        { title: filename },
      );
      queryClient.invalidateQueries({ queryKey: ['diagrams'] });
      indexOnSave(currentUser?.id, {
        id: copy.id,
        type: 'diagram',
        title: filename,
        content: extractDiagramText(content),
      });
      setSaveAsFormat(null);
      toast.success(`Saved “${filename}” to Drive`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor.document, editor.activePageIndex, currentUser?.id, queryClient],
  );

  // ── A foreign SVG: build a diagram around it rather than over it ───────────

  const traceSvgMutation = useMutation({
    mutationFn: async () => {
      if (!foreignSvg) return null;
      const created = await diagramsApi.createDiagram({ title: `${title} (Diagram)` });
      // Seeded through sessionStorage, exactly as `Duplicate` and the template
      // picker do it: the new diagram's own editor writes the first body, which
      // is the only path that encrypts it.
      try {
        sessionStorage.setItem(
          `neutrino:diagram-template:${created.id}`,
          JSON.stringify(svgAsImageDocument(foreignSvg)),
        );
      } catch {
        // sessionStorage unavailable — the diagram still opens, just blank
      }
      return created;
    },
    onSuccess: (created) => {
      if (created) router.push(`/diagrams/editor?id=${created.id}`);
    },
    onError: () => toast.error('Failed to create a diagram from this image'),
  });

  // ── Main menu: back / new / duplicate / delete ──────────────────────────────

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleBack = useCallback(async () => {
    try {
      await saveMutation.mutateAsync();
    } finally {
      router.push('/diagrams');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const handleNewDiagram = useCallback(() => {
    router.push('/diagrams');
  }, [router]);

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const newDiagram = await diagramsApi.createDiagram({ title: `${title} (Copy)` });
      // Seed the copy's starter content the same way a template does — client-side,
      // so it goes through the new diagram's own encrypted autosave path once its
      // editor loads, rather than a plaintext server-side write.
      try {
        sessionStorage.setItem(`neutrino:diagram-template:${newDiagram.id}`, JSON.stringify(editor.document));
      } catch {
        // sessionStorage unavailable — the copy still opens, just blank
      }
      return newDiagram;
    },
    onSuccess: (newDiagram) => {
      router.push(`/diagrams/editor?id=${newDiagram.id}`);
    },
    onError: () => toast.error('Failed to duplicate diagram'),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!diagramId) return;
      await diagramsApi.deleteDiagram(diagramId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diagrams'] });
      router.push('/diagrams');
    },
    onError: () => toast.error('Failed to delete diagram'),
  });

  // Schedule autosave 2 s after the last user-driven change.
  // editor.canUndo is false after reset() (load) and true only after push()
  // (user edits), so this guards against saving a freshly-loaded or
  // failed-load empty document.
  useEffect(() => {
    if (!diagramId || !editor.canUndo) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      saveMutation.mutate();
    }, 2000);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.document, diagramId]);

  // Apply a template's starter content, stashed in sessionStorage by the
  // "New diagram" picker for a freshly created (still-blank) diagram.
  // Applied client-side and saved through the normal encrypted autosave path
  // rather than seeded server-side, which would write the starter content in
  // the clear — the server holds no DEK, so it cannot encrypt what it seeds.
  const pendingTemplateSaveRef = useRef(false);

  useEffect(() => {
    if (!diagramId || isLoading || !dekResolved) return;
    const key = `neutrino:diagram-template:${diagramId}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    sessionStorage.removeItem(key);
    try {
      const doc = JSON.parse(raw) as DiagramDocument;
      pendingTemplateSaveRef.current = true;
      editor.setDocument(doc);
    } catch {
      // Malformed payload — leave the diagram blank.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramId, isLoading, dekResolved]);

  // setDocument() resets the undo stack (canUndo=false), so the canUndo-gated
  // autosave effect above won't fire on its own — save explicitly once the
  // template document has actually landed in editor.document.
  useEffect(() => {
    if (!pendingTemplateSaveRef.current) return;
    pendingTemplateSaveRef.current = false;
    saveMutation.mutate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.document]);

  // Seal a diagram the server is still holding in the clear — the content
  // seeded at creation, or one saved before E2EE. Nothing else does it: the
  // autosave is gated on canUndo, so a diagram that is opened and closed
  // without an edit keeps its plaintext body indefinitely. Waiting on
  // `editor.document` is what orders this after the load has applied the body,
  // so the save writes back exactly what was read.
  useEffect(() => {
    if (!sealPlaintextRef.current || contentLoading || !dekRef.current) return;
    // canUndo means the user has already drawn something, and their own save
    // encrypts the newer content anyway.
    if (editor.canUndo) return;
    sealPlaintextRef.current = false;
    saveMutation.mutate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.document, contentLoading]);

  // Broadcast local edits to connected peers in real time.
  // Gated on editor.canUndo for the same reason as autosave: canUndo is false
  // after setDocument() (remote apply or initial load) and true only after
  // user-driven changes, so this never echoes remote updates back to the server.
  useEffect(() => {
    if (!diagramId || !editor.canUndo) return;
    collab.broadcastDocument(editor.document);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.document, diagramId]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isInput =
        (e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'TEXTAREA' ||
        (e.target as HTMLElement).isContentEditable;
      if (isInput) return;

      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          editor.redo();
        } else {
          editor.undo();
        }
      }

      if (meta && e.key === 'y') {
        e.preventDefault();
        editor.redo();
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
        e.preventDefault();
        if (selection.shapeIds.size > 0) {
          editor.removeShapes(Array.from(selection.shapeIds));
          setSelection({ shapeIds: new Set(), connectorIds: new Set() });
        }
        if (selection.connectorIds.size > 0) {
          editor.removeConnectors(Array.from(selection.connectorIds));
          setSelection({ shapeIds: new Set(), connectorIds: new Set() });
        }
      }

      if (meta && e.key === 'd') {
        e.preventDefault();
        if (selection.shapeIds.size > 0) {
          const newIds = editor.duplicateShapes(Array.from(selection.shapeIds));
          setSelection({ shapeIds: new Set(newIds), connectorIds: new Set() });
        }
      }

      if (meta && e.key === 'a') {
        e.preventDefault();
        const page = editor.document.pages[editor.activePageIndex];
        if (page) {
          setSelection({
            shapeIds: new Set(page.shapes.map((s) => s.id)),
            connectorIds: new Set(page.connectors.map((c) => c.id)),
          });
        }
      }

      // Escape — exit presentation or deselect
      if (e.key === 'Escape') {
        if (presentationMode) {
          setPresentationMode(false);
          return;
        }
        setSelection({ shapeIds: new Set(), connectorIds: new Set() });
        setMode('select');
      }

      // V — select tool
      if (e.key === 'v' || e.key === 'V') setMode('select');
      // H — pan
      if (e.key === 'h' || e.key === 'H') setMode('pan');
      // T — text tool
      if (e.key === 't' || e.key === 'T') setMode('text');
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, editor, presentationMode]);

  // ── Fit to screen ─────────────────────────────────────────────────────────

  const handleFitToScreen = useCallback(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper) return;
    const canvasWidth = wrapper.clientWidth;
    const canvasHeight = wrapper.clientHeight;
    const page = editor.document.pages[editor.activePageIndex] ?? editor.document.pages[0];
    const shapes = page?.shapes ?? [];

    if (shapes.length === 0) {
      editor.setViewport({ zoom: 1, x: 0, y: 0 });
      return;
    }

    const minX = Math.min(...shapes.map((s) => s.x));
    const minY = Math.min(...shapes.map((s) => s.y));
    const maxX = Math.max(...shapes.map((s) => s.x + s.width));
    const maxY = Math.max(...shapes.map((s) => s.y + s.height));

    const padding = 48;
    const zoom = Math.min(
      (canvasWidth - padding * 2) / (maxX - minX),
      (canvasHeight - padding * 2) / (maxY - minY),
      4,
    );

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    editor.setViewport({ zoom, x: canvasWidth / 2 / zoom - cx, y: canvasHeight / 2 / zoom - cy });
  }, [editor]);

  // ── Derived values (must be before early returns) ─────────────────────────

  const activePage = editor.document.pages[editor.activePageIndex] ?? editor.document.pages[0];
  const selectedShape = activePage
    ? (activePage.shapes.find((s) => selection.shapeIds.has(s.id)) ?? null)
    : null;

  // Helper: remove strokes whose path passes near a point
  const handleRemoveStrokesUnder = useCallback((x: number, y: number, radius: number) => {
    const page = editor.document.pages[editor.activePageIndex] ?? editor.document.pages[0];
    if (!page?.strokes) return;
    const toRemove = page.strokes
      .filter((stroke) => {
        for (let i = 0; i < stroke.points.length - 1; i += 2) {
          const dx = stroke.points[i] - x;
          const dy = stroke.points[i + 1] - y;
          if (Math.sqrt(dx * dx + dy * dy) < radius) return true;
        }
        return false;
      })
      .map((s) => s.id);
    if (toRemove.length > 0) editor.removeStrokes(toRemove);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.document, editor.activePageIndex, editor.removeStrokes]);

  // ── Rendering ──────────────────────────────────────────────────────────────

  if (!diagramId) {
    router.replace('/diagrams');
    return null;
  }

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="lg" />
      </div>
    );
  }

  // An SVG that this editor did not write. Shown rather than opened: the canvas
  // has nothing to load from it, and every path out of the canvas ends in a
  // write to the file. Building a diagram *around* it is the way forward, and
  // it leaves the original alone.
  if (foreignSvg) {
    return (
      <div className={styles.foreign}>
        {/* As an image, never as markup in the page — see `svgDataUrl`. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.foreignPreview} src={svgDataUrl(foreignSvg)} alt={title} />
        <h2 className={styles.foreignTitle}>{title}</h2>
        <p className={styles.foreignBody}>
          This SVG was not created in Diagrams, so there are no shapes or connectors to
          edit — only the finished picture. Neutrino will not save over it.
        </p>
        <div className={styles.foreignActions}>
          <Button
            variant="primary"
            onClick={() => traceSvgMutation.mutate()}
            disabled={traceSvgMutation.isPending}
          >
            {traceSvgMutation.isPending ? 'Creating…' : 'Create a diagram from this image'}
          </Button>
          <Button variant="secondary" onClick={() => router.push('/diagrams')}>
            Back to Diagrams
          </Button>
        </div>
      </div>
    );
  }

  if (presentationMode) {
    return (
      <div className={styles.presentation}>
        <div className={styles.presentationHint}>Press Esc to exit presentation mode</div>
        {activePage && (
          <DiagramCanvas
            page={activePage}
            viewport={editor.document.viewport}
            selection={{ shapeIds: new Set(), connectorIds: new Set() }}
            mode="pan"
            remoteUsers={[]}
            onSelect={() => {}}
            onModeChange={() => {}}
            onViewportChange={(v) => editor.setViewport(v)}
            onShapeMove={() => {}}
            onShapeResize={() => {}}
            onShapeLabel={() => {}}
            onAddShape={() => {}}
            onConnectorUpdate={() => {}}
            onAddConnector={() => {}}
            onCanvasMouseMove={() => {}}
            onAddStroke={() => {}}
            onRemoveStrokesUnder={() => {}}
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {/* Top toolbar */}
      <DiagramToolbar
        title={title}
        titleEditing={titleEditing}
        onTitleClick={() => setTitleEditing(true)}
        onTitleChange={setTitle}
        onTitleBlur={() => {
          setTitleEditing(false);
          if (diagramId) diagramsApi.saveDiagram(diagramId, { title });
        }}
        mode={mode}
        onModeChange={setMode}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onSave={() => saveMutation.mutate()}
        isSaving={saveMutation.isPending}
        onToggleComments={() => { setShowComments((v) => !v); setShowData(false); setShowDeveloper(false); setShowAi(false); }}
        showComments={showComments}
        onToggleData={() => { setShowData((v) => !v); setShowComments(false); setShowDeveloper(false); setShowAi(false); }}
        showData={showData}
        onToggleDeveloper={() => { setShowDeveloper((v) => !v); setShowData(false); setShowComments(false); setShowAi(false); }}
        showDeveloper={showDeveloper}
        onToggleAi={() => { setShowAi((v) => !v); setShowData(false); setShowComments(false); setShowDeveloper(false); }}
        showAi={showAi}
        onExport={() => setShowExport(true)}
        onImport={() => setShowImport(true)}
        onRunLayout={(alg) => editor.runLayout(alg)}
        onPresentation={() => setPresentationMode(true)}
        selection={selection}
        onAlign={(dir) => editor.align(Array.from(selection.shapeIds), dir)}
        onDistribute={(axis) => editor.distribute(Array.from(selection.shapeIds), axis)}
        onBringForward={() => { editor.bringForward(Array.from(selection.shapeIds)); Array.from(selection.connectorIds).forEach((id) => editor.updateConnector(id, { zIndex: 1 })); }}
        onSendBackward={() => { editor.sendBackward(Array.from(selection.shapeIds)); Array.from(selection.connectorIds).forEach((id) => editor.updateConnector(id, { zIndex: 0 })); }}
        onBringToFront={() => { editor.bringToFront(Array.from(selection.shapeIds)); Array.from(selection.connectorIds).forEach((id) => editor.updateConnector(id, { zIndex: 1 })); }}
        onSendToBack={() => { editor.sendToBack(Array.from(selection.shapeIds)); Array.from(selection.connectorIds).forEach((id) => editor.updateConnector(id, { zIndex: 0 })); }}
        remoteUsers={collab.remoteUsers}
        onShare={() => setShowShareDialog(true)}
        drawColor={drawColor}
        onDrawColorChange={setDrawColor}
        textDefaults={textDefaults}
        onTextDefaultsChange={(changes) => setTextDefaults((prev) => ({ ...prev, ...changes }))}
        onBack={handleBack}
        onNewDiagram={handleNewDiagram}
        format={format}
        onSaveAs={setSaveAsFormat}
        onDuplicate={() => duplicateMutation.mutate()}
        onDeleteClick={() => setShowDeleteConfirm(true)}
      />

      <div className={styles.workspace}>
        {/* Left: shape library panel */}
        <ShapePanel
          onAddShape={(type, label, dataUrl) => {
            const { x: vx, y: vy, zoom } = editor.document.viewport;
            // Place at visible center (assumes ~900×600 canvas area)
            const cx = 450 / zoom - vx;
            const cy = 300 / zoom - vy;
            const extraData = dataUrl ? { imageUrl: dataUrl } : undefined;
            const id = editor.addShape(type, cx, cy, undefined, undefined, extraData);
            if (label) editor.updateShape(id, { label });
            setSelection({ shapeIds: new Set([id]), connectorIds: new Set() });
            setMode('select');
          }}
        />

        {/* Center: infinite canvas */}
        <div className={styles.canvasWrapper} ref={canvasWrapperRef}>
          {pendingExport && (
            <ExportRegionOverlay
              onRegionSelected={async (rect) => {
                const container = canvasWrapperRef.current;
                const { format, filename, size, showGrid, bgColor } = pendingExport;
                setPendingExport(null);
                if (!container) return;
                const scale = RASTER_SIZE_SCALE[size];
                if (format === 'png') {
                  const blob = await exportPNGCropped(container, rect.x, rect.y, rect.width, rect.height, scale, showGrid, bgColor);
                  triggerDownload(blob, `${filename}.png`);
                } else if (format === 'jpeg') {
                  const blob = await exportJPEGCropped(container, rect.x, rect.y, rect.width, rect.height, scale, showGrid, bgColor);
                  triggerDownload(blob, `${filename}.jpeg`);
                } else if (format === 'svg') {
                  const svg = exportSVGCropped(container, rect.x, rect.y, rect.width, rect.height, bgColor, showGrid);
                  triggerDownload(
                    new Blob([withDiagramSource(svg, editor.document)], { type: 'image/svg+xml' }),
                    `${filename}.svg`,
                  );
                }
              }}
              onCancel={() => setPendingExport(null)}
            />
          )}
          {activePage && (
            <DiagramCanvas
              page={activePage}
              viewport={editor.document.viewport}
              selection={selection}
              mode={mode}
              remoteUsers={collab.remoteUsers}
              onSelect={(sel) => setSelection(sel)}
              onModeChange={setMode}
              onViewportChange={(v) => editor.setViewport(v)}
              onShapeMove={(id, x, y) => editor.updateShape(id, { x, y })}
              onShapeResize={(id, x, y, w, h) =>
                editor.updateShape(id, { x, y, width: w, height: h })
              }
              onShapeLabel={(id, label) => editor.updateShape(id, { label })}
              onAddShape={(type, x, y, extraData) => {
                const styleOverride = type === 'text'
                  ? { fontSize: textDefaults.fontSize, fontFamily: textDefaults.fontFamily, textColor: textDefaults.textColor }
                  : undefined;
                const id = editor.addShape(type, x, y, undefined, undefined, extraData, styleOverride);
                setSelection({ shapeIds: new Set([id]), connectorIds: new Set() });
                setMode('select');
                return id;
              }}
              onConnectorUpdate={(id, changes) => editor.updateConnector(id, changes)}
              onAddConnector={(sourceId, targetId, startX, startY, endX, endY, sourcePort, targetPort) => {
                const id = editor.addConnector('straight', sourceId, targetId, startX, startY, endX, endY, sourcePort, targetPort);
                setSelection({ shapeIds: new Set(), connectorIds: new Set([id]) });
              }}
              onCanvasMouseMove={(pos) => collab.sendCursor(pos)}
              onAddStroke={(stroke: FreehandStroke) => editor.addStroke(stroke)}
              onRemoveStrokesUnder={handleRemoveStrokesUnder}
              drawColor={drawColor}
            />
          )}
        </div>

        {/* Right: properties / comments / data / developer / ai panel */}
        {showData ? (
          <DataPanel
            selectedShape={selectedShape}
            onImport={(rows, labelField) => editor.importData(rows, labelField)}
            onUpdateBinding={(id, binding) => editor.updateDataBinding(id, binding)}
            onUpdateRules={(id, rules) => editor.updateConditionalRules(id, rules)}
          />
        ) : showComments ? (
          <CommentsPanel diagramId={diagramId} />
        ) : showDeveloper && activePage ? (
          <MermaidPanel
            page={activePage}
            onApplyShapes={(shapes, connectors) => {
              editor.removeShapes(activePage.shapes.map((s) => s.id));
              editor.removeConnectors(activePage.connectors.map((c) => c.id));
              shapes.forEach((s) => editor.addShape(s.type, s.x, s.y, s.width, s.height));
              const pageAfter = editor.document.pages[editor.activePageIndex] ?? editor.document.pages[0];
              pageAfter.shapes.forEach((s, i) => {
                if (shapes[i]) editor.updateShape(s.id, { label: shapes[i].label, style: shapes[i].style });
              });
            }}
            onRunLayout={() => editor.runLayout('hierarchical')}
          />
        ) : showAi && activePage ? (
          <AiDiagramPanel
            activePage={activePage}
            // One call, so the connectors land with the shapes they name and the whole
            // generated diagram comes back off a single undo.
            onInsertGenerated={(shapes, connectors) => editor.insertElements(shapes, connectors)}
            onAddShapes={(shapes) => {
              shapes.forEach((s) => {
                const id = editor.addShape(s.type, s.x, s.y, s.width, s.height);
                editor.updateShape(id, { label: s.label, style: s.style });
              });
            }}
            onSetSelection={(ids) => setSelection({ shapeIds: new Set(ids), connectorIds: new Set() })}
            onRunLayout={() => editor.runLayout('hierarchical')}
          />
        ) : (
          <PropertiesPanel
            selection={selection}
            page={activePage}
            onShapeUpdate={(id, changes) => editor.updateShape(id, changes)}
            onConnectorUpdate={(id, changes) => editor.updateConnector(id, changes)}
          />
        )}
      </div>

      {/* Bottom: page tabs + zoom */}
      <PagePanel
        pages={editor.document.pages}
        activeIndex={editor.activePageIndex}
        onSelect={editor.setActivePage}
        onAdd={editor.addPage}
        onRemove={(id) => editor.removePage(id)}
        onRename={(id, name) => editor.renamePage(id, name)}
        zoom={Math.round(editor.document.viewport.zoom * 100)}
        onZoomChange={(pct) => editor.setViewport({ zoom: pct / 100 })}
        onFitToScreen={handleFitToScreen}
      />

      {showShareDialog && (
        <ShareDialog
          resource={{ id: diagramId, name: title } as unknown as FileItem}
          resourceType="file"
          onClose={() => setShowShareDialog(false)}
        />
      )}

      <Modal open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} size="sm">
        <ModalHeader title={`Delete "${title}"?`} onClose={() => setShowDeleteConfirm(false)} />
        <ModalBody>This action cannot be undone.</ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => { setShowDeleteConfirm(false); deleteMutation.mutate(); }}
            disabled={deleteMutation.isPending}
          >
            Delete
          </Button>
        </ModalFooter>
      </Modal>

      {showExport && activePage && (
        <ExportDialog
          document={editor.document}
          activePage={activePage}
          canvasContainer={canvasWrapperRef.current}
          title={title}
          onClose={() => setShowExport(false)}
          onExportWithRegion={(format, filename, size, showGrid, bgColor) => {
            setPendingExport({ format, filename, size, showGrid, bgColor });
            setShowExport(false);
          }}
        />
      )}

      {saveAsFormat && (
        <SaveAsDialog
          defaultFilename={`${title || 'Untitled diagram'}.${saveAsFormat === 'svg' ? 'svg' : 'json'}`}
          format={saveAsFormat === 'svg' ? 'svg' : 'ndiagram'}
          onSave={(opts) => handleSaveAs(saveAsFormat, opts)}
          onClose={() => setSaveAsFormat(null)}
        />
      )}

      {showImport && (
        <ImportDialog
          onImportDocument={(doc) => { editor.setDocument(doc); setShowImport(false); }}
          onImportShapes={(shapes: DiagramShape[], connectors: DiagramConnector[]) => {
            shapes.forEach((s) => {
              const id = editor.addShape(s.type, s.x, s.y, s.width, s.height);
              editor.updateShape(id, { label: s.label, style: s.style });
            });
            connectors.forEach((c) => {
              editor.addConnector(c.type, c.sourceId, c.targetId);
            });
            setShowImport(false);
          }}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}
