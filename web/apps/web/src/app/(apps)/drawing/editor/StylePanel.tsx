'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Lock, Unlock, ChevronDown } from 'lucide-react';
import { FillPicker, ColorPickerPopover, type Background } from '@neutrino/ui';
import type { Shape, StrokeStyle } from './types';
import styles from './StylePanel.module.css';

interface StylePanelProps {
  shapes: Shape[];
  selectedIds: string[];
  onStyleChange: (ids: string[], patch: Partial<Shape>) => void;
  onToggleLock: () => void;
}

const STROKE_STYLES: { value: StrokeStyle; label: string; dashFn: (sw: number) => number[] }[] = [
  { value: 'solid',     label: 'Solid',     dashFn: ()   => [] },
  { value: 'dashed',    label: 'Dashed',    dashFn: (sw) => [sw * 4, sw * 3] },
  { value: 'dotted',    label: 'Dotted',    dashFn: (sw) => [sw, sw * 2] },
  { value: 'long-dash', label: 'Long dash', dashFn: (sw) => [sw * 8, sw * 3] },
];

function LinePreview({ dash, sw = 2 }: { dash: number[]; sw?: number }) {
  return (
    <svg width="44" height="10" viewBox="0 0 44 10" style={{ display: 'block', flexShrink: 0 }}>
      <line
        x1="2" y1="5" x2="42" y2="5"
        stroke="currentColor"
        strokeWidth={Math.min(sw, 3)}
        strokeDasharray={dash.length ? dash.join(' ') : undefined}
        strokeLinecap="round"
      />
    </svg>
  );
}

function LineStylePicker({ value, strokeWidth, onChange }: {
  value: StrokeStyle;
  strokeWidth: number;
  onChange: (v: StrokeStyle) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const current = STROKE_STYLES.find((s) => s.value === value) ?? STROKE_STYLES[0];
  const sw = Math.min(strokeWidth || 2, 3);

  return (
    <div ref={ref} className={styles.lineStyleWrap}>
      <button className={styles.lineStyleBtn} onClick={() => setOpen((v) => !v)}>
        <LinePreview dash={current.dashFn(sw)} sw={sw} />
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
              <LinePreview dash={style.dashFn(sw)} sw={sw} />
              <span className={styles.lineStyleLabel}>{style.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const FONT_FAMILIES = [
  { value: 'sans-serif', label: 'Sans-serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Times New Roman', serif", label: 'Times New Roman' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: "'Courier New', monospace", label: 'Courier New' },
];

function fillToBackground(fill: string): Background {
  if (/^(linear|radial)-gradient/i.test(fill)) return { type: 'gradient', value: fill };
  if (/^url\(/i.test(fill)) return { type: 'image', value: fill.slice(4, -1) };
  return { type: 'color', value: fill === 'transparent' ? '#ffffff' : fill };
}

export function StylePanel({ shapes, selectedIds, onStyleChange, onToggleLock }: StylePanelProps) {
  const selected = shapes.filter((s) => selectedIds.includes(s.id));
  if (selected.length === 0) return null;

  const first = selected[0];
  const allText = selected.every((s) => s.type === 'text');
  const anyLocked = selected.some((s) => s.locked);
  const showFill = selected.some((s) => s.type !== 'pen' && s.type !== 'line' && s.type !== 'arrow');

  const fill = first.fill ?? 'transparent';
  const stroke = first.stroke ?? '#000000';
  const strokeWidth = first.strokeWidth ?? 2;
  const strokeStyle: StrokeStyle = first.strokeStyle ?? (first.strokeDash ? 'dashed' : 'solid');
  const fontFamily = first.fontFamily ?? 'sans-serif';
  const shadowEnabled = first.shadowEnabled ?? false;
  const shadowColor = first.shadowColor ?? 'rgba(0,0,0,0.5)';
  const shadowBlur = first.shadowBlur ?? 4;
  const shadowOffsetX = first.shadowOffsetX ?? 2;
  const shadowOffsetY = first.shadowOffsetY ?? 2;
  const fontSize = Math.abs(first.height) || 16;

  return (
    <div className={styles.panel}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Style</div>

        {showFill && (
          <div className={styles.row}>
            <span className={styles.label}>Fill</span>
            <div className={styles.colorCell}>
              <FillPicker
                background={fillToBackground(fill)}
                onChange={(bg) => onStyleChange(selectedIds, { fill: bg.type === 'image' ? `url(${bg.value})` : bg.value })}
                presetsKey="neutrino:drawing:fillPresets"
                triggerLabel=""
              />
              <button
                className={styles.clearBtn}
                onClick={() => onStyleChange(selectedIds, { fill: 'transparent' })}
                title="No fill"
              >
                ∅
              </button>
            </div>
          </div>
        )}

        <div className={styles.row}>
          <span className={styles.label}>Stroke</span>
          <ColorPickerPopover
            color={stroke}
            onChange={(hex) => onStyleChange(selectedIds, { stroke: hex })}
            title="Stroke color"
            showAlpha
          >
            <button
              className={styles.colorSwatch}
              style={{ background: stroke }}
              title="Stroke color"
            />
          </ColorPickerPopover>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Width</span>
          <input
            type="number"
            min={1}
            max={32}
            value={strokeWidth}
            onChange={(e) => {
              const v = Math.max(1, Math.min(32, Number(e.target.value)));
              if (!isNaN(v)) onStyleChange(selectedIds, { strokeWidth: v });
            }}
            className={styles.numberInput}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Style</span>
          <LineStylePicker
            value={strokeStyle}
            strokeWidth={strokeWidth}
            onChange={(v) => onStyleChange(selectedIds, { strokeStyle: v, strokeDash: false })}
          />
        </div>
      </div>

      {allText && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Text</div>

          <div className={styles.row}>
            <span className={styles.label}>Font</span>
            <select
              className={styles.select}
              value={fontFamily}
              onChange={(e) => onStyleChange(selectedIds, { fontFamily: e.target.value })}
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.row}>
            <span className={styles.label}>Size</span>
            <input
              type="number"
              min={8}
              max={144}
              step={1}
              value={fontSize}
              onChange={(e) => onStyleChange(selectedIds, { height: Number(e.target.value) })}
              className={styles.numberInput}
            />
          </div>

          <div className={styles.row}>
            <span className={styles.label}>Shadow</span>
            <input
              type="checkbox"
              checked={shadowEnabled}
              onChange={(e) => onStyleChange(selectedIds, { shadowEnabled: e.target.checked })}
              className={styles.shadowToggle}
            />
          </div>

          {shadowEnabled && (
            <>
              <div className={styles.row}>
                <span className={styles.label}>Color</span>
                <ColorPickerPopover
                  color={shadowColor}
                  onChange={(c) => onStyleChange(selectedIds, { shadowColor: c })}
                  title="Shadow color"
                  showAlpha
                >
                  <button className={styles.colorSwatch} style={{ background: shadowColor }} />
                </ColorPickerPopover>
              </div>
              <div className={styles.row}>
                <span className={styles.label}>Blur</span>
                <input
                  type="number"
                  min={0}
                  max={40}
                  value={shadowBlur}
                  onChange={(e) => onStyleChange(selectedIds, { shadowBlur: Math.max(0, Number(e.target.value)) })}
                  className={styles.numberInput}
                />
              </div>
              <div className={styles.row}>
                <span className={styles.label}>Offset</span>
                <div className={styles.offsetRow}>
                  <input
                    type="number"
                    min={-40}
                    max={40}
                    value={shadowOffsetX}
                    onChange={(e) => onStyleChange(selectedIds, { shadowOffsetX: Number(e.target.value) })}
                    className={styles.offsetInput}
                    title="X offset"
                  />
                  <input
                    type="number"
                    min={-40}
                    max={40}
                    value={shadowOffsetY}
                    onChange={(e) => onStyleChange(selectedIds, { shadowOffsetY: Number(e.target.value) })}
                    className={styles.offsetInput}
                    title="Y offset"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Object</div>
        <div className={styles.iconRow}>
          <button
            className={`${styles.iconBtn} ${anyLocked ? styles.iconBtnActive : ''}`}
            onClick={onToggleLock}
            title={anyLocked ? 'Unlock' : 'Lock'}
          >
            {anyLocked ? <Lock size={14} /> : <Unlock size={14} />}
            <span>{anyLocked ? 'Locked' : 'Lock'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
