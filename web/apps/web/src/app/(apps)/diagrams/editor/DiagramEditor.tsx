'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ExportFormat, RasterSize } from './io/ExportDialog';
import { RASTER_SIZE_SCALE } from './io/ExportDialog';
import { exportPNGCropped, exportJPEGCropped, exportSVGCropped, triggerDownload } from './io/exportUtils';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Spinner, useToast } from '@neutrino/ui';
import { diagramsApi } from '@neutrino/api-diagrams';
import { authApi } from '@neutrino/auth';
import { decryptFile } from '@neutrino/e2e-crypto';
import { storageApi, type FileItem } from '@/lib/api';
import { ShareDialog } from '@/app/(apps)/drive/ShareDialog';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
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

function parseDocument(raw: string): DiagramDocument {
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
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  const { dekRef, dekResolved, isNewEncryption } = useEncryptedDocumentContent({ id: diagramId, filename: 'diagram.json' });
  const toast = useToast();

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

  const { isLoading } = useQuery({
    queryKey: ['diagram', diagramId, dekResolved],
    queryFn: async () => {
      const diagram = await diagramsApi.getDiagram(diagramId);
      setTitle(diagram.title);
      if (diagram.contentUrl) {
        try {
          let raw: string;
          if (dekRef.current) {
            const blob = await storageApi.downloadFile(diagramId);
            const cipherBytes = new Uint8Array(await blob.arrayBuffer());
            let decryptOk = false;
            try {
              const plainBytes = decryptFile(cipherBytes, dekRef.current);
              raw = new TextDecoder().decode(plainBytes);
              decryptOk = true;
            } catch {
              // Decryption failed. For new files (isNewEncryption) the server
              // holds plaintext — fall through to the token-based fetch below.
              // For existing files with a server-side key, fall back to raw
              // content to avoid showing an empty diagram when the real data exists.
            }
            if (!decryptOk) {
              if (!isNewEncryption) {
                const token = localStorage.getItem('access_token') ?? '';
                const res = await fetch(diagram.contentUrl, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) return diagram;
                raw = await res.text();
              } else {
                return diagram;
              }
            }
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
          const doc = parseDocument(raw!);
          editor.setDocument(doc);
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

  // ── Save / autosave ────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!diagramId) return;
      if (!dekRef.current) throw new Error('no-dek');
      const content = JSON.stringify(editor.document, null, 0);
      await diagramsApi.autosaveEncryptedContent(diagramId, content, 'diagram.json', dekRef.current, { title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diagrams'] });
    },
    onError: (err) => {
      if (err instanceof Error && err.message === 'no-dek') {
        toast.warning(ENCRYPTION_WARNING_MESSAGE);
      }
    },
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
                  triggerDownload(new Blob([svg], { type: 'image/svg+xml' }), `${filename}.svg`);
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
            onAddShapes={(shapes) => {
              shapes.forEach((s) => {
                const id = editor.addShape(s.type, s.x, s.y, s.width, s.height);
                editor.updateShape(id, { label: s.label, style: s.style });
              });
            }}
            onAddConnectors={(connectors) => {
              connectors.forEach((c) => {
                editor.addConnector(c.type, c.sourceId, c.targetId);
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
