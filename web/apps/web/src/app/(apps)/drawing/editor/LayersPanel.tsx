'use client';

import React, { useState, useRef } from 'react';
import {
  Square, Circle, Minus, ArrowRight, Pencil, Type,
  Eye, EyeOff, Lock, Unlock, ChevronRight, ChevronDown,
  Plus, Trash2, GripVertical,
} from 'lucide-react';
import type { Shape, ShapeType, Layer } from './types';
import styles from './LayersPanel.module.css';

interface LayersPanelProps {
  shapes: Shape[];
  selectedIds: string[];
  layers: Layer[];
  activeLayerId: string;
  onSelectIds: (ids: string[]) => void;
  onSetActiveLayer: (id: string) => void;
  onAddLayer: () => void;
  onDeleteLayer: (id: string) => void;
  onRenameLayer: (id: string, name: string) => void;
  onToggleLayerHide: (id: string) => void;
  onToggleLayerLock: (id: string) => void;
  onMoveShapeToLayer: (shapeId: string, toLayerId: string) => void;
  onReorderLayers: (layers: Layer[]) => void;
  onToggleLock: (shapeId: string) => void;
}

function shapeIcon(type: ShapeType) {
  switch (type) {
    case 'rectangle': return <Square size={11} />;
    case 'ellipse':   return <Circle size={11} />;
    case 'line':      return <Minus size={11} />;
    case 'arrow':     return <ArrowRight size={11} />;
    case 'pen':       return <Pencil size={11} />;
    case 'text':      return <Type size={11} />;
  }
}

function shapeName(shape: Shape): string {
  if (shape.type === 'text') return shape.text?.trim().slice(0, 22) || 'Text';
  const labels: Record<ShapeType, string> = {
    rectangle: 'Rectangle', ellipse: 'Ellipse',
    line: 'Line', arrow: 'Arrow', pen: 'Path', text: 'Text',
  };
  return labels[shape.type];
}

type DragPayload =
  | { kind: 'shape'; shapeId: string; fromLayerId: string }
  | { kind: 'layer'; layerId: string };

export function LayersPanel({
  shapes,
  selectedIds,
  layers,
  activeLayerId,
  onSelectIds,
  onSetActiveLayer,
  onAddLayer,
  onDeleteLayer,
  onRenameLayer,
  onToggleLayerHide,
  onToggleLayerLock,
  onMoveShapeToLayer,
  onReorderLayers,
  onToggleLock,
}: LayersPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(['background']));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function startRename(layer: Layer) {
    setEditingId(layer.id);
    setEditingName(layer.name);
    setTimeout(() => editInputRef.current?.select(), 0);
  }

  function commitRename() {
    if (editingId && editingName.trim()) {
      onRenameLayer(editingId, editingName.trim());
    }
    setEditingId(null);
  }

  function handleShapeClick(e: React.MouseEvent, shape: Shape) {
    if (e.shiftKey && selectedIds.length > 0) {
      const allIds = shapes.map((s) => s.id);
      const last = allIds.indexOf(selectedIds[selectedIds.length - 1]);
      const current = allIds.indexOf(shape.id);
      const lo = Math.min(last, current);
      const hi = Math.max(last, current);
      onSelectIds(allIds.slice(lo, hi + 1));
    } else if (e.metaKey || e.ctrlKey) {
      onSelectIds(selectedIds.includes(shape.id)
        ? selectedIds.filter((x) => x !== shape.id)
        : [...selectedIds, shape.id]);
    } else {
      onSelectIds([shape.id]);
    }
  }

  // ── Drag handlers ──────────────────────────────────────────────

  function handleShapeDragStart(e: React.DragEvent, shape: Shape) {
    const payload: DragPayload = { kind: 'shape', shapeId: shape.id, fromLayerId: shape.layerId ?? 'background' };
    setDragPayload(payload);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
  }

  function handleLayerDragStart(e: React.DragEvent, layerId: string) {
    if (layerId === 'background') { e.preventDefault(); return; }
    const payload: DragPayload = { kind: 'layer', layerId };
    setDragPayload(payload);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.stopPropagation();
  }

  function handleLayerDragOver(e: React.DragEvent, layerId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverLayerId(layerId);
  }

  function handleLayerDrop(e: React.DragEvent, targetLayerId: string) {
    e.preventDefault();
    setDragOverLayerId(null);
    if (!dragPayload) return;

    if (dragPayload.kind === 'shape') {
      if (dragPayload.fromLayerId !== targetLayerId) {
        onMoveShapeToLayer(dragPayload.shapeId, targetLayerId);
        setExpandedIds((prev) => new Set([...prev, targetLayerId]));
      }
    } else if (dragPayload.kind === 'layer') {
      const fromId = dragPayload.layerId;
      if (fromId === targetLayerId || targetLayerId === 'background') return;
      const next = [...layers];
      const fromIdx = next.findIndex((l) => l.id === fromId);
      const toIdx = next.findIndex((l) => l.id === targetLayerId);
      if (fromIdx === -1 || toIdx === -1) return;
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      onReorderLayers(next);
    }
    setDragPayload(null);
  }

  function handleDragEnd() {
    setDragPayload(null);
    setDragOverLayerId(null);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>Layers</span>
        <button className={styles.addBtn} onClick={onAddLayer} title="Add layer">
          <Plus size={13} />
        </button>
      </div>

      <div className={styles.list}>
        {layers.map((layer) => {
          const layerShapes = shapes.filter((s) => (s.layerId ?? 'background') === layer.id);
          const isActive = layer.id === activeLayerId;
          const isExpanded = expandedIds.has(layer.id);
          const isOver = dragOverLayerId === layer.id && dragPayload?.kind === 'shape' &&
            (dragPayload as { fromLayerId: string }).fromLayerId !== layer.id;
          const isLayerDragOver = dragOverLayerId === layer.id && dragPayload?.kind === 'layer';
          const isDraggingThis = dragPayload?.kind === 'layer' && (dragPayload as { layerId: string }).layerId === layer.id;

          return (
            <div
              key={layer.id}
              className={`${styles.layerBlock} ${isLayerDragOver ? styles.layerBlockDragOver : ''} ${isDraggingThis ? styles.layerBlockDragging : ''}`}
              onDragOver={(e) => handleLayerDragOver(e, layer.id)}
              onDrop={(e) => handleLayerDrop(e, layer.id)}
              onDragEnd={handleDragEnd}
            >
              {/* Layer header row */}
              <div
                className={`${styles.layerRow} ${isActive ? styles.layerRowActive : ''} ${isOver ? styles.layerRowDropTarget : ''}`}
                onClick={() => onSetActiveLayer(layer.id)}
              >
                {layer.id !== 'background' && (
                  <span
                    className={styles.layerGrip}
                    draggable
                    onDragStart={(e) => handleLayerDragStart(e, layer.id)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GripVertical size={11} />
                  </span>
                )}
                {layer.id === 'background' && <span className={styles.layerGripPlaceholder} />}

                <button
                  className={styles.chevronBtn}
                  onClick={(e) => { e.stopPropagation(); toggleExpanded(layer.id); }}
                >
                  {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>

                {editingId === layer.id ? (
                  <input
                    ref={editInputRef}
                    className={styles.renameInput}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditingId(null);
                      e.stopPropagation();
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className={styles.layerName}
                    onDoubleClick={(e) => { e.stopPropagation(); startRename(layer); }}
                    title="Double-click to rename"
                  >
                    {layer.name}
                  </span>
                )}

                <span className={styles.layerCount}>{layerShapes.length}</span>

                <button
                  className={styles.iconBtn}
                  onClick={(e) => { e.stopPropagation(); onToggleLayerLock(layer.id); }}
                  title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                >
                  {layer.locked ? <Lock size={11} /> : <Unlock size={11} />}
                </button>
                <button
                  className={styles.iconBtn}
                  onClick={(e) => { e.stopPropagation(); onToggleLayerHide(layer.id); }}
                  title={layer.hidden ? 'Show layer' : 'Hide layer'}
                >
                  {layer.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                </button>
                {layer.id !== 'background' && confirmDeleteId !== layer.id && (
                  <button
                    className={`${styles.iconBtn} ${styles.deleteBtn}`}
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(layer.id); }}
                    title="Delete layer"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>

              {/* Inline delete confirmation */}
              {confirmDeleteId === layer.id && (
                <div className={styles.confirmRow}>
                  <span className={styles.confirmText}>Delete layer?</span>
                  <button
                    className={styles.confirmYes}
                    onClick={(e) => { e.stopPropagation(); onDeleteLayer(layer.id); setConfirmDeleteId(null); }}
                  >
                    Delete
                  </button>
                  <button
                    className={styles.confirmNo}
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Shapes in this layer */}
              {isExpanded && layerShapes.length === 0 && (
                <p className={styles.emptyLayer}>Empty layer</p>
              )}
              {isExpanded && layerShapes.map((shape) => {
                const selected = selectedIds.includes(shape.id);
                return (
                  <div
                    key={shape.id}
                    className={`${styles.shapeRow} ${selected ? styles.shapeRowSelected : ''}`}
                    onClick={(e) => handleShapeClick(e, shape)}
                    draggable
                    onDragStart={(e) => handleShapeDragStart(e, shape)}
                    onDragEnd={handleDragEnd}
                  >
                    <span className={styles.typeIcon}>{shapeIcon(shape.type)}</span>
                    <span className={styles.shapeName}>
                      {shapeName(shape)}
                    </span>
                    <button
                      className={styles.iconBtn}
                      onClick={(e) => { e.stopPropagation(); onToggleLock(shape.id); }}
                      title={shape.locked ? 'Unlock' : 'Lock'}
                    >
                      {shape.locked ? <Lock size={10} /> : <Unlock size={10} />}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
