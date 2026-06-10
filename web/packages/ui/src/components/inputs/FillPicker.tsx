'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ColorPicker } from './ColorPicker';
import { ColorPickerPopover } from './ColorPickerPopover';
import styles from './FillPicker.module.css';

// ── Public types ──────────────────────────────────────────────────────────────

export type Background =
  | { type: 'color'; value: string }
  | { type: 'gradient'; value: string }
  | { type: 'image'; value: string; objectFit?: 'cover' | 'contain' | 'fill' };

export interface BackgroundTheme {
  primaryColor: string;
  backgroundColor: string;
  accentColor: string;
}

export interface FillPickerProps {
  background: Background;
  onChange: (bg: Background) => void;
  theme?: BackgroundTheme;
  /** localStorage key for user-saved gradient presets (default: 'neutrino:bg:gradientPresets') */
  presetsKey?: string;
  /** Label shown on the trigger button (default: 'BG') */
  triggerLabel?: string;
}

// ── Gradient model ────────────────────────────────────────────────────────────

interface GradientStop { color: string; position: number; }
interface GradientConfig { type: 'linear' | 'radial'; angle: number; stops: GradientStop[]; }

// ── CSS gradient parser ───────────────────────────────────────────────────────

function splitArgs(s: string): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const DIR_TO_ANGLE: Record<string, number> = {
  'to top': 0, 'to top right': 45, 'to right': 90, 'to bottom right': 135,
  'to bottom': 180, 'to bottom left': 225, 'to left': 270, 'to top left': 315,
};

function parseGradient(css: string): GradientConfig | null {
  const lin = css.match(/^linear-gradient\((.+)\)$/is);
  const rad = css.match(/^radial-gradient\((.+)\)$/is);

  const extractStops = (parts: string[], startIdx: number): GradientStop[] => {
    const raw = parts.slice(startIdx).map((s) => {
      s = s.trim();
      const p = s.split(/\s+/);
      if (!/^#[0-9a-fA-F]{3,8}$/.test(p[0])) return null;
      const pct = p[1]?.match(/^(\d+(?:\.\d+)?)%$/);
      return { color: p[0], position: pct ? parseFloat(pct[1]) : -1 } as GradientStop;
    }).filter((x): x is GradientStop => x !== null);
    return raw.map((s, i) => ({
      ...s,
      position: s.position >= 0 ? s.position : Math.round(i * 100 / Math.max(1, raw.length - 1)),
    }));
  };

  if (lin) {
    const parts = splitArgs(lin[1]);
    let angle = 135, startIdx = 0;
    const first = parts[0]?.trim() ?? '';
    const deg = first.match(/^(-?\d+(?:\.\d+)?)deg$/i);
    if (deg) { angle = parseFloat(deg[1]); startIdx = 1; }
    else if (/^to\s+/i.test(first)) { angle = DIR_TO_ANGLE[first.toLowerCase().trim()] ?? 135; startIdx = 1; }
    const stops = extractStops(parts, startIdx);
    return stops.length >= 2 ? { type: 'linear', angle, stops } : null;
  }

  if (rad) {
    const parts = splitArgs(rad[1]);
    const startIdx = /^#/.test(parts[0]?.trim() ?? '') ? 0 : 1;
    const stops = extractStops(parts, startIdx);
    return stops.length >= 2 ? { type: 'radial', angle: 0, stops } : null;
  }

  return null;
}

function buildGradient({ type, angle, stops }: GradientConfig): string {
  const s = stops.map((stop) => `${stop.color} ${Math.round(stop.position)}%`).join(', ');
  return type === 'linear'
    ? `linear-gradient(${Math.round(angle)}deg, ${s})`
    : `radial-gradient(circle, ${s})`;
}

// ── Theme-derived presets ─────────────────────────────────────────────────────

function makeThemePresets(theme: BackgroundTheme): string[] {
  const { primaryColor: p, backgroundColor: b, accentColor: a } = theme;
  return [
    `linear-gradient(135deg, ${p} 0%, ${b} 100%)`,
    `linear-gradient(135deg, ${p} 0%, ${a} 100%)`,
    `linear-gradient(135deg, ${a} 0%, ${b} 100%)`,
    `radial-gradient(circle, ${p} 0%, ${b} 100%)`,
    `linear-gradient(180deg, ${p} 0%, ${a} 50%, ${b} 100%)`,
    `linear-gradient(135deg, ${b} 0%, ${a} 50%, ${p} 100%)`,
  ];
}

// ── Direction compass grid ────────────────────────────────────────────────────

const COMPASS = [
  { angle: 315, label: '↖' }, { angle: 0,   label: '↑' }, { angle: 45,  label: '↗' },
  { angle: 270, label: '←' }, { angle: -1,  label: '' },  { angle: 90,  label: '→' },
  { angle: 225, label: '↙' }, { angle: 180, label: '↓' }, { angle: 135, label: '↘' },
];

// ── Preset gradients ──────────────────────────────────────────────────────────

const PRESET_GRADIENTS = [
  'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
  'linear-gradient(160deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  'linear-gradient(135deg, #0d0221 0%, #0d3b2e 50%, #064e3b 100%)',
  'linear-gradient(135deg, #1a0000 0%, #4a1010 50%, #7c2020 100%)',
  'linear-gradient(135deg, #2d1b2e 0%, #4a1942 50%, #3d0f26 100%)',
  'linear-gradient(135deg, #1a2f20 0%, #2d4a35 50%, #1f3d28 100%)',
  'linear-gradient(135deg, #1a0a00 0%, #7c2d12 45%, #c2410c 100%)',
  'linear-gradient(160deg, #0a1628 0%, #0f2744 50%, #1e3a5f 100%)',
  'linear-gradient(135deg, #050010 0%, #1a0533 45%, #0d001f 100%)',
  'linear-gradient(135deg, #160800 0%, #451a03 50%, #78350f 100%)',
  'linear-gradient(160deg, #e0f7ff 0%, #bae6fd 50%, #7dd3fc 100%)',
  'linear-gradient(135deg, #04000f 0%, #180033 35%, #0d0525 65%, #1a0040 100%)',
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
];

// ── Preview helper ────────────────────────────────────────────────────────────

function bgPreviewStyle(bg: Background): React.CSSProperties {
  if (bg.type === 'image') return { backgroundImage: `url(${bg.value})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  return { background: bg.value };
}

// ── User presets (localStorage) ───────────────────────────────────────────────

function loadUserPresets(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; }
}

function persistUserPresets(key: string, presets: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(presets)); } catch { /* noop */ }
}

// ── Default config ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: GradientConfig = {
  type: 'linear', angle: 135,
  stops: [{ color: '#667eea', position: 0 }, { color: '#764ba2', position: 100 }],
};

// ── Component ─────────────────────────────────────────────────────────────────

export function FillPicker({
  background,
  onChange,
  theme,
  presetsKey,
  triggerLabel,
}: FillPickerProps) {
  const resolvedPresetsKey = presetsKey ?? 'neutrino:bg:gradientPresets';

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'color' | 'gradient' | 'image'>(
    background.type === 'gradient' ? 'gradient' : background.type === 'image' ? 'image' : 'color',
  );
  const [imageUrl, setImageUrl] = useState(background.type === 'image' ? background.value : '');
  const [gradConfig, setGradConfig] = useState<GradientConfig>(() =>
    background.type === 'gradient' ? (parseGradient(background.value) ?? DEFAULT_CONFIG) : DEFAULT_CONFIG,
  );
  const [userPresets, setUserPresets] = useState<string[]>([]);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const lastCssRef = useRef(background.type === 'gradient' ? background.value : '');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setUserPresets(loadUserPresets(resolvedPresetsKey)); }, [resolvedPresetsKey]);

  useEffect(() => {
    if (!open) { setPopoverStyle({ visibility: 'hidden' }); return; }
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popoverWidth = 280;
    const popoverHeight = 500;
    const alignRight = rect.left + popoverWidth > vw;
    const openAbove = rect.bottom + popoverHeight > vh && rect.top > popoverHeight;
    setPopoverStyle({
      ...(alignRight ? { right: vw - rect.right, left: 'auto' } : { left: rect.left, right: 'auto' }),
      ...(openAbove ? { bottom: vh - rect.top + 4, top: 'auto' } : { top: rect.bottom + 4, bottom: 'auto' }),
    });
  }, [open]);

  useEffect(() => {
    if (background.type !== 'gradient' || background.value === lastCssRef.current) return;
    const parsed = parseGradient(background.value);
    if (parsed) { setGradConfig(parsed); lastCssRef.current = background.value; }
  }, [background]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      // Don't close if the click is inside a ColorPickerPopover portal
      if ((target as HTMLElement).closest?.('[data-color-picker-portal]')) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function applyConfig(cfg: GradientConfig) {
    const css = buildGradient(cfg);
    lastCssRef.current = css;
    setGradConfig(cfg);
    onChange({ type: 'gradient', value: css });
  }

  function applyPreset(css: string) {
    lastCssRef.current = css;
    const parsed = parseGradient(css);
    if (parsed) setGradConfig(parsed);
    onChange({ type: 'gradient', value: css });
  }

  function savePreset() {
    const css = buildGradient(gradConfig);
    const updated = [css, ...userPresets.filter((p) => p !== css)].slice(0, 12);
    setUserPresets(updated);
    persistUserPresets(resolvedPresetsKey, updated);
  }

  function removePreset(idx: number) {
    const updated = userPresets.filter((_, i) => i !== idx);
    setUserPresets(updated);
    persistUserPresets(resolvedPresetsKey, updated);
  }

  function addStop() {
    if (gradConfig.stops.length >= 6) return;
    const midColor = gradConfig.stops[Math.floor(gradConfig.stops.length / 2)]?.color ?? '#ffffff';
    const stops = [...gradConfig.stops, { color: midColor, position: 50 }]
      .sort((a, b) => a.position - b.position);
    applyConfig({ ...gradConfig, stops });
  }

  function removeStop(idx: number) {
    if (gradConfig.stops.length <= 2) return;
    applyConfig({ ...gradConfig, stops: gradConfig.stops.filter((_, i) => i !== idx) });
  }

  function updateStopColor(idx: number, color: string) {
    applyConfig({ ...gradConfig, stops: gradConfig.stops.map((s, i) => i === idx ? { ...s, color } : s) });
  }

  function updateStopPosition(idx: number, position: number) {
    applyConfig({
      ...gradConfig,
      stops: gradConfig.stops.map((s, i) => i === idx ? { ...s, position: Math.max(0, Math.min(100, position)) } : s),
    });
  }

  const themePres = theme ? makeThemePresets(theme) : PRESET_GRADIENTS.slice(0, 6);
  const currentCss = buildGradient(gradConfig);

  const isCompact = triggerLabel === '';

  return (
    <div ref={wrapRef} className={styles.bgPickerWrap}>
      <button
        className={isCompact ? styles.bgPickerTriggerCompact : styles.bgPickerTrigger}
        style={isCompact ? bgPreviewStyle(background) : undefined}
        onClick={() => setOpen((v) => !v)}
        title="Fill"
      >
        {!isCompact && (
          <>
            <span className={styles.bgPickerSwatch} style={bgPreviewStyle(background)} />
            {triggerLabel ?? 'BG'}
          </>
        )}
      </button>

      {open && (
        <div className={styles.bgPickerPopover} style={popoverStyle}>
          <div className={styles.bgPickerTabStrip}>
            {(['color', 'gradient', 'image'] as const).map((t) => (
              <button
                key={t}
                className={`${styles.bgPickerTab} ${tab === t ? styles.bgPickerTabActive : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'color' ? 'Color' : t === 'gradient' ? 'Gradient' : 'Image'}
              </button>
            ))}
          </div>

          <div className={styles.bgPickerBody}>
            {tab === 'color' && (
              <ColorPicker
                value={background.type === 'color' ? background.value : '#ffffff'}
                onChange={(val) => onChange({ type: 'color', value: val })}
              />
            )}

            {tab === 'gradient' && (
              <div className={styles.gradientEditor}>

                {/* ── Theme presets ───────────────────────────────────── */}
                <span className={styles.gradSectionLabel}>Theme</span>
                <div className={styles.gradPresetRow}>
                  {themePres.map((g, i) => (
                    <button
                      key={i}
                      className={`${styles.gradPresetSwatch} ${background.type === 'gradient' && background.value === g ? styles.gradPresetSwatchActive : ''}`}
                      style={{ background: g }}
                      onClick={() => applyPreset(g)}
                      title={g}
                    />
                  ))}
                </div>

                {/* ── User (saved) presets ────────────────────────────── */}
                <div className={styles.gradUserHeader}>
                  <span className={styles.gradSectionLabel}>Saved</span>
                  <button className={styles.gradSmallBtn} onClick={savePreset} title="Save current gradient as preset">
                    + Save
                  </button>
                </div>
                {userPresets.length > 0 ? (
                  <div className={styles.gradPresetRow}>
                    {userPresets.map((g, i) => (
                      <div key={i} className={styles.gradUserSwatchWrap}>
                        <button
                          className={`${styles.gradPresetSwatch} ${background.type === 'gradient' && background.value === g ? styles.gradPresetSwatchActive : ''}`}
                          style={{ background: g }}
                          onClick={() => applyPreset(g)}
                          title="Apply"
                        />
                        <button className={styles.gradUserRemove} onClick={() => removePreset(i)} title="Remove">×</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={styles.gradEmptyNote}>No saved gradients yet.</p>
                )}

                <div className={styles.gradDivider} />

                {/* ── Type toggle ─────────────────────────────────────── */}
                <div className={styles.gradTypeRow}>
                  {(['linear', 'radial'] as const).map((t) => (
                    <button
                      key={t}
                      className={`${styles.gradTypeBtn} ${gradConfig.type === t ? styles.gradTypeBtnActive : ''}`}
                      onClick={() => applyConfig({ ...gradConfig, type: t })}
                    >
                      {t === 'linear' ? 'Linear' : 'Radial'}
                    </button>
                  ))}
                </div>

                {/* ── Direction compass (linear only) ─────────────────── */}
                {gradConfig.type === 'linear' && (
                  <div className={styles.gradDirWrap}>
                    <div className={styles.gradDirGrid}>
                      {COMPASS.map((d, i) =>
                        d.angle < 0 ? (
                          <div key={i} className={styles.gradDirCenter} />
                        ) : (
                          <button
                            key={i}
                            className={`${styles.gradDirBtn} ${gradConfig.angle === d.angle ? styles.gradDirBtnActive : ''}`}
                            onClick={() => applyConfig({ ...gradConfig, angle: d.angle })}
                            title={`${d.angle}°`}
                          >
                            {d.label}
                          </button>
                        ),
                      )}
                    </div>
                    <div className={styles.gradAngleSide}>
                      <input
                        type="number"
                        className={styles.gradAngleInput}
                        min={0}
                        max={359}
                        value={Math.round(gradConfig.angle)}
                        onChange={(e) => {
                          const v = parseInt(e.target.value);
                          if (!isNaN(v)) applyConfig({ ...gradConfig, angle: ((v % 360) + 360) % 360 });
                        }}
                        title="Angle in degrees"
                      />
                      <span className={styles.gradAngleDeg}>°</span>
                    </div>
                  </div>
                )}

                <div className={styles.gradDivider} />

                {/* ── Color stops ─────────────────────────────────────── */}
                <div className={styles.gradStopsHeader}>
                  <span className={styles.gradSectionLabel}>Stops</span>
                  <button
                    className={styles.gradSmallBtn}
                    onClick={addStop}
                    disabled={gradConfig.stops.length >= 6}
                    title="Add color stop"
                  >
                    + Add
                  </button>
                </div>
                {gradConfig.stops.map((stop, idx) => (
                  <div key={idx} className={styles.gradStopRow}>
                    <ColorPickerPopover
                      color={stop.color}
                      onChange={(color) => updateStopColor(idx, color)}
                      title="Stop color"
                    >
                      <span className={styles.gradStopSwatch} style={{ background: stop.color }} />
                    </ColorPickerPopover>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={stop.position}
                      className={styles.gradStopSlider}
                      onChange={(e) => updateStopPosition(idx, parseInt(e.target.value))}
                    />
                    <span className={styles.gradStopPct}>{Math.round(stop.position)}%</span>
                    <button
                      className={styles.gradStopRemove}
                      onClick={() => removeStop(idx)}
                      disabled={gradConfig.stops.length <= 2}
                      title="Remove stop"
                    >
                      ×
                    </button>
                  </div>
                ))}

                {/* ── Live preview ─────────────────────────────────────── */}
                <div className={styles.gradPreviewBar} style={{ background: currentCss }} />
              </div>
            )}

            {tab === 'image' && (
              <>
                <input
                  type="text"
                  className={styles.bgUrlInput}
                  placeholder="Image URL…"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  onBlur={() => {
                    if (imageUrl.trim()) onChange({ type: 'image', value: imageUrl.trim(), objectFit: 'cover' });
                    else onChange({ type: 'color', value: '#ffffff' });
                  }}
                />
                {background.type === 'image' && background.value && (
                  <div
                    className={styles.bgImagePreview}
                    style={{ backgroundImage: `url(${background.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
