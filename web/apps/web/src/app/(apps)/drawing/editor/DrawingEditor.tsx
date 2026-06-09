'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Spinner } from '@neutrino/ui';
import { drawingApi } from '@neutrino/api-drawing';
import { request } from '@neutrino/api-core';
import type { Shape, ToolType, DrawingContent, Transform } from './types';
import { DrawingCanvas } from './DrawingCanvas';
import { DrawingToolbar } from './DrawingToolbar';
import styles from './page.module.css';

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
  const [tool, setTool] = useState<ToolType>('select');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [scale, setScale] = useState(1);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });

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
    const content: DrawingContent = { version: 1, shapes: debouncedShapes };
    drawingApi
      .autosaveContent(drawingId, JSON.stringify(content), 'drawing.json', { title })
      .catch(() => {})
      .finally(() => { saveInProgress.current = false; });
  }, [debouncedShapes, drawingId, title]);

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
    },
    [],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleTransformChange = useCallback((t: Transform) => {
    setTransform(t);
    setScale(t.scale);
  }, []);

  const handleZoomIn = useCallback(() => {
    setTransform((prev) => {
      const newScale = Math.min(10, prev.scale * (1 / 0.9));
      return { ...prev, scale: newScale };
    });
    setScale((prev) => Math.min(10, prev * (1 / 0.9)));
  }, []);

  const handleZoomOut = useCallback(() => {
    setTransform((prev) => {
      const newScale = Math.max(0.1, prev.scale * 0.9);
      return { ...prev, scale: newScale };
    });
    setScale((prev) => Math.max(0.1, prev * 0.9));
  }, []);

  const handleZoomReset = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
    setScale(1);
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
        <input
          className={styles.titleInput}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          aria-label="Drawing title"
        />
        <span className={styles.zoomLabel}>{Math.round(scale * 100)}%</span>
      </div>
      <div className={styles.editorBody}>
        <DrawingToolbar
          tool={tool}
          onToolChange={setTool}
          scale={scale}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onZoomReset={handleZoomReset}
        />
        <div className={styles.canvasArea}>
          <DrawingCanvas
            shapes={shapes}
            tool={tool}
            selectedIds={selectedIds}
            onShapesChange={setShapes}
            onSelectionChange={setSelectedIds}
            onTransformChange={handleTransformChange}
          />
        </div>
      </div>
    </div>
  );
}
