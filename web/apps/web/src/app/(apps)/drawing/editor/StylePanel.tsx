'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  ChevronUp,
  Lock,
  RefreshCw,
  Trash2,
  Unlock,
} from 'lucide-react';
import { ColorPickerPopover, FillPicker, type Background, type DriveImageItem } from '@neutrino/ui';

import { findNode, flattenTree } from './document/tree';
import {
  addFilter,
  mapObjects,
  patchAdjustment,
  patchFilter,
  patchObjects,
  patchObjectStyle,
  patchTextLayer,
  patchTextPath,
  removeFilter,
  reorderFilter,
  setCanvas,
  setColorProfile,
  setGrid,
  setHdr,
  setSnap,
  setTextPath,
  setWorkspace,
} from './document/edits';
import { ADJUSTMENT_LABELS } from './document/adjustments';
import { describeAssetSource, findAsset } from './document/assets';
import {
  COLOR_SPACE_LABELS,
  DEFAULT_HDR,
  canvasSupportsColorSpace,
  type ColorSpaceName,
} from './document/color';
import { FILTER_KINDS, FILTER_LABELS, createFilter, type FilterKind } from './document/filters';
import {
  RULER_UNITS,
  RULER_UNIT_LABELS,
  workspaceOf,
  type RulerUnit,
} from './document/workspace';
import { iccDataUrl, parseIccProfile } from './io/icc';
import { dashPattern } from './render/vectorObject';
import { useAvailableFonts } from '@/hooks/useAvailableFonts';
import { BrushPanel } from './BrushPanel';
import { isPaintTool, type ToolType } from './types';
import type { BrushSettings } from './paint';
import type {
  AdjustmentLayerNode,
  AdjustmentSpec,
  DrawingDocument,
  DrawingNode,
  FilterSpec,
  PathObject,
  Selection,
  StrokeStyle,
  TextLayerNode,
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
  /** The armed tool — a paint tool replaces the panel with the brush settings. */
  tool: ToolType;
  brush: BrushSettings;
  onBrushChange: (brush: BrushSettings) => void;
  maskEditing: boolean;
  onMaskEditingChange: (value: boolean) => void;
  /** The layer a brush stroke would land in. */
  activeLayerId: string;
  /**
   * Re-fetches a linked asset and replaces the layer's pixels with it.
   *
   * A callback rather than something this panel does, because reloading means
   * fetching, decoding and re-encoding — which is the editor's business, and
   * which `@neutrino/ui`-style presentation components here do not do.
   */
  onReloadAsset?: (assetId: string) => void;
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
  tool,
  brush,
  onBrushChange,
  maskEditing,
  onMaskEditingChange,
  activeLayerId,
  onReloadAsset,
}: StylePanelProps) {
  const { customFontFamilies } = useAvailableFonts();

  // A paint tool takes the whole panel. What is *selected* has no bearing on
  // what a brush does — it paints into the active layer either way — so showing
  // the selected object's fill beside the brush would offer two colours and no
  // way to tell which one the next stroke uses.
  if (isPaintTool(tool)) {
    const target = findNode(doc.root, activeLayerId);
    return (
      <BrushPanel
        brush={brush}
        onBrushChange={onBrushChange}
        maskEditing={maskEditing}
        onMaskEditingChange={onMaskEditingChange}
        canEditMask={Boolean(target?.mask?.source)}
        targetLabel={target?.type === 'raster' ? target.name : null}
      />
    );
  }

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

  // A single node — a layer rather than a shape inside one. Every kind gets its
  // own sections *plus* the filter stack, because a filter is a property of a
  // node and applies to all of them: a blurred group and a blurred image layer
  // are the same feature.
  if (selection?.kind === 'nodes' && selection.ids.length === 1) {
    const node = findNode(doc.root, selection.ids[0]);
    if (node) {
      return (
        <div className={styles.panel}>
          {node.type === 'text' && (
            <TextStyle
              doc={doc}
              onDocumentChange={onDocumentChange}
              node={node}
              fontFamilies={[...FONT_FAMILIES, ...customFontFamilies]}
            />
          )}
          {node.type === 'adjustment' && (
            <AdjustmentStyle doc={doc} onDocumentChange={onDocumentChange} node={node} />
          )}
          {node.type === 'instance' && <InstanceInfo doc={doc} node={node} />}
          {(node.type === 'raster' || node.type === 'vector' || node.type === 'stack') && (
            <LayerInfo doc={doc} node={node} onReloadAsset={onReloadAsset} />
          )}
          {/* Filters over an adjustment layer would have nothing to filter — it
              draws no pixels of its own — so that one kind is left out. */}
          {node.type !== 'adjustment' && (
            <FilterStack doc={doc} onDocumentChange={onDocumentChange} node={node} />
          )}
        </div>
      );
    }
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
    <>
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

      <TextPathStyle doc={doc} onDocumentChange={onDocumentChange} node={node} />
    </>
  );
}

/**
 * Binding a caption to a path.
 *
 * The path is picked from the paths that already exist in the drawing, because
 * that is what the feature *is*: a reference to an ordinary path object, which
 * stays editable and re-flows the text when it is reshaped
 * (`agent_docs/drawing_app_redesign.md` §4). There is deliberately no "draw a
 * curve for this text" button — that would create geometry only the text could
 * reach, which is exactly the design the redesign rejected.
 */
function TextPathStyle({
  doc,
  onDocumentChange,
  node,
}: {
  doc: DrawingDocument;
  onDocumentChange: (doc: DrawingDocument) => void;
  node: TextLayerNode;
}) {
  const paths: { id: string; label: string }[] = [];
  for (const { node: layer } of flattenTree(doc.root)) {
    if (layer.type !== 'vector') continue;
    for (const object of layer.objects) {
      if (object.kind === 'path') paths.push({ id: object.id, label: `${object.name} — ${layer.name}` });
    }
  }

  const binding = node.textPath;

  if (paths.length === 0) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Text on a path</div>
        <p className={styles.hint}>Draw a path with the pen tool to run this text along it.</p>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Text on a path</div>

      <div className={styles.row}>
        <span className={styles.label}>Path</span>
        <select
          className={styles.select}
          aria-label="Path to follow"
          value={binding?.pathId ?? ''}
          onChange={(e) => onDocumentChange(
            e.target.value
              ? setTextPath(doc, node.id, {
                  pathId: e.target.value,
                  startOffset: binding?.startOffset ?? 0,
                  align: binding?.align ?? 'start',
                  baselineOffset: binding?.baselineOffset ?? 0,
                  side: binding?.side ?? 'left',
                })
              : setTextPath(doc, node.id, undefined),
          )}
        >
          <option value="">None — lay out in a box</option>
          {paths.map((path) => (
            <option key={path.id} value={path.id}>{path.label}</option>
          ))}
        </select>
      </div>

      {binding && (
        <>
          <div className={styles.row}>
            <span className={styles.label}>Start</span>
            <input
              type="range"
              min={0}
              max={100}
              aria-label="Start offset along the path"
              className={styles.rangeInput}
              value={Math.round(binding.startOffset)}
              onChange={(e) => onDocumentChange(patchTextPath(doc, node.id, { startOffset: Number(e.target.value) }))}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Align</span>
            <select
              className={styles.select}
              aria-label="Alignment along the path"
              value={binding.align}
              onChange={(e) => onDocumentChange(patchTextPath(doc, node.id, {
                align: e.target.value as 'start' | 'middle' | 'end',
              }))}
            >
              <option value="start">Start</option>
              <option value="middle">Middle</option>
              <option value="end">End</option>
            </select>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Baseline</span>
            <input
              type="number"
              min={-400}
              max={400}
              aria-label="Baseline offset from the path"
              className={styles.numberInput}
              value={Math.round(binding.baselineOffset)}
              onChange={(e) => onDocumentChange(patchTextPath(doc, node.id, {
                baselineOffset: Number(e.target.value) || 0,
              }))}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Side</span>
            <select
              className={styles.select}
              aria-label="Side of the path"
              value={binding.side}
              onChange={(e) => onDocumentChange(patchTextPath(doc, node.id, {
                side: e.target.value as 'left' | 'right',
              }))}
            >
              <option value="left">Along the path</option>
              <option value="right">Reversed</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
}

/** What an instance is, and how many copies share its definition. */
function InstanceInfo({ doc, node }: { doc: DrawingDocument; node: Extract<DrawingNode, { type: 'instance' }> }) {
  const symbol = (doc.symbols ?? []).find((s) => s.id === node.symbolId);
  let count = 0;
  for (const { node: candidate } of flattenTree(doc.root)) {
    if (candidate.type === 'instance' && candidate.symbolId === node.symbolId) count++;
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Symbol instance</div>
      <div className={styles.row}>
        <span className={styles.label}>Symbol</span>
        <span className={styles.readonlyValue}>{symbol?.name ?? 'Missing'}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Instances</span>
        <span className={styles.readonlyValue}>{count}</span>
      </div>
      <p className={styles.hint}>
        Editing the symbol changes every instance. Detach one from the Layers panel to
        edit it on its own.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

/** A labelled slider. Most of an adjustment panel is these. */
function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <input
        type="range"
        className={styles.rangeInput}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={styles.propValue}>{format ? format(value) : Math.round(value)}</span>
    </div>
  );
}

/**
 * The sliders for one adjustment.
 *
 * Every kind gets the controls its own parameters need rather than a generic
 * key/value list, because the *ranges* are what make an adjustment usable — an
 * exposure runs in stops from −5 to 5, a levels input point in bytes from 0 to
 * 255, and a single "number" field for both makes neither of them draggable.
 *
 * The curves editor here is the one deliberate simplification: it exposes the
 * black, midpoint and white handles as three sliders rather than a draggable
 * graph. The model stores arbitrary control points and reads them back, so a
 * curve authored elsewhere round-trips through the file untouched; what is not
 * yet built is the canvas to drag a fourth point onto.
 */
function AdjustmentStyle({
  doc,
  onDocumentChange,
  node,
}: {
  doc: DrawingDocument;
  onDocumentChange: (doc: DrawingDocument) => void;
  node: AdjustmentLayerNode;
}) {
  const spec = node.adjustment;
  const patch = (fields: Partial<AdjustmentSpec>) =>
    onDocumentChange(patchAdjustment(doc, node.id, fields));

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{ADJUSTMENT_LABELS[spec.kind]}</div>

      {spec.kind === 'brightness-contrast' && (
        <>
          <Slider label="Bright" value={spec.brightness} min={-100} max={100}
            onChange={(brightness) => patch({ brightness })} />
          <Slider label="Contrast" value={spec.contrast} min={-100} max={100}
            onChange={(contrast) => patch({ contrast })} />
        </>
      )}

      {spec.kind === 'levels' && (
        <>
          <Slider label="Black" value={spec.inputBlack} min={0} max={255}
            onChange={(inputBlack) => patch({ inputBlack })} />
          <Slider label="Gamma" value={spec.gamma} min={0.1} max={4} step={0.01}
            onChange={(gamma) => patch({ gamma })} format={(v) => v.toFixed(2)} />
          <Slider label="White" value={spec.inputWhite} min={0} max={255}
            onChange={(inputWhite) => patch({ inputWhite })} />
          <Slider label="Out min" value={spec.outputBlack} min={0} max={255}
            onChange={(outputBlack) => patch({ outputBlack })} />
          <Slider label="Out max" value={spec.outputWhite} min={0} max={255}
            onChange={(outputWhite) => patch({ outputWhite })} />
        </>
      )}

      {spec.kind === 'curves' && (
        <CurvesControls spec={spec} onPatch={patch} />
      )}

      {spec.kind === 'hue-saturation' && (
        <>
          <Slider label="Hue" value={spec.hue} min={-180} max={180}
            onChange={(hue) => patch({ hue })} format={(v) => `${Math.round(v)}°`} />
          <Slider label="Sat" value={spec.saturation} min={-100} max={100}
            onChange={(saturation) => patch({ saturation })} />
          <Slider label="Light" value={spec.lightness} min={-100} max={100}
            onChange={(lightness) => patch({ lightness })} />
        </>
      )}

      {spec.kind === 'color-balance' && (
        <>
          <Slider label="Red" value={spec.red} min={-100} max={100} onChange={(red) => patch({ red })} />
          <Slider label="Green" value={spec.green} min={-100} max={100} onChange={(green) => patch({ green })} />
          <Slider label="Blue" value={spec.blue} min={-100} max={100} onChange={(blue) => patch({ blue })} />
          <p className={styles.hint}>Shifts the midtones; highlights and shadows are left alone.</p>
        </>
      )}

      {spec.kind === 'exposure' && (
        <>
          <Slider label="Stops" value={spec.exposure} min={-5} max={5} step={0.05}
            onChange={(exposure) => patch({ exposure })} format={(v) => v.toFixed(2)} />
          <Slider label="Offset" value={spec.offset} min={-0.5} max={0.5} step={0.01}
            onChange={(offset) => patch({ offset })} format={(v) => v.toFixed(2)} />
          <Slider label="Gamma" value={spec.gamma} min={0.1} max={4} step={0.01}
            onChange={(gamma) => patch({ gamma })} format={(v) => v.toFixed(2)} />
        </>
      )}

      {spec.kind === 'grayscale' && (
        <Slider label="Amount" value={spec.amount} min={0} max={100}
          onChange={(amount) => patch({ amount })} format={(v) => `${Math.round(v)}%`} />
      )}

      {spec.kind === 'posterize' && (
        <Slider label="Levels" value={spec.levels} min={2} max={64}
          onChange={(levels) => patch({ levels })} />
      )}

      <p className={styles.hint}>
        Applies to every layer below this one, inside its group. Strength and a mask are in
        the Layers panel.
      </p>
    </div>
  );
}

/**
 * The three handles of a tone curve, as sliders.
 *
 * Black and white move the ends; the midpoint moves a control point halfway
 * along, which is what "brighten the midtones without clipping" means. The
 * three are written back as a three-point curve, so what is stored is the same
 * shape a graph editor would store and nothing about the format assumes there
 * are only three.
 */
function CurvesControls({
  spec,
  onPatch,
}: {
  spec: Extract<AdjustmentSpec, { kind: 'curves' }>;
  onPatch: (fields: Partial<AdjustmentSpec>) => void;
}) {
  const sorted = [...spec.points].sort((a, b) => a.x - b.x);
  const black = sorted[0] ?? { x: 0, y: 0 };
  const white = sorted[sorted.length - 1] ?? { x: 255, y: 255 };
  const mid = sorted.length > 2 ? sorted[Math.floor(sorted.length / 2)] : { x: 128, y: 128 };

  const write = (next: { black?: number; mid?: number; white?: number }) => {
    onPatch({
      points: [
        { x: 0, y: next.black ?? black.y },
        { x: 128, y: next.mid ?? mid.y },
        { x: 255, y: next.white ?? white.y },
      ],
    });
  };

  return (
    <>
      <div className={styles.row}>
        <span className={styles.label}>Channel</span>
        <select
          className={styles.select}
          aria-label="Curve channel"
          value={spec.channel}
          onChange={(e) => onPatch({ channel: e.target.value as 'rgb' | 'r' | 'g' | 'b' })}
        >
          <option value="rgb">All channels</option>
          <option value="r">Red</option>
          <option value="g">Green</option>
          <option value="b">Blue</option>
        </select>
      </div>
      <Slider label="Shadows" value={black.y} min={0} max={255} onChange={(v) => write({ black: v })} />
      <Slider label="Mid" value={mid.y} min={0} max={255} onChange={(v) => write({ mid: v })} />
      <Slider label="Highs" value={white.y} min={0} max={255} onChange={(v) => write({ white: v })} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * A layer's filter chain.
 *
 * Ordered, because order is a parameter: sharpening a blur and blurring a
 * sharpen are different pictures. Each row can be disabled rather than only
 * deleted, so a filter can be compared against its own absence without losing
 * the settings that took a minute to find.
 */
function FilterStack({
  doc,
  onDocumentChange,
  node,
}: {
  doc: DrawingDocument;
  onDocumentChange: (doc: DrawingDocument) => void;
  node: DrawingNode;
}) {
  const [adding, setAdding] = useState(false);
  const filters = node.filters ?? [];

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Filters</div>

      {filters.length === 0 && (
        <p className={styles.hint}>None. A filter applies to this layer’s own pixels.</p>
      )}

      {filters.map((filter, index) => (
        <div key={filter.id} className={styles.filterCard}>
          <div className={styles.filterHead}>
            <input
              type="checkbox"
              className={styles.shadowToggle}
              aria-label={`${FILTER_LABELS[filter.kind]} enabled`}
              checked={filter.enabled}
              onChange={(e) => onDocumentChange(patchFilter(doc, node.id, filter.id, { enabled: e.target.checked }))}
            />
            <span className={styles.filterName}>{FILTER_LABELS[filter.kind]}</span>
            <button
              className={styles.filterIconBtn}
              aria-label={`Move ${FILTER_LABELS[filter.kind]} earlier`}
              disabled={index === 0}
              onClick={() => onDocumentChange(reorderFilter(doc, node.id, filter.id, -1))}
            >
              <ChevronUp size={12} />
            </button>
            <button
              className={styles.filterIconBtn}
              aria-label={`Move ${FILTER_LABELS[filter.kind]} later`}
              disabled={index === filters.length - 1}
              onClick={() => onDocumentChange(reorderFilter(doc, node.id, filter.id, 1))}
            >
              <ChevronDown size={12} />
            </button>
            <button
              className={`${styles.filterIconBtn} ${styles.filterDelete}`}
              aria-label={`Remove ${FILTER_LABELS[filter.kind]}`}
              onClick={() => onDocumentChange(removeFilter(doc, node.id, filter.id))}
            >
              <Trash2 size={12} />
            </button>
          </div>
          <FilterControls
            filter={filter}
            onPatch={(fields) => onDocumentChange(patchFilter(doc, node.id, filter.id, fields))}
          />
        </div>
      ))}

      {adding ? (
        <div className={styles.row}>
          <select
            className={styles.select}
            aria-label="Filter to add"
            defaultValue=""
            onChange={(e) => {
              if (!e.target.value) return;
              onDocumentChange(addFilter(doc, node.id, createFilter(e.target.value as FilterKind)));
              setAdding(false);
            }}
          >
            <option value="">Choose a filter…</option>
            {FILTER_KINDS.map((kind) => (
              <option key={kind} value={kind}>{FILTER_LABELS[kind]}</option>
            ))}
          </select>
        </div>
      ) : (
        <div className={styles.iconRow}>
          <button className={styles.iconBtn} onClick={() => setAdding(true)}>Add filter</button>
        </div>
      )}
    </div>
  );
}

function FilterControls({
  filter,
  onPatch,
}: {
  filter: FilterSpec;
  onPatch: (fields: Partial<FilterSpec>) => void;
}) {
  switch (filter.kind) {
    case 'blur':
      return <Slider label="Radius" value={filter.radius} min={0} max={200}
        onChange={(radius) => onPatch({ radius })} />;
    case 'sharpen':
      return <Slider label="Amount" value={filter.amount} min={0} max={300}
        onChange={(amount) => onPatch({ amount })} format={(v) => `${Math.round(v)}%`} />;
    case 'pixelate':
      return <Slider label="Blocks" value={filter.size} min={2} max={200}
        onChange={(size) => onPatch({ size })} />;
    case 'drop-shadow':
      return (
        <>
          <Slider label="X" value={filter.dx} min={-100} max={100}
            onChange={(dx) => onPatch({ dx })} />
          <Slider label="Y" value={filter.dy} min={-100} max={100}
            onChange={(dy) => onPatch({ dy })} />
          <Slider label="Blur" value={filter.blur} min={0} max={200}
            onChange={(blur) => onPatch({ blur })} />
          <Slider label="Alpha" value={filter.opacity} min={0} max={1} step={0.01}
            onChange={(opacity) => onPatch({ opacity })} format={(v) => v.toFixed(2)} />
          <div className={styles.row}>
            <span className={styles.label}>Colour</span>
            <ColorPickerPopover
              color={filter.color}
              onChange={(hex) => onPatch({ color: hex })}
              title="Shadow colour"
            >
              <span className={styles.colorSwatch} style={{ background: filter.color }} />
            </ColorPickerPopover>
          </div>
        </>
      );
    case 'glow':
      return (
        <>
          <Slider label="Radius" value={filter.radius} min={0} max={200}
            onChange={(radius) => onPatch({ radius })} />
          <Slider label="Strength" value={filter.strength} min={0} max={4} step={0.05}
            onChange={(strength) => onPatch({ strength })} format={(v) => v.toFixed(2)} />
          <div className={styles.row}>
            <span className={styles.label}>Colour</span>
            <ColorPickerPopover
              color={filter.color}
              onChange={(hex) => onPatch({ color: hex })}
              title="Glow colour"
            >
              <span className={styles.colorSwatch} style={{ background: filter.color }} />
            </ColorPickerPopover>
          </div>
        </>
      );
    case 'noise':
      return (
        <>
          <Slider label="Amount" value={filter.amount} min={0} max={100}
            onChange={(amount) => onPatch({ amount })} format={(v) => `${Math.round(v)}%`} />
          <div className={styles.row}>
            <span className={styles.label}>Mono</span>
            <input
              type="checkbox"
              className={styles.shadowToggle}
              aria-label="Monochrome noise"
              checked={filter.monochrome}
              onChange={(e) => onPatch({ monochrome: e.target.checked })}
            />
          </div>
        </>
      );
  }
}

// ---------------------------------------------------------------------------
// Other layer types
// ---------------------------------------------------------------------------

/**
 * What a layer is, plus where its pixels came from.
 *
 * The provenance half is the visible end of redesign §5's linked assets: the
 * source URI, the size it had when it arrived, and — for a source that can be
 * fetched again — a Reload button. The **bit depth is shown only when it is
 * 16**, because that is the only case where it says something: everything this
 * editor paints is eight bits, and a row reading "8-bit" on every layer would
 * be noise rather than information.
 */
function LayerInfo({
  doc,
  node,
  onReloadAsset,
}: {
  doc: DrawingDocument;
  node: DrawingNode;
  onReloadAsset?: (assetId: string) => void;
}) {
  const kind = node.type === 'raster' ? 'Image layer'
    : node.type === 'stack' ? 'Group'
    : 'Layer';
  const size = node.type === 'raster'
    ? `${Math.round(node.source.width)} × ${Math.round(node.source.height)} px`
    : null;
  const asset = node.type === 'raster' ? findAsset(doc.assets, node.assetId) : null;
  const deepSource = node.type === 'raster' && node.source.bitDepth === 16;

  return (
    <>
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
        {deepSource && (
          <div className={styles.row}>
            <span className={styles.label}>Source</span>
            <span className={styles.readonlyValue}>16-bit</span>
          </div>
        )}
        {deepSource && (
          <p className={styles.hint}>
            The original carried 16 bits per channel. Editing here is 8-bit.
          </p>
        )}
        <p className={styles.hint}>
          Opacity, blend mode, visibility and lock are in the Layers panel.
        </p>
      </div>

      {asset && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Imported from</div>
          <div className={styles.row}>
            <span className={styles.label}>Source</span>
            <span className={styles.readonlyValue} title={asset.uri}>{describeAssetSource(asset)}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Was</span>
            <span className={styles.readonlyValue}>{asset.width} × {asset.height} px</span>
          </div>
          {asset.linked && onReloadAsset && (
            <div className={styles.iconRow}>
              <button className={styles.iconBtn} onClick={() => onReloadAsset(asset.id)}>
                <RefreshCw size={13} />
                <span>Reload from source</span>
              </button>
            </div>
          )}
          <p className={styles.hint}>
            {asset.linked
              ? 'The drawing holds its own copy of these pixels, so it stays viewable if the source goes away.'
              : 'Embedded. There is no source to reload from.'}
          </p>
        </div>
      )}
    </>
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

      <ColorStyle doc={doc} onDocumentChange={onDocumentChange} />
      <WorkspaceStyle doc={doc} onDocumentChange={onDocumentChange} />

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

// ---------------------------------------------------------------------------
// Colour management
// ---------------------------------------------------------------------------

/**
 * The document's colour, per redesign §5.
 *
 * Three things that are often confused and are kept apart here. **The working
 * space** is what buffers are allocated in and what the compositor mixes in.
 * **The embedded profile** is what travels with the file so another application
 * knows what the numbers meant — it is written as its own archive entry *and*
 * into `mergedimage.png`, and it does not change how anything is rendered here.
 * **HDR** is a declaration plus an SDR preview, because OpenRaster's merged
 * image is PNG and this pipeline is 8-bit; the panel says so rather than
 * implying that switching it on makes the highlights brighter.
 */
function ColorStyle({
  doc,
  onDocumentChange,
}: {
  doc: DrawingDocument;
  onDocumentChange: (doc: DrawingDocument) => void;
}) {
  const iccInputRef = useRef<HTMLInputElement>(null);
  const [iccError, setIccError] = useState<string | null>(null);
  const profile = doc.colorProfile;
  const hdr = profile.hdr ?? DEFAULT_HDR;
  const wideGamutAvailable = canvasSupportsColorSpace('display-p3');

  async function embedProfile(file: File) {
    setIccError(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseIccProfile(bytes);
    // Validated before it is stored, not before it is exported: a profile that
    // is not a profile has to be refused at the moment somebody can still pick
    // a different file, rather than silently dropped out of the package later.
    if (!parsed) {
      setIccError('That file is not an ICC colour profile.');
      return;
    }
    onDocumentChange(setColorProfile(doc, { name: parsed.name, iccUri: iccDataUrl(bytes) }));
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Colour</div>

      <div className={styles.row}>
        <span className={styles.label}>Space</span>
        <select
          className={styles.select}
          aria-label="Colour space"
          value={profile.space ?? 'srgb'}
          onChange={(e) => onDocumentChange(setColorProfile(doc, { space: e.target.value as ColorSpaceName }))}
        >
          {(Object.keys(COLOR_SPACE_LABELS) as ColorSpaceName[]).map((space) => (
            <option key={space} value={space}>{COLOR_SPACE_LABELS[space]}</option>
          ))}
        </select>
      </div>

      {profile.space === 'display-p3' && !wideGamutAvailable && (
        <p className={styles.hint}>This browser has no wide-gamut canvas, so it renders as sRGB.</p>
      )}

      <div className={styles.row}>
        <span className={styles.label}>Profile</span>
        <span className={styles.readonlyValue} title={profile.name}>
          {profile.iccUri ? profile.name : 'None embedded'}
        </span>
      </div>

      <div className={styles.iconRow}>
        <button className={styles.iconBtn} onClick={() => iccInputRef.current?.click()}>
          Embed ICC…
        </button>
        {profile.iccUri && (
          <button
            className={styles.iconBtn}
            onClick={() => onDocumentChange(setColorProfile(doc, { iccUri: undefined, name: 'sRGB' }))}
          >
            Remove
          </button>
        )}
      </div>
      {iccError && <p className={styles.hint}>{iccError}</p>}

      <input
        ref={iccInputRef}
        type="file"
        hidden
        aria-hidden="true"
        accept=".icc,.icm,application/vnd.iccprofile"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) embedProfile(file);
        }}
      />

      <div className={styles.row}>
        <span className={styles.label}>HDR</span>
        <input
          type="checkbox"
          className={styles.shadowToggle}
          aria-label="HDR document"
          checked={hdr.enabled}
          onChange={(e) => onDocumentChange(setHdr(doc, { enabled: e.target.checked }))}
        />
      </div>

      {hdr.enabled && (
        <>
          <div className={styles.row}>
            <span className={styles.label}>Transfer</span>
            <select
              className={styles.select}
              aria-label="HDR transfer function"
              value={hdr.transfer}
              onChange={(e) => onDocumentChange(setHdr(doc, { transfer: e.target.value as 'pq' | 'hlg' }))}
            >
              <option value="pq">PQ (ST 2084)</option>
              <option value="hlg">HLG</option>
            </select>
          </div>
          <Slider
            label="Headroom"
            value={hdr.headroom}
            min={1}
            max={8}
            step={0.5}
            onChange={(headroom) => onDocumentChange(setHdr(doc, { headroom }))}
            format={(v) => `${v} stops`}
          />
          <p className={styles.hint}>
            Recorded for readers that can show it. Editing and the merged image stay SDR, and
            an export names that merged image as the SDR preview.
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

/**
 * Rulers, units, guides and snapping — redesign §5's workspace state.
 *
 * Grouped here rather than beside the grid because they are the same *kind* of
 * setting: things that change how the canvas is worked on and nothing about
 * what it contains. The grid keeps its own section above, since spacing and
 * origin are geometry a drawing is built against.
 */
function WorkspaceStyle({
  doc,
  onDocumentChange,
}: {
  doc: DrawingDocument;
  onDocumentChange: (doc: DrawingDocument) => void;
}) {
  const workspace = workspaceOf(doc.workspace);

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Workspace</div>

      <div className={styles.row}>
        <span className={styles.label}>Rulers</span>
        <input
          type="checkbox"
          className={styles.shadowToggle}
          aria-label="Show rulers"
          checked={workspace.rulers}
          onChange={(e) => onDocumentChange(setWorkspace(doc, { rulers: e.target.checked }))}
        />
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Units</span>
        <select
          className={styles.select}
          aria-label="Ruler units"
          value={workspace.units}
          onChange={(e) => onDocumentChange(setWorkspace(doc, { units: e.target.value as RulerUnit }))}
        >
          {RULER_UNITS.map((unit) => (
            <option key={unit} value={unit}>{RULER_UNIT_LABELS[unit]}</option>
          ))}
        </select>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Guides</span>
        <input
          type="checkbox"
          className={styles.shadowToggle}
          aria-label="Show guides"
          checked={workspace.showGuides}
          onChange={(e) => onDocumentChange(setWorkspace(doc, { showGuides: e.target.checked }))}
        />
        <span className={styles.propValue}>{doc.guides.length}</span>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Lock</span>
        <input
          type="checkbox"
          className={styles.shadowToggle}
          aria-label="Lock guides"
          checked={workspace.lockGuides}
          onChange={(e) => onDocumentChange(setWorkspace(doc, { lockGuides: e.target.checked }))}
        />
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Snap to</span>
        <div className={styles.snapChecks}>
          <label className={styles.snapCheck}>
            <input
              type="checkbox"
              aria-label="Snap to guides"
              checked={workspace.snap.guides}
              onChange={(e) => onDocumentChange(setSnap(doc, { guides: e.target.checked }))}
            />
            Guides
          </label>
          <label className={styles.snapCheck}>
            <input
              type="checkbox"
              aria-label="Snap to objects"
              checked={workspace.snap.objects}
              onChange={(e) => onDocumentChange(setSnap(doc, { objects: e.target.checked }))}
            />
            Objects
          </label>
          <label className={styles.snapCheck}>
            <input
              type="checkbox"
              aria-label="Snap to the canvas"
              checked={workspace.snap.canvas}
              onChange={(e) => onDocumentChange(setSnap(doc, { canvas: e.target.checked }))}
            />
            Canvas
          </label>
        </div>
      </div>

      <Slider
        label="Rotate"
        value={workspace.canvasRotation}
        min={0}
        max={359}
        onChange={(canvasRotation) => onDocumentChange(setWorkspace(doc, { canvasRotation }))}
        format={(v) => `${Math.round(v)}°`}
      />
      <p className={styles.hint}>
        Rotating turns the view only. Nothing in the drawing moves and exports are unaffected.
      </p>
    </div>
  );
}
