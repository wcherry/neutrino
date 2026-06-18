'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft } from 'lucide-react';
import { Spinner } from '@neutrino/ui';
import { drawingApi } from '@neutrino/api-drawing';
import { request } from '@neutrino/api-core';
import { storageApi } from '@neutrino/api-drive';
import type { DriveImageItem } from '@neutrino/ui';
import type { Shape, Layer, ToolType, DrawingContent, Transform } from './types';
import { DrawingCanvas, type DrawingCanvasHandle } from './DrawingCanvas';
import { DrawingToolbar } from './DrawingToolbar';
import { DrawingMenuBar } from './DrawingMenuBar';
import { StatusBar } from './StatusBar';
import { StylePanel } from './StylePanel';
import { LayersPanel } from './LayersPanel';
import { ExportDialog } from './ExportDialog';
import styles from './page.module.css';

const VersionHistoryPanel = dynamic(
  () => import('@/components/VersionHistoryPanel').then((m) => ({ default: m.VersionHistoryPanel })),
  { ssr: false },
);

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

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function DrawingEditor() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const drawingId = searchParams.get('id');

  const bgLayerIdRef = useRef(Math.random().toString(36).slice(2, 10));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('Untitled drawing');
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [layers, setLayers] = useState<Layer[]>([{ id: bgLayerIdRef.current, name: 'Background', isBackground: true }]);
  const [activeLayerId, setActiveLayerId] = useState(bgLayerIdRef.current);
  const [tool, setTool] = useState<ToolType>('select');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [scale, setScale] = useState(1);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [hasClipboard, setHasClipboard] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const transformStateRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const shapesRef = useRef(shapes);
  const selectedIdsRef = useRef(selectedIds);
  const clipboardRef = useRef<Shape[]>([]);
  const historyRef = useRef<Shape[][]>([]);
  const historyIndexRef = useRef<number>(-1);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUndoRedoRef = useRef(false);
  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

  // Debounced history tracking. Ordered before the dirty effect so it reads afterLoadRef = true
  // (set during load) before the dirty effect resets it to false.
  useEffect(() => {
    if (!hasMounted.current || afterLoadRef.current) return;
    if (isUndoRedoRef.current) { isUndoRedoRef.current = false; return; }
    const timer = setTimeout(() => {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      historyRef.current.push([...shapes]);
      historyIndexRef.current = historyRef.current.length - 1;
      setCanUndo(historyIndexRef.current > 0);
      setCanRedo(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [shapes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mark dirty on any user-initiated change. The first fire after load is swallowed via afterLoadRef.
  useEffect(() => {
    if (!hasMounted.current || afterLoadRef.current) {
      afterLoadRef.current = false;
      return;
    }
    isDirtyRef.current = true;
  }, [shapes, layers, title]);

  const debouncedShapes = useDebounce(shapes, 1000);
  const saveInProgress = useRef(false);
  const hasMounted = useRef(false);
  const isDirtyRef = useRef(false);
  const afterLoadRef = useRef(false);

  useEffect(() => {
    if (!drawingId) {
      setError('No drawing ID provided');
      setLoading(false);
      return;
    }

    async function load() {
      try {
        const drawing = await drawingApi.getDrawing(drawingId!);
        setTitle(drawing.title);
        const raw = await request<string>(drawing.contentUrl, {}, { responseType: 'text' }).catch(() => '');
        if (raw) {
          try {
            const content = JSON.parse(raw) as DrawingContent;

            // Determine background layer from saved content (last layer by convention,
            // or the one marked isBackground, or the legacy 'background' id).
            if (content.layers && content.layers.length > 0) {
              const bgLayer = content.layers.find(l => l.isBackground || l.id === 'background')
                ?? content.layers[content.layers.length - 1];
              bgLayerIdRef.current = bgLayer.id;
              const normalizedLayers = content.layers.map(l =>
                l === bgLayer ? { ...l, isBackground: true as const } : l
              );
              setLayers(normalizedLayers);
              setActiveLayerId(bgLayerIdRef.current);
            }

            // Normalize shapes: migrate legacy undefined/`'background'` layerIds to the actual bg id.
            const bgId = bgLayerIdRef.current;
            const loaded = (content.shapes ?? []).map(s => ({
              ...s,
              layerId: (!s.layerId || s.layerId === 'background') ? bgId : s.layerId,
            }));
            historyRef.current = [[...loaded]];
            historyIndexRef.current = 0;
            setShapes(loaded);
          } catch {
            historyRef.current = [[]];
            historyIndexRef.current = 0;
            setShapes([]);
          }
        } else {
          historyRef.current = [[]];
          historyIndexRef.current = 0;
        }
      } catch {
        setError('Failed to load drawing');
      } finally {
        setLoading(false);
        afterLoadRef.current = true;
        hasMounted.current = true;
      }
    }
    load();
  }, [drawingId]);

  useEffect(() => {
    if (!hasMounted.current || !drawingId || saveInProgress.current || !isDirtyRef.current) return;
    isDirtyRef.current = false;
    saveInProgress.current = true;
    const content: DrawingContent = { version: 1, shapes: debouncedShapes, layers };
    drawingApi
      .autosaveContent(drawingId, JSON.stringify(content), 'drawing.json', { title })
      .catch(() => {})
      .finally(() => { saveInProgress.current = false; });
  }, [debouncedShapes, drawingId, title, layers]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIdsRef.current.length > 0) {
          setShapes((prev) => prev.filter((s) => !selectedIdsRef.current.includes(s.id)));
          setSelectedIds([]);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        if (selectedIdsRef.current.length > 0) {
          const originals = shapesRef.current.filter((s) => selectedIdsRef.current.includes(s.id));
          const copies = originals.map((s) => ({
            ...s,
            id: Math.random().toString(36).slice(2, 10),
            x: s.x + 16,
            y: s.y + 16,
            points: s.points.map((p) => ({ x: p.x + 16, y: p.y + 16 })),
          }));
          setShapes((prev) => [...prev, ...copies]);
          setSelectedIds(copies.map((c) => c.id));
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        if (selectedIdsRef.current.length > 0) {
          clipboardRef.current = shapesRef.current.filter((s) => selectedIdsRef.current.includes(s.id));
          setHasClipboard(true);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault();
        if (selectedIdsRef.current.length > 0) {
          clipboardRef.current = shapesRef.current.filter((s) => selectedIdsRef.current.includes(s.id));
          setHasClipboard(true);
          setShapes((prev) => prev.filter((s) => !selectedIdsRef.current.includes(s.id)));
          setSelectedIds([]);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        if (clipboardRef.current.length > 0) {
          const pastes = clipboardRef.current.map((s) => ({
            ...s,
            id: Math.random().toString(36).slice(2, 10),
            x: s.x + 16,
            y: s.y + 16,
            points: s.points.map((p) => ({ x: p.x + 16, y: p.y + 16 })),
          }));
          setShapes((prev) => [...prev, ...pastes]);
          setSelectedIds(pastes.map((p) => p.id));
        }
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        if (historyTimerRef.current !== null) {
          clearTimeout(historyTimerRef.current);
          historyTimerRef.current = null;
          historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
          historyRef.current.push([...shapesRef.current]);
          historyIndexRef.current = historyRef.current.length - 1;
        }
        if (historyIndexRef.current <= 0) return;
        isUndoRedoRef.current = true;
        historyIndexRef.current--;
        setShapes([...historyRef.current[historyIndexRef.current]]);
        setSelectedIds([]);
        setCanUndo(historyIndexRef.current > 0);
        setCanRedo(true);
      }
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key === 'z') || e.key === 'y')) {
        e.preventDefault();
        if (historyIndexRef.current >= historyRef.current.length - 1) return;
        isUndoRedoRef.current = true;
        historyIndexRef.current++;
        setShapes([...historyRef.current[historyIndexRef.current]]);
        setSelectedIds([]);
        setCanUndo(true);
        setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "'") {
        e.preventDefault();
        setShowGrid((v) => !v);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleTransformChange = useCallback((t: Transform) => {
    transformStateRef.current = t;
    setTransform(t);
    setScale(t.scale);
  }, []);

  const handleZoomChange = useCallback((percent: number) => {
    const newScale = percent / 100;
    const newT = { ...transformStateRef.current, scale: newScale };
    transformStateRef.current = newT;
    setTransform(newT);
    setScale(newScale);
    canvasRef.current?.setTransform(newT);
  }, []);

  const handleZoomReset = useCallback(() => {
    const newT = { x: 0, y: 0, scale: 1 };
    transformStateRef.current = newT;
    setTransform(newT);
    setScale(1);
    canvasRef.current?.setTransform(newT);
  }, []);

  const handleZoomIn = useCallback(() => {
    const newScale = Math.min(10, transformStateRef.current.scale * (1 / 0.9));
    handleZoomChange(Math.round(newScale * 100));
  }, [handleZoomChange]);

  const handleZoomOut = useCallback(() => {
    const newScale = Math.max(0.1, transformStateRef.current.scale * 0.9);
    handleZoomChange(Math.round(newScale * 100));
  }, [handleZoomChange]);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(shapesRef.current.map((s) => s.id));
  }, []);

  const handleDelete = useCallback(() => {
    if (selectedIdsRef.current.length === 0) return;
    setShapes((prev) => prev.filter((s) => !selectedIdsRef.current.includes(s.id)));
    setSelectedIds([]);
  }, []);

  const handleDuplicate = useCallback(() => {
    if (selectedIdsRef.current.length === 0) return;
    const originals = shapesRef.current.filter((s) => selectedIdsRef.current.includes(s.id));
    const copies = originals.map((s) => ({
      ...s,
      id: Math.random().toString(36).slice(2, 10),
      x: s.x + 16,
      y: s.y + 16,
      points: s.points.map((p) => ({ x: p.x + 16, y: p.y + 16 })),
    }));
    setShapes((prev) => [...prev, ...copies]);
    setSelectedIds(copies.map((c) => c.id));
  }, []);

  const handleCopy = useCallback(() => {
    if (selectedIdsRef.current.length === 0) return;
    clipboardRef.current = shapesRef.current.filter((s) => selectedIdsRef.current.includes(s.id));
    setHasClipboard(true);
  }, []);

  const handleCut = useCallback(() => {
    if (selectedIdsRef.current.length === 0) return;
    clipboardRef.current = shapesRef.current.filter((s) => selectedIdsRef.current.includes(s.id));
    setHasClipboard(true);
    setShapes((prev) => prev.filter((s) => !selectedIdsRef.current.includes(s.id)));
    setSelectedIds([]);
  }, []);

  const handlePaste = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    const pastes = clipboardRef.current.map((s) => ({
      ...s,
      id: Math.random().toString(36).slice(2, 10),
      x: s.x + 16,
      y: s.y + 16,
      points: s.points.map((p) => ({ x: p.x + 16, y: p.y + 16 })),
    }));
    setShapes((prev) => [...prev, ...pastes]);
    setSelectedIds(pastes.map((p) => p.id));
  }, []);

  const handleUndo = useCallback(() => {
    if (historyTimerRef.current !== null) {
      clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      historyRef.current.push([...shapesRef.current]);
      historyIndexRef.current = historyRef.current.length - 1;
    }
    if (historyIndexRef.current <= 0) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current--;
    setShapes([...historyRef.current[historyIndexRef.current]]);
    setSelectedIds([]);
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(true);
  }, []);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    isUndoRedoRef.current = true;
    historyIndexRef.current++;
    setShapes([...historyRef.current[historyIndexRef.current]]);
    setSelectedIds([]);
    setCanUndo(true);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  const handleToggleLock = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.length === 0) return;
    const anyLocked = shapesRef.current.some((s) => ids.includes(s.id) && s.locked);
    setShapes((prev) => prev.map((s) => ids.includes(s.id) ? { ...s, locked: !anyLocked } : s));
  }, []);

  const handleToggleLockById = useCallback((id: string) => {
    setShapes((prev) => prev.map((s) => s.id === id ? { ...s, locked: !s.locked } : s));
  }, []);

  // --- Layer operations ---

  const handleAddLayer = useCallback(() => {
    const id = Math.random().toString(36).slice(2, 10);
    const newLayer: Layer = { id, name: 'New layer' };
    setLayers((prev) => {
      const bg = prev.find((l) => l.isBackground);
      const rest = prev.filter((l) => !l.isBackground);
      return bg ? [newLayer, ...rest, bg] : [newLayer, ...rest];
    });
    setActiveLayerId(id);
  }, []);

  const handleDeleteLayer = useCallback((id: string) => {
    if (id === bgLayerIdRef.current) return;
    setShapes((prev) => prev.map((s) => s.layerId === id ? { ...s, layerId: bgLayerIdRef.current } : s));
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setActiveLayerId((prev) => (prev === id ? bgLayerIdRef.current : prev));
  }, []);

  const handleRenameLayer = useCallback((id: string, name: string) => {
    setLayers((prev) => prev.map((l) => l.id === id ? { ...l, name } : l));
  }, []);

  const handleToggleLayerHide = useCallback((id: string) => {
    setLayers((prev) => prev.map((l) => l.id === id ? { ...l, hidden: !l.hidden } : l));
  }, []);

  const handleToggleLayerLock = useCallback((id: string) => {
    setLayers((prev) => prev.map((l) => l.id === id ? { ...l, locked: !l.locked } : l));
  }, []);

  const handleMoveShapeToLayer = useCallback((shapeId: string, toLayerId: string) => {
    setShapes((prev) => prev.map((s) => s.id === shapeId ? { ...s, layerId: toLayerId } : s));
  }, []);

  const handleReorderLayers = useCallback((newLayers: Layer[]) => {
    setLayers(newLayers);
  }, []);

  // --- Style changes ---

  const handleStyleChange = useCallback((ids: string[], patch: Partial<Shape>) => {
    setShapes((prev) => prev.map((s) => ids.includes(s.id) ? { ...s, ...patch } : s));
  }, []);

  // --- Drive image picker ---

  const handleFetchDriveImages = useCallback(async (): Promise<DriveImageItem[]> => {
    const IMAGE_MIME_PREFIXES = ['image/'];
    const result = await storageApi.listFiles({ limit: 200, orderBy: 'updatedAt', direction: 'desc' });
    return result.items
      .filter((f) => IMAGE_MIME_PREFIXES.some((prefix) => f.mimeType.startsWith(prefix)))
      .map((f) => ({
        id: f.id,
        name: f.name,
        url: storageApi.getFileDownloadUrl(f.id),
        thumbnailUrl: f.coverThumbnail
          ? `data:${f.coverThumbnailMimeType ?? 'image/jpeg'};base64,${f.coverThumbnail}`
          : undefined,
      }));
  }, []);

  // --- Export ---

  const handleExportPNG = useCallback(async (options: { scale: number; bgColor: string; filename: string }) => {
    const blob = await canvasRef.current?.exportPNG(options);
    if (blob) triggerDownload(blob, `${options.filename || 'drawing'}.png`);
  }, []);

  const handleExportSVG = useCallback((options: { bgColor: string; filename: string }) => {
    const svg = canvasRef.current?.exportSVG(options);
    if (svg) {
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      triggerDownload(blob, `${options.filename || 'drawing'}.svg`);
    }
  }, []);

  const handleTitleBlur = useCallback(() => {
    if (!drawingId || !title.trim()) return;
    drawingApi.saveDrawing(drawingId, { title }).catch(() => {});
  }, [drawingId, title]);

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
          selectedCount={selectedIds.length}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          onSelectAll={handleSelectAll}
          onCut={handleCut}
          onCopy={handleCopy}
          onPaste={handlePaste}
          hasClipboard={hasClipboard}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleZoomReset}
          onFitToScreen={handleZoomReset}
          onToggleLock={handleToggleLock}
          onExport={() => setShowExport(true)}
          onVersionHistory={() => setShowVersionHistory(true)}
          showGrid={showGrid}
          onToggleGrid={() => setShowGrid((v) => !v)}
          titleInputRef={titleInputRef}
        />
        <input
          ref={titleInputRef}
          className={styles.titleInput}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          aria-label="Drawing title"
        />
      </div>
      <div className={styles.editorBody}>
        <DrawingToolbar tool={tool} onToolChange={setTool} />
        <LayersPanel
          shapes={shapes}
          selectedIds={selectedIds}
          layers={layers}
          activeLayerId={activeLayerId}
          onSelectIds={setSelectedIds}
          onSetActiveLayer={setActiveLayerId}
          onAddLayer={handleAddLayer}
          onDeleteLayer={handleDeleteLayer}
          onRenameLayer={handleRenameLayer}
          onToggleLayerHide={handleToggleLayerHide}
          onToggleLayerLock={handleToggleLayerLock}
          onMoveShapeToLayer={handleMoveShapeToLayer}
          onReorderLayers={handleReorderLayers}
          onToggleLock={handleToggleLockById}
        />
        <div className={styles.canvasArea}>
          <DrawingCanvas
            ref={canvasRef}
            shapes={shapes}
            tool={tool}
            selectedIds={selectedIds}
            onShapesChange={setShapes}
            onSelectionChange={setSelectedIds}
            onTransformChange={handleTransformChange}
            showGrid={showGrid}
            layers={layers}
            activeLayerId={activeLayerId}
          />
        </div>
        <StylePanel
          shapes={shapes}
          selectedIds={selectedIds}
          onStyleChange={handleStyleChange}
          onToggleLock={handleToggleLock}
          onFetchDriveImages={handleFetchDriveImages}
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
        zoom={Math.round(scale * 100)}
        onZoomChange={handleZoomChange}
        onFitToScreen={handleZoomReset}
      />
      {showExport && (
        <ExportDialog
          shapes={shapes}
          title={title}
          onClose={() => setShowExport(false)}
          onExportPNG={handleExportPNG}
          onExportSVG={handleExportSVG}
        />
      )}
    </div>
  );
}
