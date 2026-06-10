'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft } from 'lucide-react';
import { Spinner } from '@neutrino/ui';
import { drawingApi } from '@neutrino/api-drawing';
import { request } from '@neutrino/api-core';
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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('Untitled drawing');
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [layers, setLayers] = useState<Layer[]>([{ id: 'background', name: 'Background' }]);
  const [activeLayerId, setActiveLayerId] = useState('background');
  const [tool, setTool] = useState<ToolType>('select');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [scale, setScale] = useState(1);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showGrid, setShowGrid] = useState(true);

  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const transformStateRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const shapesRef = useRef(shapes);
  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

  const debouncedShapes = useDebounce(shapes, 1000);
  const saveInProgress = useRef(false);
  const hasMounted = useRef(false);

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
            setShapes(content.shapes ?? []);
            if (content.layers && content.layers.length > 0) {
              const hasBackground = content.layers.some((l) => l.id === 'background');
              setLayers(hasBackground ? content.layers : [...content.layers, { id: 'background', name: 'Background' }]);
            }

          } catch {
            setShapes([]);
          }
        }
      } catch {
        setError('Failed to load drawing');
      } finally {
        setLoading(false);
        hasMounted.current = true;
      }
    }
    load();
  }, [drawingId]);

  useEffect(() => {
    if (!hasMounted.current || !drawingId || saveInProgress.current) return;
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
      // Layer shortcuts
      if ((e.ctrlKey || e.metaKey) && e.key === ']') {
        e.preventDefault();
        handleBringForward();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '[') {
        e.preventDefault();
        handleSendBackward();
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

  // --- Layer operations ---

  const handleBringForward = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.length === 0) return;
    setShapes((prev) => {
      const next = [...prev];
      // Move each selected shape one step forward (toward end of array = top)
      for (let i = next.length - 2; i >= 0; i--) {
        if (ids.includes(next[i].id) && !ids.includes(next[i + 1].id)) {
          [next[i], next[i + 1]] = [next[i + 1], next[i]];
        }
      }
      return next;
    });
  }, []);

  const handleSendBackward = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.length === 0) return;
    setShapes((prev) => {
      const next = [...prev];
      for (let i = 1; i < next.length; i++) {
        if (ids.includes(next[i].id) && !ids.includes(next[i - 1].id)) {
          [next[i - 1], next[i]] = [next[i], next[i - 1]];
        }
      }
      return next;
    });
  }, []);

  const handleBringToFront = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.length === 0) return;
    setShapes((prev) => [
      ...prev.filter((s) => !ids.includes(s.id)),
      ...prev.filter((s) => ids.includes(s.id)),
    ]);
  }, []);

  const handleSendToBack = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.length === 0) return;
    setShapes((prev) => [
      ...prev.filter((s) => ids.includes(s.id)),
      ...prev.filter((s) => !ids.includes(s.id)),
    ]);
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
      const bg = prev.find((l) => l.id === 'background');
      const rest = prev.filter((l) => l.id !== 'background');
      return bg ? [newLayer, ...rest, bg] : [newLayer, ...rest];
    });
    setActiveLayerId(id);
  }, []);

  const handleDeleteLayer = useCallback((id: string) => {
    if (id === 'background') return;
    setShapes((prev) => prev.map((s) => s.layerId === id ? { ...s, layerId: 'background' } : s));
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setActiveLayerId((prev) => (prev === id ? 'background' : prev));
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
          onSelectAll={handleSelectAll}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleZoomReset}
          onFitToScreen={handleZoomReset}
          onBringForward={handleBringForward}
          onSendBackward={handleSendBackward}
          onBringToFront={handleBringToFront}
          onSendToBack={handleSendToBack}
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
