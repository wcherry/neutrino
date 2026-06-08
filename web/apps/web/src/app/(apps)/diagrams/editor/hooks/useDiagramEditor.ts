'use client';

import { useCallback, useState } from 'react';
import { useUndoRedo } from './useUndoRedo';
import type {
  DiagramDocument,
  DiagramShape,
  DiagramConnector,
  DiagramPage,
  Viewport,
  ShapeType,
  ConnectorType,
} from '../../types';
import {
  defaultShapeStyle,
  defaultConnectorStyle,
  snapToGrid,
  alignShapes,
  distributeShapes,
  type AlignDirection,
} from '../utils/shapeUtils';

const uuidv4 = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiagramEditorState {
  document: DiagramDocument;
  canUndo: boolean;
  canRedo: boolean;
  activePageIndex: number;
}

export interface DiagramEditorActions {
  // Pages
  addPage: () => void;
  removePage: (pageId: string) => void;
  renamePage: (pageId: string, name: string) => void;
  setActivePage: (index: number) => void;

  // Shapes
  addShape: (
    type: ShapeType,
    x: number,
    y: number,
    width?: number,
    height?: number,
  ) => string;
  updateShape: (id: string, changes: Partial<DiagramShape>) => void;
  removeShapes: (ids: string[]) => void;
  moveShapes: (ids: string[], dx: number, dy: number) => void;
  duplicateShapes: (ids: string[]) => string[];

  // Connectors
  addConnector: (
    type: ConnectorType,
    sourceId: string | null,
    targetId: string | null,
    startX?: number,
    startY?: number,
    endX?: number,
    endY?: number,
  ) => string;
  updateConnector: (id: string, changes: Partial<DiagramConnector>) => void;
  removeConnectors: (ids: string[]) => void;

  // Layer order
  bringForward: (ids: string[]) => void;
  sendBackward: (ids: string[]) => void;
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;

  // Align / distribute
  align: (ids: string[], direction: AlignDirection) => void;
  distribute: (ids: string[], axis: 'horizontal' | 'vertical') => void;

  // Viewport
  setViewport: (v: Partial<Viewport>) => void;

  // History
  undo: () => void;
  redo: () => void;

  // Full document replacement (for loading from server)
  setDocument: (doc: DiagramDocument) => void;
}

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

const DEFAULT_SHAPE_SIZES: Partial<Record<ShapeType, { w: number; h: number }>> = {
  rectangle: { w: 120, h: 60 },
  'rounded-rectangle': { w: 120, h: 60 },
  ellipse: { w: 120, h: 80 },
  circle: { w: 80, h: 80 },
  triangle: { w: 80, h: 80 },
  diamond: { w: 100, h: 80 },
  hexagon: { w: 100, h: 80 },
  parallelogram: { w: 120, h: 60 },
  pentagon: { w: 100, h: 80 },
  trapezoid: { w: 120, h: 60 },
  'flowchart-process': { w: 120, h: 60 },
  'flowchart-decision': { w: 120, h: 80 },
  'flowchart-terminator': { w: 120, h: 50 },
  'flowchart-document': { w: 120, h: 60 },
  'flowchart-data': { w: 120, h: 60 },
  'uml-class': { w: 160, h: 120 },
  'network-server': { w: 80, h: 80 },
  'network-database': { w: 80, h: 80 },
  'network-cloud': { w: 120, h: 80 },
  swimlane: { w: 300, h: 200 },
  group: { w: 200, h: 150 },
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDiagramEditor(initial: DiagramDocument): DiagramEditorState & DiagramEditorActions {
  const { state: document, canUndo, canRedo, push, undo, redo, reset } = useUndoRedo<DiagramDocument>(initial);
  const [activePageIndex, setActivePage] = usePageIndex(0);

  const activePage = (): DiagramPage => document.pages[activePageIndex] ?? document.pages[0];

  const updateDocument = useCallback(
    (updater: (prev: DiagramDocument) => DiagramDocument) => {
      push(updater(document));
    },
    [document, push],
  );

  const updatePage = useCallback(
    (pageId: string, updater: (prev: DiagramPage) => DiagramPage) => {
      updateDocument((doc) => ({
        ...doc,
        pages: doc.pages.map((p) => (p.id === pageId ? updater(p) : p)),
      }));
    },
    [updateDocument],
  );

  const snapXY = (x: number, y: number, page: DiagramPage): { x: number; y: number } => {
    const gridSize = page.gridSize ?? 20;
    if (page.snapEnabled === false) return { x, y };
    return { x: snapToGrid(x, gridSize), y: snapToGrid(y, gridSize) };
  };

  // ── Pages ──────────────────────────────────────────────────────────────────

  const addPage = useCallback(() => {
    updateDocument((doc) => ({
      ...doc,
      pages: [
        ...doc.pages,
        {
          id: uuidv4(),
          name: `Page ${doc.pages.length + 1}`,
          shapes: [],
          connectors: [],
        },
      ],
    }));
  }, [updateDocument]);

  const removePage = useCallback(
    (pageId: string) => {
      updateDocument((doc) => {
        if (doc.pages.length <= 1) return doc;
        return { ...doc, pages: doc.pages.filter((p) => p.id !== pageId) };
      });
    },
    [updateDocument],
  );

  const renamePage = useCallback(
    (pageId: string, name: string) => {
      updatePage(pageId, (p) => ({ ...p, name }));
    },
    [updatePage],
  );

  // ── Shapes ─────────────────────────────────────────────────────────────────

  const addShape = useCallback(
    (type: ShapeType, x: number, y: number, width?: number, height?: number): string => {
      const id = uuidv4();
      const page = activePage();
      const snapped = snapXY(x, y, page);
      const defaults = DEFAULT_SHAPE_SIZES[type] ?? { w: 120, h: 60 };
      const shape: DiagramShape = {
        id,
        type,
        x: snapped.x,
        y: snapped.y,
        width: width ?? defaults.w,
        height: height ?? defaults.h,
        label: '',
        style: defaultShapeStyle(),
      };
      updatePage(page.id, (p) => ({ ...p, shapes: [...p.shapes, shape] }));
      return id;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updatePage, document, activePageIndex],
  );

  const updateShape = useCallback(
    (id: string, changes: Partial<DiagramShape>) => {
      const page = activePage();
      updatePage(page.id, (p) => ({
        ...p,
        shapes: p.shapes.map((s) => (s.id === id ? { ...s, ...changes } : s)),
      }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updatePage, document, activePageIndex],
  );

  const removeShapes = useCallback(
    (ids: string[]) => {
      const page = activePage();
      const idSet = new Set(ids);
      updatePage(page.id, (p) => ({
        ...p,
        shapes: p.shapes.filter((s) => !idSet.has(s.id)),
        connectors: p.connectors.filter(
          (c) => !idSet.has(c.sourceId ?? '') && !idSet.has(c.targetId ?? ''),
        ),
      }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updatePage, document, activePageIndex],
  );

  const moveShapes = useCallback(
    (ids: string[], dx: number, dy: number) => {
      const page = activePage();
      const idSet = new Set(ids);
      updatePage(page.id, (p) => ({
        ...p,
        shapes: p.shapes.map((s) =>
          idSet.has(s.id)
            ? { ...s, x: s.x + dx, y: s.y + dy }
            : s,
        ),
      }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updatePage, document, activePageIndex],
  );

  const duplicateShapes = useCallback(
    (ids: string[]): string[] => {
      const page = activePage();
      const idSet = new Set(ids);
      const originals = page.shapes.filter((s) => idSet.has(s.id));
      const idMap = new Map<string, string>();
      const copies: DiagramShape[] = originals.map((s) => {
        const newId = uuidv4();
        idMap.set(s.id, newId);
        return { ...s, id: newId, x: s.x + 20, y: s.y + 20 };
      });
      updatePage(page.id, (p) => ({ ...p, shapes: [...p.shapes, ...copies] }));
      return copies.map((s) => s.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updatePage, document, activePageIndex],
  );

  // ── Connectors ─────────────────────────────────────────────────────────────

  const addConnector = useCallback(
    (
      type: ConnectorType,
      sourceId: string | null,
      targetId: string | null,
      startX?: number,
      startY?: number,
      endX?: number,
      endY?: number,
    ): string => {
      const id = uuidv4();
      const page = activePage();
      const connector: DiagramConnector = {
        id,
        type,
        sourceId,
        targetId,
        waypoints: [],
        label: '',
        style: defaultConnectorStyle(),
        startPoint: startX !== undefined ? { x: startX, y: startY! } : undefined,
        endPoint: endX !== undefined ? { x: endX, y: endY! } : undefined,
      };
      updatePage(page.id, (p) => ({ ...p, connectors: [...p.connectors, connector] }));
      return id;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updatePage, document, activePageIndex],
  );

  const updateConnector = useCallback(
    (id: string, changes: Partial<DiagramConnector>) => {
      const page = activePage();
      updatePage(page.id, (p) => ({
        ...p,
        connectors: p.connectors.map((c) => (c.id === id ? { ...c, ...changes } : c)),
      }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updatePage, document, activePageIndex],
  );

  const removeConnectors = useCallback(
    (ids: string[]) => {
      const page = activePage();
      const idSet = new Set(ids);
      updatePage(page.id, (p) => ({
        ...p,
        connectors: p.connectors.filter((c) => !idSet.has(c.id)),
      }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updatePage, document, activePageIndex],
  );

  // ── Layer order ────────────────────────────────────────────────────────────

  const reorderShapes = useCallback(
    (ids: string[], direction: 'forward' | 'backward' | 'front' | 'back') => {
      const page = activePage();
      const idSet = new Set(ids);
      const selected = page.shapes.filter((s) => idSet.has(s.id));
      const rest = page.shapes.filter((s) => !idSet.has(s.id));
      let shapes: DiagramShape[];
      switch (direction) {
        case 'front':    shapes = [...rest, ...selected]; break;
        case 'back':     shapes = [...selected, ...rest]; break;
        case 'forward': {
          const maxIdx = Math.max(...selected.map((s) => page.shapes.indexOf(s)));
          shapes = [...page.shapes];
          if (maxIdx < shapes.length - 1) {
            const after = shapes[maxIdx + 1];
            shapes.splice(maxIdx + 1, 1);
            shapes.splice(maxIdx, 0, after);
          }
          break;
        }
        case 'backward': {
          const minIdx = Math.min(...selected.map((s) => page.shapes.indexOf(s)));
          shapes = [...page.shapes];
          if (minIdx > 0) {
            const before = shapes[minIdx - 1];
            shapes.splice(minIdx - 1, 1);
            shapes.splice(minIdx, 0, before);
          }
          break;
        }
      }
      updatePage(page.id, (p) => ({ ...p, shapes }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updatePage, document, activePageIndex],
  );

  const bringForward = useCallback((ids: string[]) => reorderShapes(ids, 'forward'), [reorderShapes]);
  const sendBackward = useCallback((ids: string[]) => reorderShapes(ids, 'backward'), [reorderShapes]);
  const bringToFront = useCallback((ids: string[]) => reorderShapes(ids, 'front'), [reorderShapes]);
  const sendToBack = useCallback((ids: string[]) => reorderShapes(ids, 'back'), [reorderShapes]);

  // ── Align / distribute ─────────────────────────────────────────────────────

  const align = useCallback(
    (ids: string[], direction: AlignDirection) => {
      const page = activePage();
      const idSet = new Set(ids);
      const toAlign = page.shapes.filter((s) => idSet.has(s.id));
      const aligned = alignShapes(toAlign, direction);
      const alignedMap = new Map(aligned.map((s) => [s.id, s]));
      updatePage(page.id, (p) => ({
        ...p,
        shapes: p.shapes.map((s) => alignedMap.get(s.id) ?? s),
      }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updatePage, document, activePageIndex],
  );

  const distribute = useCallback(
    (ids: string[], axis: 'horizontal' | 'vertical') => {
      const page = activePage();
      const idSet = new Set(ids);
      const toDistribute = page.shapes.filter((s) => idSet.has(s.id));
      const distributed = distributeShapes(toDistribute, axis);
      const distMap = new Map(distributed.map((s) => [s.id, s]));
      updatePage(page.id, (p) => ({
        ...p,
        shapes: p.shapes.map((s) => distMap.get(s.id) ?? s),
      }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updatePage, document, activePageIndex],
  );

  // ── Viewport ───────────────────────────────────────────────────────────────

  const setViewport = useCallback(
    (v: Partial<Viewport>) => {
      // Viewport changes don't go into the undo stack
      push({ ...document, viewport: { ...document.viewport, ...v } });
    },
    [document, push],
  );

  // ── Document reset ─────────────────────────────────────────────────────────

  const setDocument = useCallback(
    (doc: DiagramDocument) => {
      reset(doc);
    },
    [reset],
  );

  return {
    // State
    document,
    canUndo,
    canRedo,
    activePageIndex,
    // Pages
    addPage,
    removePage,
    renamePage,
    setActivePage,
    // Shapes
    addShape,
    updateShape,
    removeShapes,
    moveShapes,
    duplicateShapes,
    // Connectors
    addConnector,
    updateConnector,
    removeConnectors,
    // Layer
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    // Arrange
    align,
    distribute,
    // Viewport
    setViewport,
    // History
    undo,
    redo,
    // Document
    setDocument,
  };
}

// ---------------------------------------------------------------------------
// Simple page index state (separate from undo stack)
// ---------------------------------------------------------------------------
function usePageIndex(initial: number): [number, (i: number) => void] {
  const [activePageIndex, setActivePage] = useState(initial);
  return [activePageIndex, setActivePage];
}
