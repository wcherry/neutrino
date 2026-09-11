'use client';

import React from 'react';
import { ColorPickerPopover } from '@neutrino/ui';

import {
  BLEND_MODES,
  BLEND_MODE_LABELS,
  type BlendMode,
} from './types';
import {
  MAX_BRUSH_SIZE,
  MEDIUM_LABELS,
  MEDIUM_PROFILES,
  MIN_BRUSH_SIZE,
  PAINT_MEDIUMS,
  PAPER_LABELS,
  PAPER_TYPES,
  clampBrush,
  type BrushSettings,
  type PaintMedium,
  type PaperType,
} from './paint';
import styles from './StylePanel.module.css';

interface BrushPanelProps {
  brush: BrushSettings;
  onBrushChange: (brush: BrushSettings) => void;
  /** Whether the stroke goes into the active layer's mask channel. */
  maskEditing: boolean;
  onMaskEditingChange: (value: boolean) => void;
  /** Absent when the active layer has no mask, which disables the toggle. */
  canEditMask: boolean;
  /** What the brush is currently pointed at, so "nowhere" is visible rather than silent. */
  targetLabel: string | null;
}

/**
 * The inspector while a paint tool is armed.
 *
 * Every control here writes to the editor's brush state and none of it reaches
 * the document: a brush is a tool, not content (redesign §3). The one thing on
 * this panel that *is* about the document is the target read-out, and it earns
 * its place — a brush with nowhere to paint is otherwise a tool that silently
 * does nothing, which is the single most confusing state a paint program has.
 *
 * Three of the controls appear only for the tool they describe. The engine
 * gives every brush a splatter, a paper and a medium, but a pencil's paint type
 * and a marker's spray pattern are questions nobody asks — and a panel that
 * offers every dimension to every tool is how an inspector becomes a wall of
 * sliders with no shape to it. Which tool each belongs to is a judgement about
 * the tool, so it lives here rather than in the engine.
 */
export function BrushPanel({
  brush,
  onBrushChange,
  maskEditing,
  onMaskEditingChange,
  canEditMask,
  targetLabel,
}: BrushPanelProps) {
  const patch = (fields: Partial<BrushSettings>) =>
    onBrushChange(clampBrush({ ...brush, ...fields }));

  // A medium with an opinion about blending wins over the Blend control — a
  // watercolour glaze is a multiply or it is not a glaze. The control is
  // disabled rather than hidden, because a setting that quietly stops applying
  // is worse than one that says why it cannot.
  const mediumBlend = MEDIUM_PROFILES[brush.medium]?.blend ?? null;

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Brush</div>

        {!brush.erase && (
          <div className={styles.row}>
            <span className={styles.label}>Colour</span>
            <ColorPickerPopover
              color={brush.color}
              onChange={(hex) => patch({ color: hex })}
              title="Brush colour"
              showAlpha
            >
              <span className={styles.colorSwatch} style={{ background: brush.color }} />
            </ColorPickerPopover>
          </div>
        )}

        <div className={styles.row}>
          <span className={styles.label}>Size</span>
          <input
            type="number"
            min={MIN_BRUSH_SIZE}
            max={MAX_BRUSH_SIZE}
            aria-label="Brush size"
            className={styles.numberInput}
            value={Math.round(brush.size)}
            onChange={(e) => patch({ size: Number(e.target.value) || MIN_BRUSH_SIZE })}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Opacity</span>
          <input
            type="range"
            min={0}
            max={100}
            aria-label="Brush opacity"
            className={styles.rangeInput}
            value={Math.round(brush.opacity * 100)}
            onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Flow</span>
          <input
            type="range"
            min={1}
            max={100}
            aria-label="Brush flow"
            className={styles.rangeInput}
            value={Math.round(brush.flow * 100)}
            onChange={(e) => patch({ flow: Number(e.target.value) / 100 })}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Hardness</span>
          <input
            type="range"
            min={0}
            max={100}
            aria-label="Brush hardness"
            className={styles.rangeInput}
            value={Math.round(brush.hardness * 100)}
            onChange={(e) => patch({ hardness: Number(e.target.value) / 100 })}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Smoothing</span>
          <input
            type="range"
            min={0}
            max={100}
            aria-label="Stroke smoothing"
            className={styles.rangeInput}
            value={Math.round(brush.smoothing * 100)}
            onChange={(e) => patch({ smoothing: Number(e.target.value) / 100 })}
          />
        </div>

        {!brush.erase && (
          <>
            <div className={styles.row}>
              <span className={styles.label}>Blend</span>
              <select
                className={styles.select}
                aria-label="Brush blend mode"
                value={mediumBlend ?? brush.blendMode}
                disabled={mediumBlend !== null}
                onChange={(e) => patch({ blendMode: e.target.value as BlendMode })}
              >
                {BLEND_MODES.map((mode) => (
                  <option key={mode} value={mode}>{BLEND_MODE_LABELS[mode]}</option>
                ))}
              </select>
            </div>
            {mediumBlend !== null && (
              <p className={styles.hint}>
                {MEDIUM_LABELS[brush.medium]} always blends as{' '}
                {BLEND_MODE_LABELS[mediumBlend].toLowerCase()}.
              </p>
            )}
          </>
        )}
      </div>

      {brush.type === 'airbrush' && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Spray</div>
          <p className={styles.hint}>
            How far the spray breaks into droplets. At zero it is an even airbrush cloud.
          </p>
          <div className={styles.row}>
            <span className={styles.label}>Splatter</span>
            <input
              type="range"
              min={0}
              max={100}
              aria-label="Spray splatter"
              className={styles.rangeInput}
              value={Math.round(brush.splatter * 100)}
              onChange={(e) => patch({ splatter: Number(e.target.value) / 100 })}
            />
          </div>
        </div>
      )}

      {brush.type === 'pencil' && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Paper</div>
          <p className={styles.hint}>
            The tooth the graphite catches on. The grain is fixed to the canvas, so a second
            pass finds the same peaks.
          </p>
          <div className={styles.row}>
            <span className={styles.label}>Surface</span>
            <select
              className={styles.select}
              aria-label="Paper texture"
              value={brush.paper}
              onChange={(e) => patch({ paper: e.target.value as PaperType })}
            >
              {PAPER_TYPES.map((paper) => (
                <option key={paper} value={paper}>{PAPER_LABELS[paper]}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {brush.type === 'brush' && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Paint</div>
          <p className={styles.hint}>
            What the paint is, and so how much of the colour under it comes along.
          </p>
          <div className={styles.row}>
            <span className={styles.label}>Medium</span>
            <select
              className={styles.select}
              aria-label="Paint type"
              value={brush.medium}
              onChange={(e) => patch({ medium: e.target.value as PaintMedium })}
            >
              {PAINT_MEDIUMS.map((medium) => (
                <option key={medium} value={medium}>{MEDIUM_LABELS[medium]}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Pressure</div>
        <p className={styles.hint}>Applies to a stylus. A mouse paints at full pressure.</p>
        <div className={styles.row}>
          <span className={styles.label}>Affects size</span>
          <input
            type="checkbox"
            className={styles.shadowToggle}
            aria-label="Pressure affects size"
            checked={brush.pressure.size}
            onChange={(e) => patch({ pressure: { ...brush.pressure, size: e.target.checked } })}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Affects opacity</span>
          <input
            type="checkbox"
            className={styles.shadowToggle}
            aria-label="Pressure affects opacity"
            checked={brush.pressure.opacity}
            onChange={(e) => patch({ pressure: { ...brush.pressure, opacity: e.target.checked } })}
          />
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Painting on</div>
        <div className={styles.row}>
          <span className={styles.label}>Target</span>
          <span className={styles.readonlyValue}>{targetLabel ?? 'Nothing'}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Layer mask</span>
          <input
            type="checkbox"
            className={styles.shadowToggle}
            aria-label="Paint on the layer mask"
            checked={maskEditing}
            disabled={!canEditMask}
            onChange={(e) => onMaskEditingChange(e.target.checked)}
          />
        </div>
        {!canEditMask && (
          <p className={styles.hint}>Add a mask to this layer to paint on it.</p>
        )}
      </div>
    </div>
  );
}
