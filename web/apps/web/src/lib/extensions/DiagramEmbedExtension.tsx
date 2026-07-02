'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Node, mergeAttributes } from '@tiptap/react';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { diagramsApi } from '@neutrino/api-diagrams';
import { storageApi } from '@/lib/api';
import { decryptFile } from '@neutrino/e2e-crypto';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { EmbeddedDiagramView } from '@/app/(apps)/diagrams/editor/EmbeddedDiagramView';
import type { DiagramDocument, DiagramPage } from '@/app/(apps)/diagrams/types';
import { ColorPicker } from '@neutrino/ui';

// ---------------------------------------------------------------------------
// Properties dialog
// ---------------------------------------------------------------------------

interface EmbedDisplayProps {
  width: number;
  height: number;
  bgColor: string;
  showGrid: boolean;
}

const DIALOG_OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.32)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 10000,
};

const DIALOG_BOX: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: 24, minWidth: 340,
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

function inputStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 5,
    fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
    ...extra,
  };
}

function PropertiesDialog({
  initial,
  onApply,
  onClose,
}: {
  initial: EmbedDisplayProps;
  onApply: (props: EmbedDisplayProps) => void;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(initial.width);
  const [height, setHeight] = useState(initial.height);
  const [bgColor, setBgColor] = useState(initial.bgColor || '#ffffff');
  const [showGrid, setShowGrid] = useState(initial.showGrid);
  const [proportional, setProportional] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [tempColor, setTempColor] = useState(bgColor);
  const aspectRatio = useRef(initial.width / initial.height);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  function openColorPicker() {
    setTempColor(bgColor);
    setColorPickerOpen(true);
  }

  function handleColorSelect() {
    setBgColor(tempColor);
    setColorPickerOpen(false);
  }

  function handleColorCancel() {
    setColorPickerOpen(false);
  }

  useEffect(() => {
    if (!colorPickerOpen) return;
    function handle(e: MouseEvent) {
      if (swatchRef.current?.contains(e.target as globalThis.Node)) return;
      if (pickerRef.current?.contains(e.target as globalThis.Node)) return;
      setColorPickerOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [colorPickerOpen]);

  function clampWidth(v: number) { return Math.max(100, Math.min(1200, v)); }
  function clampHeight(v: number) { return Math.max(100, Math.min(800, v)); }

  function handleWidthChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    setWidth(v);
    if (proportional) setHeight(Math.round(v / aspectRatio.current));
  }

  function handleHeightChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value);
    setHeight(v);
    if (proportional) setWidth(Math.round(v * aspectRatio.current));
  }

  function handleWidthBlur(e: React.FocusEvent<HTMLInputElement>) {
    const parsed = parseInt(e.target.value, 10);
    const clamped = clampWidth(isNaN(parsed) ? width : parsed);
    setWidth(clamped);
    if (proportional) setHeight(Math.round(clamped / aspectRatio.current));
  }

  function handleHeightBlur(e: React.FocusEvent<HTMLInputElement>) {
    const parsed = parseInt(e.target.value, 10);
    const clamped = clampHeight(isNaN(parsed) ? height : parsed);
    setHeight(clamped);
    if (proportional) setWidth(Math.round(clamped * aspectRatio.current));
  }

  function handleProportionalChange(checked: boolean) {
    setProportional(checked);
    if (checked) aspectRatio.current = width / height;
  }

  function handleApply() {
    onApply({ width, height, bgColor, showGrid });
    onClose();
  }

  return (
    <div style={DIALOG_OVERLAY} onMouseDown={onClose}>
      <div style={DIALOG_BOX} onMouseDown={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 18px', fontSize: 15, fontWeight: 600, color: '#0f172a' }}>
          Diagram Properties
        </h3>

        {/* Size row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, color: '#374151' }}>
            Width (px)
            <input
              type="number" step={10}
              value={width}
              onChange={handleWidthChange}
              onBlur={handleWidthBlur}
              style={inputStyle()}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, color: '#374151' }}>
            Height (px)
            <input
              type="number" step={10}
              value={height}
              onChange={handleHeightChange}
              onBlur={handleHeightBlur}
              style={inputStyle()}
            />
          </label>
        </div>

        {/* Proportional checkbox */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, color: '#374151', marginBottom: 16, cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={proportional}
            onChange={e => handleProportionalChange(e.target.checked)}
            style={{ width: 15, height: 15, cursor: 'pointer' }}
          />
          Proportional
        </label>

        {/* Background color */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 5 }}>Background color</div>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <button
              ref={swatchRef}
              type="button"
              onClick={openColorPicker}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', border: '1px solid #e2e8f0', borderRadius: 5,
                fontSize: 13, cursor: 'pointer', background: '#fff', color: '#374151',
              }}
            >
              <span style={{
                display: 'inline-block', width: 16, height: 16, borderRadius: 3,
                background: bgColor, border: '1px solid rgba(0,0,0,0.15)', flexShrink: 0,
              }} />
              {bgColor}
            </button>
            {colorPickerOpen && (
              <div
                ref={pickerRef}
                style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                  zIndex: 1, borderRadius: 8,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                  overflow: 'hidden',
                }}
              >
                <ColorPicker value={tempColor} onChange={setTempColor} />
                <div style={{
                  display: 'flex', justifyContent: 'flex-end', gap: 6,
                  padding: '8px 10px',
                  background: '#fff',
                  borderTop: '1px solid #e2e8f0',
                }}>
                  <button
                    type="button"
                    onClick={handleColorCancel}
                    style={{
                      padding: '4px 14px', border: '1px solid #e2e8f0', borderRadius: 5,
                      background: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleColorSelect}
                    style={{
                      padding: '4px 14px', border: 'none', borderRadius: 5,
                      background: '#2563eb', color: '#fff', fontSize: 12,
                      cursor: 'pointer', fontWeight: 500,
                    }}
                  >
                    Select
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Grid toggle */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, color: '#374151', marginBottom: 22, cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={showGrid}
            onChange={e => setShowGrid(e.target.checked)}
            style={{ width: 15, height: 15, cursor: 'pointer' }}
          />
          Show gridlines
        </label>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px', border: '1px solid #e2e8f0', borderRadius: 5,
              background: '#fff', fontSize: 13, cursor: 'pointer', color: '#374151',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            style={{
              padding: '6px 16px', border: 'none', borderRadius: 5,
              background: '#2563eb', color: '#fff', fontSize: 13, cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node view
// ---------------------------------------------------------------------------

function DiagramEmbedNodeView({ node, deleteNode, updateAttributes }: ReactNodeViewProps) {
  const rawAttrs = node.attrs as Record<string, string | null>;
  const { diagramId, pageIndex: pageIndexAttr, title } = rawAttrs;
  const pageIndex = parseInt(pageIndexAttr ?? '0', 10) || 0;
  const width  = parseInt(rawAttrs.width  ?? '480', 10) || 480;
  const height = parseInt(rawAttrs.height ?? '280', 10) || 280;
  const bgColor  = rawAttrs.bgColor  ?? '#ffffff';
  const showGrid = rawAttrs.showGrid === 'true';

  const [page, setPage] = useState<DiagramPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showProps, setShowProps] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Resolve the DEK so we can decrypt E2EE diagram content, mirroring DiagramEditor.
  const { dekRef, dekResolved } = useEncryptedDocumentContent({
    id: diagramId ?? '',
    filename: 'diagram.json',
  });

  useEffect(() => {
    if (!diagramId || !dekResolved) return;
    let cancelled = false;
    diagramsApi.getDiagram(diagramId)
      .then(async (meta) => {
        if (cancelled) return;
        if (!meta.contentUrl) return;
        let raw: string;
        if (dekRef.current) {
          const blob = await storageApi.downloadFile(diagramId);
          const cipherBytes = new Uint8Array(await blob.arrayBuffer());
          const plainBytes = decryptFile(cipherBytes, dekRef.current);
          raw = new TextDecoder().decode(plainBytes);
        } else {
          const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') ?? '' : '';
          const res = await fetch(meta.contentUrl, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok || cancelled) return;
          raw = await res.text();
        }
        if (cancelled) return;
        const doc = JSON.parse(raw) as DiagramDocument;
        const p = doc.pages[pageIndex] ?? doc.pages[0] ?? null;
        if (!cancelled) setPage(p);
      })
      .catch(() => { if (!cancelled) setError('Could not load diagram'); });
    return () => { cancelled = true; };
  }, [diagramId, pageIndex, dekResolved]);

  // Close context menu on any outside click.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  function handleApplyProps(props: EmbedDisplayProps) {
    updateAttributes({
      width:    String(props.width),
      height:   String(props.height),
      bgColor:  props.bgColor,
      showGrid: String(props.showGrid),
    });
  }

  return (
    <NodeViewWrapper data-type="diagram-embed" data-diagram-embed="">
      <div
        style={{ margin: '8px 0', position: 'relative', display: 'inline-block' }}
        onContextMenu={handleContextMenu}
      >
        {error ? (
          <div style={{ padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, color: '#64748b' }}>
            {error}
          </div>
        ) : page ? (
          <EmbeddedDiagramView
            page={page}
            width={width}
            height={height}
            diagramId={diagramId ?? undefined}
            bgColor={bgColor}
            showGrid={showGrid}
          />
        ) : (
          <div style={{ padding: '12px 16px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, color: '#94a3b8' }}>
            {title ? `Loading diagram: ${title}…` : 'Loading diagram…'}
          </div>
        )}

        {/* Remove button */}
        <button
          onClick={deleteNode}
          style={{
            position: 'absolute', top: 4, right: 4,
            background: 'rgba(255,255,255,0.9)', border: '1px solid #e2e8f0',
            borderRadius: 4, padding: '2px 6px', fontSize: 11, cursor: 'pointer', color: '#64748b',
          }}
          title="Remove"
        >
          ✕
        </button>

        {/* Context menu */}
        {contextMenu && (
          <div
            ref={menuRef}
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'fixed', top: contextMenu.y, left: contextMenu.x,
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7,
              boxShadow: '0 4px 16px rgba(0,0,0,0.13)', padding: '4px 0',
              zIndex: 9999, minWidth: 150,
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            <button
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '7px 16px', border: 'none', background: 'none',
                fontSize: 13, cursor: 'pointer', color: '#1e293b',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f1f5f9'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
              onMouseDown={e => {
                e.stopPropagation();
                setContextMenu(null);
                setShowProps(true);
              }}
            >
              Properties…
            </button>
          </div>
        )}
      </div>

      {/* Properties dialog — rendered outside the positioned wrapper so it's not clipped */}
      {showProps && (
        <PropertiesDialog
          initial={{ width, height, bgColor, showGrid }}
          onApply={handleApplyProps}
          onClose={() => setShowProps(false)}
        />
      )}
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// TipTap node definition
// ---------------------------------------------------------------------------

export const DiagramEmbedExtension = Node.create({
  name: 'diagramEmbed',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      diagramId:  { default: null },
      pageIndex:  { default: '0' },
      title:      { default: null },
      width:      { default: '480' },
      height:     { default: '280' },
      bgColor:    { default: '#ffffff' },
      showGrid:   { default: 'false' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="diagram-embed"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes as Record<string, string>, { 'data-type': 'diagram-embed' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DiagramEmbedNodeView as React.ComponentType<ReactNodeViewProps>);
  },
});
