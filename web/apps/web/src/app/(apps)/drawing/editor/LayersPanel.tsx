'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Eye,
  EyeOff,
  Folder,
  GripVertical,
  Image as ImageIcon,
  Lock,
  Minus,
  Pencil,
  Plus,
  Square,
  Trash2,
  Type,
  Unlock,
  Layers as LayersIcon,
} from 'lucide-react';

import { findNode, findParent, flattenTree } from './document/tree';
import {
  addNode,
  deleteNode,
  patchObjects,
  setNodeProps,
} from './document/edits';
import { createStack, createVectorLayer } from './document/factory';
import { moveNode } from './document/tree';
import {
  BLEND_MODES,
  BLEND_MODE_LABELS,
  type BlendMode,
  type DrawingDocument,
  type DrawingNode,
  type Selection,
  type VectorObject,
} from './types';
import styles from './LayersPanel.module.css';

interface LayersPanelProps {
  doc: DrawingDocument;
  onDocumentChange: (doc: DrawingDocument) => void;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
  activeLayerId: string;
  onActiveLayerChange: (id: string) => void;
  /** Opens the image picker; the parent turns the result into a raster layer. */
  onAddImageLayer: () => void;
}

function nodeIcon(node: DrawingNode) {
  switch (node.type) {
    case 'stack': return <Folder size={11} />;
    case 'raster': return <ImageIcon size={11} />;
    case 'text': return <Type size={11} />;
    case 'vector': return <LayersIcon size={11} />;
  }
}

function objectIcon(object: VectorObject) {
  switch (object.kind) {
    case 'rect': return <Square size={11} />;
    case 'ellipse': return <Circle size={11} />;
    case 'line': return <Minus size={11} />;
    case 'path': return <Pencil size={11} />;
  }
}

/** What a node is called in the panel when it has no name of its own. */
function nodeLabel(node: DrawingNode): string {
  if (node.name) return node.name;
  return node.type === 'stack' ? 'Group' : 'Layer';
}

export function LayersPanel({
  doc,
  onDocumentChange,
  selection,
  onSelectionChange,
  activeLayerId,
  onActiveLayerChange,
  onAddImageLayer,
}: LayersPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([activeLayerId]));
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addOpen) return;
    const close = (e: MouseEvent) => {
      if (!addMenuRef.current?.contains(e.target as Node)) setAddOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [addOpen]);

  const rows = flattenTree(doc.root).filter(({ node }) => {
    // A node is shown only when every group above it is open.
    let parent = findParent(doc.root, node.id);
    while (parent && parent.id !== doc.root.id) {
      if (!expanded.has(parent.id)) return false;
      parent = findParent(doc.root, parent.id);
    }
    return true;
  });

  const selectedNodeIds = selection?.kind === 'nodes' ? selection.ids : [];
  const selectedObjectIds = selection?.kind === 'objects' ? selection.ids : [];

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function beginRename(node: DrawingNode) {
    setRenamingId(node.id);
    setRenameValue(nodeLabel(node));
    setTimeout(() => renameRef.current?.select(), 0);
  }

  function commitRename() {
    if (renamingId && renameValue.trim()) {
      onDocumentChange(setNodeProps(doc, renamingId, { name: renameValue.trim() }));
    }
    setRenamingId(null);
  }

  function selectNode(node: DrawingNode, additive: boolean) {
    if (node.type === 'vector') onActiveLayerChange(node.id);
    const ids = additive && selection?.kind === 'nodes'
      ? selection.ids.includes(node.id)
        ? selection.ids.filter((id) => id !== node.id)
        : [...selection.ids, node.id]
      : [node.id];
    onSelectionChange(ids.length ? { kind: 'nodes', ids } : null);
  }

  function addLayer() {
    const layer = createVectorLayer(`Layer ${flattenTree(doc.root).length + 1}`);
    onDocumentChange(addNode(doc, layer));
    onActiveLayerChange(layer.id);
    onSelectionChange({ kind: 'nodes', ids: [layer.id] });
    setAddOpen(false);
  }

  function addGroup() {
    const group = createStack('Group');
    onDocumentChange(addNode(doc, group));
    setExpanded((prev) => new Set([...prev, group.id]));
    onSelectionChange({ kind: 'nodes', ids: [group.id] });
    setAddOpen(false);
  }

  function removeNodeAt(id: string) {
    const next = deleteNode(doc, id);
    // The document must always keep somewhere to draw. Deleting the last vector
    // layer would leave every drawing tool with no target and no way back.
    const remaining = flattenTree(next.root).filter((f) => f.node.type === 'vector');
    if (remaining.length === 0) {
      const layer = createVectorLayer('Layer 1');
      onDocumentChange(addNode(next, layer));
      onActiveLayerChange(layer.id);
    } else {
      onDocumentChange(next);
      if (id === activeLayerId) onActiveLayerChange(remaining[0].node.id);
    }
    onSelectionChange(null);
    setConfirmDeleteId(null);
  }

  // ── Drag and drop ────────────────────────────────────────────────

  function handleDrop(targetId: string) {
    setDropTargetId(null);
    const dragged = draggingId;
    setDraggingId(null);
    if (!dragged || dragged === targetId) return;

    const target = findNode(doc.root, targetId);
    if (!target) return;

    // Dropping on a group puts the node inside it, at the top. Dropping on
    // anything else puts it beside that row, in the same parent.
    if (target.type === 'stack') {
      onDocumentChange({ ...doc, root: moveNode(doc.root, dragged, { parentId: target.id, index: 0 }) });
      setExpanded((prev) => new Set([...prev, target.id]));
      return;
    }
    const parent = findParent(doc.root, targetId);
    if (!parent) return;
    const index = parent.children.findIndex((c) => c.id === targetId);
    onDocumentChange({ ...doc, root: moveNode(doc.root, dragged, { parentId: parent.id, index }) });
  }

  // ── Rendering ────────────────────────────────────────────────────

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>Layers</span>
        <div ref={addMenuRef} className={styles.addWrap}>
          <button className={styles.addBtn} onClick={() => setAddOpen((v) => !v)} title="Add layer" aria-label="Add layer">
            <Plus size={13} />
          </button>
          {addOpen && (
            <div className={styles.addMenu} role="menu">
              <button className={styles.addMenuItem} role="menuitem" onClick={addLayer}>
                <LayersIcon size={12} /> New layer
              </button>
              <button className={styles.addMenuItem} role="menuitem" onClick={addGroup}>
                <Folder size={12} /> New group
              </button>
              <button
                className={styles.addMenuItem}
                role="menuitem"
                onClick={() => { setAddOpen(false); onAddImageLayer(); }}
              >
                <ImageIcon size={12} /> Image layer…
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={styles.list}>
        {rows.map(({ node, depth }) => {
          const isSelected = selectedNodeIds.includes(node.id);
          const isActive = node.id === activeLayerId;
          const isOpen = expanded.has(node.id);
          const hasChildren = node.type === 'stack'
            ? node.children.length > 0
            : node.type === 'vector' && node.objects.length > 0;

          return (
            <div
              key={node.id}
              className={`${styles.layerBlock} ${draggingId === node.id ? styles.layerBlockDragging : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDropTargetId(node.id); }}
              onDrop={(e) => { e.preventDefault(); handleDrop(node.id); }}
              onDragEnd={() => { setDraggingId(null); setDropTargetId(null); }}
            >
              <div
                className={[
                  styles.layerRow,
                  isActive ? styles.layerRowActive : '',
                  isSelected ? styles.layerRowSelected : '',
                  dropTargetId === node.id && draggingId ? styles.layerRowDropTarget : '',
                ].filter(Boolean).join(' ')}
                style={{ paddingLeft: 4 + depth * 12 }}
                onClick={(e) => selectNode(node, e.shiftKey || e.metaKey || e.ctrlKey)}
              >
                <span
                  className={styles.layerGrip}
                  draggable
                  onDragStart={(e) => {
                    setDraggingId(node.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', node.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <GripVertical size={11} />
                </span>

                {hasChildren ? (
                  <button
                    className={styles.chevronBtn}
                    onClick={(e) => { e.stopPropagation(); toggleExpanded(node.id); }}
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                  >
                    {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  </button>
                ) : (
                  <span className={styles.layerGripPlaceholder} />
                )}

                <span className={styles.typeIcon}>{nodeIcon(node)}</span>

                {renamingId === node.id ? (
                  <input
                    ref={renameRef}
                    className={styles.renameInput}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <span
                    className={styles.layerName}
                    onDoubleClick={(e) => { e.stopPropagation(); beginRename(node); }}
                    title="Double-click to rename"
                  >
                    {nodeLabel(node)}
                  </span>
                )}

                {node.type === 'vector' && node.objects.length > 0 && (
                  <span className={styles.layerCount}>{node.objects.length}</span>
                )}

                <button
                  className={styles.iconBtn}
                  onClick={(e) => { e.stopPropagation(); onDocumentChange(setNodeProps(doc, node.id, { locked: !node.locked })); }}
                  title={node.locked ? 'Unlock layer' : 'Lock layer'}
                  aria-label={node.locked ? 'Unlock layer' : 'Lock layer'}
                >
                  {node.locked ? <Lock size={11} /> : <Unlock size={11} />}
                </button>
                <button
                  className={styles.iconBtn}
                  onClick={(e) => { e.stopPropagation(); onDocumentChange(setNodeProps(doc, node.id, { visible: !node.visible })); }}
                  title={node.visible ? 'Hide layer' : 'Show layer'}
                  aria-label={node.visible ? 'Hide layer' : 'Show layer'}
                >
                  {node.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                </button>
                {confirmDeleteId !== node.id && (
                  <button
                    className={`${styles.iconBtn} ${styles.deleteBtn}`}
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(node.id); }}
                    title="Delete layer"
                    aria-label="Delete layer"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>

              {confirmDeleteId === node.id && (
                <div className={styles.confirmRow}>
                  <span className={styles.confirmText}>Delete “{nodeLabel(node)}”?</span>
                  <button className={styles.confirmYes} onClick={() => removeNodeAt(node.id)}>Delete</button>
                  <button className={styles.confirmNo} onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                </div>
              )}

              {/* The properties strip: opacity and blend mode, shown for the
                  selected layer only, so the panel stays a list rather than a
                  wall of controls. */}
              {isSelected && (
                <div className={styles.propsRow} style={{ paddingLeft: 16 + depth * 12 }}>
                  <label className={styles.propLabel}>
                    Blend
                    <select
                      className={styles.blendSelect}
                      value={node.blendMode}
                      aria-label="Blend mode"
                      onChange={(e) => onDocumentChange(setNodeProps(doc, node.id, { blendMode: e.target.value as BlendMode }))}
                    >
                      {BLEND_MODES.map((mode) => (
                        <option key={mode} value={mode}>{BLEND_MODE_LABELS[mode]}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.propLabel}>
                    Opacity
                    <input
                      className={styles.opacityInput}
                      type="range"
                      min={0}
                      max={100}
                      aria-label="Layer opacity"
                      value={Math.round(node.opacity * 100)}
                      onChange={(e) => onDocumentChange(setNodeProps(doc, node.id, { opacity: Number(e.target.value) / 100 }))}
                    />
                    <span className={styles.propValue}>{Math.round(node.opacity * 100)}%</span>
                  </label>
                </div>
              )}

              {node.type === 'vector' && isOpen && node.objects.map((object) => {
                const objectSelected = selection?.kind === 'objects'
                  && selection.layerId === node.id
                  && selectedObjectIds.includes(object.id);
                return (
                  <div
                    key={object.id}
                    className={`${styles.shapeRow} ${objectSelected ? styles.shapeRowSelected : ''}`}
                    style={{ paddingLeft: 28 + depth * 12 }}
                    onClick={(e) => {
                      onActiveLayerChange(node.id);
                      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
                      const existing = selection?.kind === 'objects' && selection.layerId === node.id
                        ? selection.ids
                        : [];
                      const ids = additive
                        ? existing.includes(object.id)
                          ? existing.filter((id) => id !== object.id)
                          : [...existing, object.id]
                        : [object.id];
                      onSelectionChange(ids.length ? { kind: 'objects', layerId: node.id, ids } : null);
                    }}
                  >
                    <span className={styles.typeIcon}>{objectIcon(object)}</span>
                    <span className={`${styles.shapeName} ${object.visible ? '' : styles.shapeNameFaded}`}>
                      {object.name}
                    </span>
                    <button
                      className={styles.iconBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDocumentChange(patchObjects(doc, node.id, [object.id], { locked: !object.locked }));
                      }}
                      title={object.locked ? 'Unlock' : 'Lock'}
                      aria-label={object.locked ? 'Unlock object' : 'Lock object'}
                    >
                      {object.locked ? <Lock size={10} /> : <Unlock size={10} />}
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDocumentChange(patchObjects(doc, node.id, [object.id], { visible: !object.visible }));
                      }}
                      title={object.visible ? 'Hide' : 'Show'}
                      aria-label={object.visible ? 'Hide object' : 'Show object'}
                    >
                      {object.visible ? <Eye size={10} /> : <EyeOff size={10} />}
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
