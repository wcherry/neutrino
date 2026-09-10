'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, Lock, Unlock } from 'lucide-react';
import { ColorPickerPopover, FillPicker, type Background, type DriveImageItem } from '@neutrino/ui';

import { findNode } from './document/tree';
import {
  mapObjects,
  patchObjects,
  patchObjectStyle,
  patchTextLayer,
  setCanvas,
  setGrid,
} from './document/edits';
import { dashPattern } from './render/vectorObject';
import { useAvailableFonts } from '@/hooks/useAvailableFonts';
import type {
  DrawingDocument,
  DrawingNode,
  Selection,
  StrokeStyle,
  VectorObject,
  VectorStyle,
} from './types';
import styles from './StylePanel.module.css';

interface StylePanelProps {
  doc: DrawingDocument;
  onDocumentChange: (doc: DrawingDocument) => void;
  selection: Selection;
  /** The style newly drawn shapes take, kept in step with the last edit. */
  newObjectStyle: VectorStyle;
  onNewObjectStyleChange: (style: VectorStyle) => void;
  onFetchDriveImages?: () => Promise<DriveImageItem[]>;
}

const STROKE_STYLES: { value: StrokeStyle; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'long-dash', label: 'Long dash' },
];

const FONT_FAMILIES = [
  { value: 'sans-serif', label: 'Sans-serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Times New Roman', serif", label: 'Times New Roman' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: "'Courier New', monospace", label: 'Courier New' },
];

function LinePreview({ dash, width }: { dash: number[]; width: number }) {
  return (
    <svg width="44" height="10" viewBox="0 0 44 10" style={{ display: 'block', flexShrink: 0 }}>
      <line
        x1="2" y1="5" x2="42" y2="5"
        stroke="currentColor"
        strokeWidth={Math.min(width, 3)}
        strokeDasharray={dash.length ? dash.join(' ') : undefined}
        strokeLinecap="round"
      />
    </svg>
  );
}

function LineStylePicker({ value, strokeWidth, onChange }: {
  value: StrokeStyle;
  strokeWidth: number;
  onChange: (value: StrokeStyle) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const current = STROKE_STYLES.find((s) => s.value === value) ?? STROKE_STYLES[0];
  const width = Math.min(strokeWidth || 2, 3);

  return (
    <div ref={ref} className={styles.lineStyleWrap}>
      <button className={styles.lineStyleBtn} onClick={() => setOpen((v) => !v)} aria-label="Stroke style">
        <LinePreview dash={dashPattern(current.value, width)} width={width} />
        <span className={styles.lineStyleLabel}>{current.label}</span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className={styles.lineStyleDropdown}>
          {STROKE_STYLES.map((style) => (
            <button
              key={style.value}
              className={`${styles.lineStyleOption} ${value === style.value ? styles.lineStyleOptionActive : ''}`}
              onClick={() => { onChange(style.value); setOpen(false); }}
            >
              <LinePreview dash={dashPattern(style.value, width)} width={width} />
              <span className={styles.lineStyleLabel}>{style.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function fillToBackground(fill: string): Background {
  if (/^(linear|radial)-gradient/i.test(fill)) return { type: 'gradient', value: fill };
  if (/^url\(/i.test(fill)) return { type: 'image', value: fill.slice(4, -1) };
  return { type: 'color', value: fill === 'none' || fill === 'transparent' ? '#ffffff' : fill };
}

/**
 * The inspector.
 *
 * What it shows follows what is selected, and the three cases are genuinely
 * different things rather than one form with fields disabled: vector objects
 * have a fill and a stroke, a text layer has a font, and with nothing selected
 * the thing being inspected is the document itself — which is the only place
 * the canvas size can be changed, and a fixed-size canvas needs one.
 */
export function StylePanel({
  doc,
  onDocumentChange,
  selection,
  newObjectStyle,
  onNewObjectStyleChange,
  onFetchDriveImages,
}: StylePanelProps) {
  const { customFontFamilies } = useAvailableFonts();

  if (selection?.kind === 'objects') {
    const layer = findNode(doc.root, selection.layerId);
    if (layer?.type !== 'vector') return null;
    const chosen = layer.objects.filter((o) => selection.ids.includes(o.id));
    if (chosen.length === 0) return null;
    return (
      <ObjectStyle
        doc={doc}
        onDocumentChange={onDocumentChange}
        layerId={selection.layerId}
        objects={chosen}
        onNewObjectStyleChange={onNewObjectStyleChange}
        onFetchDriveImages={onFetchDriveImages}
      />
    );
  }

  if (selection?.kind === 'nodes' && selection.ids.length === 1) {
    const node = findNode(doc.root, selection.ids[0]);
    if (node?.type === 'text') {
      return (
        <TextStyle
          doc={doc}
          onDocumentChange={onDocumentChange}
          node={node}
          fontFamilies={[...FONT_FAMILIES, ...customFontFamilies]}
        />
      );
    }
    if (node) return <LayerInfo node={node} />;
  }

  return (
    <CanvasStyle
      doc={doc}
      onDocumentChange={onDocumentChange}
      newObjectStyle={newObjectStyle}
      onNewObjectStyleChange={onNewObjectStyleChange}
    />
  );
}

// ---------------------------------------------------------------------------
// Vector objects
// ---------------------------------------------------------------------------

function ObjectStyle({
  doc,
  onDocumentChange,
  layerId,
  objects,
  onNewObjectStyleChange,
  onFetchDriveImages,
}: {
  doc: DrawingDocument;
  onDocumentChange: (doc: DrawingDocument) => void;
  layerId: string;
  objects: VectorObject[];
  onNewObjectStyleChange: (style: VectorStyle) => void;
  onFetchDriveImages?: () => Promise<DriveImageItem[]>;
}) {
  const ids = objects.map((o) => o.id);
  const first = objects[0];
  const { style } = first;
  const anyLocked = objects.some((o) => o.locked);
  const allLines = objects.every((o) => o.kind === 'line');
  const allRects = objects.every((o) => o.kind === 'rect');
  const fillable = objects.some((o) => o.kind === 'rect' || o.kind === 'ellipse' || o.kind === 'path');

  /** Applies a style change and remembers it for the next shape drawn. */
  function changeStyle(patch: Partial<VectorStyle>) {
    onDocumentChange(patchObjectStyle(doc, layerId, ids, patch));
    onNewObjectStyleChange({ ...style, ...patch });
  }

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          {objects.length === 1 ? first.name : `${objects.length} objects`}
        </div>

        {fillable && (
          <div className={styles.row}>
            <span className={styles.label}>Fill</span>
            <div className={styles.colorCell}>
              <FillPicker
                background={fillToBackground(style.fill)}
                onChange={(bg) => changeStyle({ fill: bg.type === 'image' ? `url(${bg.value})` : bg.value })}
                presetsKey="neutrino:drawing:fillPresets"
                triggerLabel=""
                onFetchDriveImages={onFetchDriveImages}
              />
              <button className={styles.clearBtn} onClick={() => changeStyle({ fill: 'none' })} title="No fill">
                ∅
              </button>
            </div>
          </div>
        )}

        <div className={styles.row}>
          <span className={styles.label}>Stroke</span>
          <ColorPickerPopover
            color={style.stroke}
            onChange={(hex) => changeStyle({ stroke: hex })}
            title="Stroke colour"
            showAlpha
          >
            <span className={styles.colorSwatch} style={{ background: style.stroke }} />
          </ColorPickerPopover>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Width</span>
          <input
            type="number"
            min={0}
            max={64}
            value={style.strokeWidth}
            aria-label="Stroke width"
            className={styles.numberInput}
            onChange={(e) => {
              const value = Math.max(0, Math.min(64, Number(e.target.value)));
              if (!Number.isNaN(value)) changeStyle({ strokeWidth: value });
            }}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Style</span>
          <LineStylePicker
            value={style.strokeStyle}
            strokeWidth={style.strokeWidth}
            onChange={(value) => changeStyle({ strokeStyle: value })}
          />
        </div>
      </div>

      {allRects && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Rectangle</div>
          <div className={styles.row}>
            <span className={styles.label}>Corners</span>
            <input
              type="number"
              min={0}
              max={512}
              aria-label="Corner radius"
              className={styles.numberInput}
              value={first.kind === 'rect' ? first.cornerRadius : 0}
              onChange={(e) => {
                const radius = Math.max(0, Number(e.target.value) || 0);
                onDocumentChange(mapObjects(doc, layerId, ids, (object) =>
                  object.kind === 'rect' ? { ...object, cornerRadius: radius } : object));
              }}
            />
          </div>
        </div>
      )}

      {allLines && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Ends</div>
          <div className={styles.row}>
            <span className={styles.label}>Start arrow</span>
            <input
              type="checkbox"
              className={styles.shadowToggle}
              aria-label="Arrowhead at the start"
              checked={first.kind === 'line' ? first.arrowStart : false}
              onChange={(e) => onDocumentChange(mapObjects(doc, layerId, ids, (object) =>
                object.kind === 'line' ? { ...object, arrowStart: e.target.checked } : object))}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.label}>End arrow</span>
            <input
              type="checkbox"
              className={styles.shadowToggle}
              aria-label="Arrowhead at the end"
              checked={first.kind === 'line' ? first.arrowEnd : false}
              onChange={(e) => onDocumentChange(mapObjects(doc, layerId, ids, (object) =>
                object.kind === 'line' ? { ...object, arrowEnd: e.target.checked } : object))}
            />
          </div>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Object</div>
        <div className={styles.row}>
          <span className={styles.label}>Opacity</span>
          <input
            type="range"
            min={0}
            max={100}
            aria-label="Object opacity"
            className={styles.rangeInput}
            value={Math.round(first.opacity * 100)}
            onChange={(e) => onDocumentChange(patchObjects(doc, layerId, ids, { opacity: Number(e.target.value) / 100 }))}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Rotation</span>
          <input
            type="number"
            min={-360}
            max={360}
            aria-label="Rotation"
            className={styles.numberInput}
            value={Math.round(first.rotation)}
            onChange={(e) => onDocumentChange(patchObjects(doc, layerId, ids, { rotation: Number(e.target.value) || 0 }))}
          />
        </div>
        <div className={styles.iconRow}>
          <button
            className={`${styles.iconBtn} ${anyLocked ? styles.iconBtnActive : ''}`}
            onClick={() => onDocumentChange(patchObjects(doc, layerId, ids, { locked: !anyLocked }))}
          >
            {anyLocked ? <Lock size={14} /> : <Unlock size={14} />}
            <span>{anyLocked ? 'Locked' : 'Lock'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text layers
// ---------------------------------------------------------------------------

function TextStyle({
  doc,
  onDocumentChange,
  node,
  fontFamilies,
}: {
  doc: DrawingDocument;
  onDocumentChange: (doc: DrawingDocument) => void;
  node: Extract<DrawingNode, { type: 'text' }>;
  fontFamilies: { value: string; label: string }[];
}) {
  function patch(fields: Partial<Extract<DrawingNode, { type: 'text' }>>) {
    onDocumentChange(patchTextLayer(doc, node.id, fields));
  }

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Text</div>

        <div className={styles.row}>
          <span className={styles.label}>Font</span>
          <select
            className={styles.select}
            aria-label="Font family"
            value={node.fontFamily}
            onChange={(e) => patch({ fontFamily: e.target.value })}
          >
            {fontFamilies.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
            ))}
          </select>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Size</span>
          <input
            type="number"
            min={4}
            max={512}
            aria-label="Font size"
            className={styles.numberInput}
            value={node.fontSize}
            onChange={(e) => patch({ fontSize: Math.max(4, Number(e.target.value) || 4) })}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Weight</span>
          <select
            className={styles.select}
            aria-label="Font weight"
            value={node.fontWeight}
            onChange={(e) => patch({ fontWeight: Number(e.target.value) })}
          >
            {[300, 400, 500, 600, 700, 800].map((weight) => (
              <option key={weight} value={weight}>{weight}</option>
            ))}
          </select>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Italic</span>
          <input
            type="checkbox"
            className={styles.shadowToggle}
            aria-label="Italic"
            checked={node.italic}
            onChange={(e) => patch({ italic: e.target.checked })}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Align</span>
          <div className={styles.segmented}>
            {([
              ['left', AlignLeft, 'Align left'],
              ['center', AlignCenter, 'Align centre'],
              ['right', AlignRight, 'Align right'],
            ] as const).map(([value, Icon, label]) => (
              <button
                key={value}
                className={`${styles.segmentedBtn} ${node.align === value ? styles.segmentedBtnActive : ''}`}
                onClick={() => patch({ align: value })}
                aria-label={label}
                aria-pressed={node.align === value}
              >
                <Icon size={12} />
              </button>
            ))}
          </div>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Line height</span>
          <input
            type="number"
            min={0.5}
            max={5}
            step={0.1}
            aria-label="Line height"
            className={styles.numberInput}
            value={node.lineHeight}
            onChange={(e) => patch({ lineHeight: Math.max(0.5, Number(e.target.value) || 1.2) })}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Colour</span>
          <ColorPickerPopover
            color={node.color}
            onChange={(hex) => patch({ color: hex })}
            title="Text colour"
            showAlpha
          >
            <span className={styles.colorSwatch} style={{ background: node.color }} />
          </ColorPickerPopover>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Other layer types
// ---------------------------------------------------------------------------

function LayerInfo({ node }: { node: DrawingNode }) {
  const kind = node.type === 'raster' ? 'Image layer'
    : node.type === 'stack' ? 'Group'
    : 'Layer';
  const size = node.type === 'raster'
    ? `${Math.round(node.source.width)} × ${Math.round(node.source.height)} px`
    : null;

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{kind}</div>
        <div className={styles.row}>
          <span className={styles.label}>Name</span>
          <span className={styles.readonlyValue}>{node.name}</span>
        </div>
        {size && (
          <div className={styles.row}>
            <span className={styles.label}>Size</span>
            <span className={styles.readonlyValue}>{size}</span>
          </div>
        )}
        <p className={styles.hint}>
          Opacity, blend mode, visibility and lock are in the Layers panel.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

function CanvasStyle({
  doc,
  onDocumentChange,
  newObjectStyle,
  onNewObjectStyleChange,
}: {
  doc: DrawingDocument;
  onDocumentChange: (doc: DrawingDocument) => void;
  newObjectStyle: VectorStyle;
  onNewObjectStyleChange: (style: VectorStyle) => void;
}) {
  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Canvas</div>

        <div className={styles.row}>
          <span className={styles.label}>Width</span>
          <input
            type="number"
            min={1}
            max={30000}
            aria-label="Canvas width"
            className={styles.numberInput}
            value={doc.canvas.width}
            onChange={(e) => onDocumentChange(setCanvas(doc, { width: Math.max(1, Number(e.target.value) || 1) }))}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Height</span>
          <input
            type="number"
            min={1}
            max={30000}
            aria-label="Canvas height"
            className={styles.numberInput}
            value={doc.canvas.height}
            onChange={(e) => onDocumentChange(setCanvas(doc, { height: Math.max(1, Number(e.target.value) || 1) }))}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Resolution</span>
          <input
            type="number"
            min={1}
            max={2400}
            aria-label="Canvas resolution in DPI"
            className={styles.numberInput}
            value={doc.canvas.dpi}
            onChange={(e) => onDocumentChange(setCanvas(doc, { dpi: Math.max(1, Number(e.target.value) || 96) }))}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Background</span>
          <div className={styles.colorCell}>
            <ColorPickerPopover
              color={doc.canvas.background ?? '#ffffff'}
              onChange={(hex) => onDocumentChange(setCanvas(doc, { background: hex }))}
              title="Canvas background"
            >
              <span
                className={styles.colorSwatch}
                style={{ background: doc.canvas.background ?? 'transparent' }}
              />
            </ColorPickerPopover>
            <button
              className={styles.clearBtn}
              onClick={() => onDocumentChange(setCanvas(doc, { background: null }))}
              title="Transparent background"
            >
              ∅
            </button>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Grid</div>
        <div className={styles.row}>
          <span className={styles.label}>Size</span>
          <input
            type="number"
            min={1}
            max={512}
            aria-label="Grid size"
            className={styles.numberInput}
            value={doc.grid.size}
            onChange={(e) => onDocumentChange(setGrid(doc, { size: Math.max(1, Number(e.target.value) || 1) }))}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Snap</span>
          <input
            type="checkbox"
            className={styles.shadowToggle}
            aria-label="Snap to grid"
            checked={doc.grid.snap}
            onChange={(e) => onDocumentChange(setGrid(doc, { snap: e.target.checked }))}
          />
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Default style</div>
        <p className={styles.hint}>Applied to the next shape you draw.</p>
        <div className={styles.row}>
          <span className={styles.label}>Stroke</span>
          <ColorPickerPopover
            color={newObjectStyle.stroke}
            onChange={(hex) => onNewObjectStyleChange({ ...newObjectStyle, stroke: hex })}
            title="Default stroke"
            showAlpha
          >
            <span className={styles.colorSwatch} style={{ background: newObjectStyle.stroke }} />
          </ColorPickerPopover>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Width</span>
          <input
            type="number"
            min={0}
            max={64}
            aria-label="Default stroke width"
            className={styles.numberInput}
            value={newObjectStyle.strokeWidth}
            onChange={(e) => onNewObjectStyleChange({
              ...newObjectStyle,
              strokeWidth: Math.max(0, Number(e.target.value) || 0),
            })}
          />
        </div>
      </div>
    </div>
  );
}
