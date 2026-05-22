'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import styles from './AvatarPickerDialog.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'initial' | 'avatar' | 'file';

interface AvatarCfg {
  bg: string;
  skin: string;
  hair: string;
  style: 0 | 1 | 2 | 3 | 4;
  gender: 'F' | 'M';
}

// ── Skin / hair pairings (6 tones, natural hair per tone) ─────────────────────

const SKIN_COMBOS: [string, string[]][] = [
  ['#FDDBB4', ['#C8A070', '#8B4513', '#8B2000', '#A8A8A8', '#6B3F20']], // very light
  ['#F0C27F', ['#6B3F20', '#3B1F0A', '#8B2000', '#1A1A1A', '#C8A070']], // light
  ['#C68642', ['#3B1F0A', '#1A1A1A', '#7A3010', '#3B1F0A', '#1A1A1A']], // medium
  ['#8D5524', ['#1A1A1A', '#3B1F0A', '#0D0D0D', '#1A1A1A', '#3B1F0A']], // medium dark
  ['#5C3317', ['#1A1A1A', '#0D0D0D', '#1A1A1A', '#0D0D0D', '#1A1A1A']], // dark
  ['#3C1F0A', ['#0D0D0D', '#1A1A1A', '#0D0D0D', '#1A1A1A', '#0D0D0D']], // very dark
];

const BG_F = ['#FF6B6B', '#FFB3C1', '#C8B4E8', '#87A878', '#FFD93D', '#4ECDC4', '#FF8C42', '#7B8EC8', '#96CEB4', '#45B7D1'];
const BG_M = ['#45B7D1', '#7B8EC8', '#4ECDC4', '#96CEB4', '#FF6B6B', '#87A878', '#C8B4E8', '#FFD93D', '#FF8C42', '#FFB3C1'];

function makeConfigs(gender: 'F' | 'M', bgs: string[]): AvatarCfg[] {
  return SKIN_COMBOS.flatMap(([skin, hairs], si) =>
    ([0, 1, 2, 3, 4] as const).map((style, hi) => ({
      gender,
      bg: bgs[(si * 5 + hi) % bgs.length],
      skin,
      hair: hairs[hi],
      style,
    }))
  );
}

const AVATAR_CONFIGS: AvatarCfg[] = [...makeConfigs('F', BG_F), ...makeConfigs('M', BG_M)];

// ── SVG hair paths ────────────────────────────────────────────────────────────

function femaleHair(style: number, color: string): string {
  const c = color;
  switch (style) {
    case 0: // Long straight
      return `<ellipse cx="48" cy="26" rx="22" ry="15" fill="${c}"/>
               <rect x="26" y="26" width="44" height="6" fill="${c}"/>
               <rect x="25" y="26" width="8" height="50" rx="4" fill="${c}"/>
               <rect x="63" y="26" width="8" height="50" rx="4" fill="${c}"/>`;
    case 1: // Long wavy
      return `<ellipse cx="48" cy="26" rx="22" ry="15" fill="${c}"/>
               <rect x="26" y="26" width="44" height="6" fill="${c}"/>
               <path d="M 25 32 Q 19 45 26 55 Q 19 66 26 76" stroke="${c}" stroke-width="11" fill="none" stroke-linecap="round"/>
               <path d="M 71 32 Q 77 45 70 55 Q 77 66 70 76" stroke="${c}" stroke-width="11" fill="none" stroke-linecap="round"/>`;
    case 2: // Curly / afro
      return `<circle cx="26" cy="38" r="11" fill="${c}"/>
               <circle cx="38" cy="23" r="13" fill="${c}"/>
               <circle cx="58" cy="23" r="13" fill="${c}"/>
               <circle cx="70" cy="38" r="11" fill="${c}"/>
               <circle cx="48" cy="18" r="13" fill="${c}"/>
               <circle cx="32" cy="29" r="9" fill="${c}"/>
               <circle cx="64" cy="29" r="9" fill="${c}"/>`;
    case 3: // Bun
      return `<ellipse cx="48" cy="33" rx="21" ry="12" fill="${c}"/>
               <rect x="27" y="33" width="42" height="5" fill="${c}"/>
               <circle cx="48" cy="16" r="13" fill="${c}"/>
               <ellipse cx="48" cy="27" rx="9" ry="7" fill="${c}"/>`;
    case 4: // Bob
      return `<ellipse cx="48" cy="26" rx="22" ry="15" fill="${c}"/>
               <rect x="26" y="26" width="44" height="6" fill="${c}"/>
               <rect x="25" y="26" width="8" height="30" rx="4" fill="${c}"/>
               <rect x="63" y="26" width="8" height="30" rx="4" fill="${c}"/>`;
    default:
      return '';
  }
}

function maleHair(style: number, color: string): string {
  const c = color;
  switch (style) {
    case 0: // Short flat
      return `<ellipse cx="48" cy="28" rx="23" ry="12" fill="${c}"/>
               <rect x="25" y="28" width="46" height="7" fill="${c}"/>`;
    case 1: // Buzz cut
      return `<ellipse cx="48" cy="33" rx="23" ry="7" fill="${c}"/>`;
    case 2: // Curly short
      return `<circle cx="30" cy="35" r="10" fill="${c}"/>
               <circle cx="42" cy="24" r="11" fill="${c}"/>
               <circle cx="56" cy="24" r="11" fill="${c}"/>
               <circle cx="66" cy="35" r="10" fill="${c}"/>
               <ellipse cx="48" cy="30" rx="18" ry="10" fill="${c}"/>`;
    case 3: // Pompadour
      return `<ellipse cx="48" cy="29" rx="23" ry="12" fill="${c}"/>
               <rect x="25" y="29" width="46" height="7" fill="${c}"/>
               <path d="M 30 27 Q 48 13 66 27" stroke="${c}" stroke-width="10" fill="none" stroke-linecap="round"/>`;
    case 4: // Medium / textured
      return `<ellipse cx="48" cy="26" rx="23" ry="14" fill="${c}"/>
               <rect x="25" y="26" width="46" height="9" fill="${c}"/>`;
    default:
      return '';
  }
}

// ── SVG builder ───────────────────────────────────────────────────────────────

function buildAvatarSvg(cfg: AvatarCfg): string {
  const dark = cfg.skin === '#3C1F0A' || cfg.skin === '#5C3317';
  const feat = dark ? '#1a0a0a' : '#2d1c1c';
  const hair = cfg.gender === 'F' ? femaleHair(cfg.style, cfg.hair) : maleHair(cfg.style, cfg.hair);
  const faceRx = cfg.gender === 'F' ? 20 : 22;

  const eyes =
    cfg.gender === 'F'
      ? `<circle cx="40" cy="55" r="2.5" fill="${feat}"/>
         <circle cx="56" cy="55" r="2.5" fill="${feat}"/>
         <path d="M 36.5 51 Q 40 49 43.5 51" stroke="${feat}" fill="none" stroke-width="1.4"/>
         <path d="M 52.5 51 Q 56 49 59.5 51" stroke="${feat}" fill="none" stroke-width="1.4"/>`
      : `<circle cx="40" cy="55" r="2.5" fill="${feat}"/>
         <circle cx="56" cy="55" r="2.5" fill="${feat}"/>
         <path d="M 37 51 L 44 50" stroke="${feat}" fill="none" stroke-width="2" stroke-linecap="round"/>
         <path d="M 52 50 L 59 51" stroke="${feat}" fill="none" stroke-width="2" stroke-linecap="round"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
    <circle cx="48" cy="48" r="48" fill="${cfg.bg}"/>
    ${hair}
    <ellipse cx="48" cy="60" rx="${faceRx}" ry="24" fill="${cfg.skin}"/>
    ${eyes}
    <path d="M 41 67 Q 48 73 55 67" stroke="#b06878" fill="none" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

const AVATAR_URLS = AVATAR_CONFIGS.map(
  (cfg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildAvatarSvg(cfg))}`
);

// ── Font / color presets ──────────────────────────────────────────────────────

const FONTS = [
  { label: 'Sans', value: 'system-ui, -apple-system, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: '"Courier New", Courier, monospace' },
  { label: 'Cursive', value: '"Brush Script MT", cursive' },
];

const PRESET_BG = [
  '#4F46E5', '#7C3AED', '#DB2777', '#DC2626',
  '#EA580C', '#D97706', '#16A34A', '#0891B2',
  '#1D4ED8', '#374151',
];
const PRESET_FG = ['#FFFFFF', '#111827', '#FEF3C7', '#DBEAFE'];

// ── InitialTab ────────────────────────────────────────────────────────────────

interface InitialTabProps {
  name: string;
  onPreview: (url: string) => void;
}

function InitialTab({ name, onPreview }: InitialTabProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [letter, setLetter] = useState(() => (name.trim()[0] ?? 'A').toUpperCase());
  const [fontIdx, setFontIdx] = useState(0);
  const [bold, setBold] = useState(true);
  const [italic, setItalic] = useState(false);
  const [outline, setOutline] = useState(false);
  const [bgColor, setBgColor] = useState('#4F46E5');
  const [textColor, setTextColor] = useState('#FFFFFF');

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const S = 200;
    ctx.clearRect(0, 0, S, S);

    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.fillStyle = bgColor;
    ctx.fill();

    const weight = bold ? 'bold' : '400';
    const style = italic ? 'italic' : 'normal';
    ctx.font = `${style} ${weight} 110px ${FONTS[fontIdx].value}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (outline) {
      ctx.strokeStyle = textColor;
      ctx.lineWidth = 7;
      ctx.lineJoin = 'round';
      ctx.strokeText(letter, S / 2, S / 2 + 6);
      ctx.fillStyle = bgColor;
      ctx.fillText(letter, S / 2, S / 2 + 6);
    } else {
      ctx.fillStyle = textColor;
      ctx.fillText(letter, S / 2, S / 2 + 6);
    }

    onPreview(canvas.toDataURL('image/png'));
  }, [letter, fontIdx, bold, italic, outline, bgColor, textColor, onPreview]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <div className={styles.initialTab}>
      <div className={styles.canvasWrap}>
        <canvas ref={canvasRef} width={200} height={200} className={styles.previewCanvas} />
      </div>

      <div className={styles.controls}>
        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Letter</span>
          <input
            className={styles.letterInput}
            value={letter}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              const v = e.target.value.slice(-1).toUpperCase();
              if (v) setLetter(v);
            }}
          />
        </div>

        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Font</span>
          <div className={styles.pillGroup}>
            {FONTS.map((f, i) => (
              <button
                key={f.label}
                type="button"
                className={`${styles.pill} ${i === fontIdx ? styles.pillActive : ''}`}
                style={{ fontFamily: f.value }}
                onClick={() => setFontIdx(i)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Style</span>
          <div className={styles.pillGroup}>
            {(
              [
                { key: 'B', title: 'Bold', active: bold, toggle: () => setBold((v) => !v), css: { fontWeight: 700 } },
                { key: 'I', title: 'Italic', active: italic, toggle: () => setItalic((v) => !v), css: { fontStyle: 'italic' } },
                { key: 'O', title: 'Outline', active: outline, toggle: () => setOutline((v) => !v), css: {} },
              ] as const
            ).map(({ key, title, active, toggle, css }) => (
              <button
                key={key}
                type="button"
                title={title}
                className={`${styles.pill} ${active ? styles.pillActive : ''}`}
                style={css}
                onClick={toggle}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Background</span>
          <div className={styles.swatchRow}>
            {PRESET_BG.map((c) => (
              <button
                key={c}
                type="button"
                className={`${styles.swatch} ${bgColor === c ? styles.swatchActive : ''}`}
                style={{ background: c }}
                onClick={() => setBgColor(c)}
              />
            ))}
            <input
              type="color"
              className={styles.colorInput}
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              title="Custom color"
            />
          </div>
        </div>

        <div className={styles.controlRow}>
          <span className={styles.controlLabel}>Text</span>
          <div className={styles.swatchRow}>
            {PRESET_FG.map((c) => (
              <button
                key={c}
                type="button"
                className={`${styles.swatch} ${textColor === c ? styles.swatchActive : ''}`}
                style={{
                  background: c,
                  border: c === '#FFFFFF' ? '1px solid #e5e7eb' : undefined,
                }}
                onClick={() => setTextColor(c)}
              />
            ))}
            <input
              type="color"
              className={styles.colorInput}
              value={textColor}
              onChange={(e) => setTextColor(e.target.value)}
              title="Custom color"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AvatarTab ─────────────────────────────────────────────────────────────────

interface AvatarTabProps {
  selected: string | null;
  onSelect: (url: string) => void;
  onPreview: (url: string) => void;
}

function AvatarTab({ selected, onSelect, onPreview }: AvatarTabProps) {
  return (
    <div className={styles.avatarGrid}>
      {AVATAR_URLS.map((url, i) => (
        <button
          key={i}
          type="button"
          className={`${styles.avatarCell} ${selected === url ? styles.avatarCellSelected : ''}`}
          onClick={() => { onSelect(url); onPreview(url); }}
          title={`Avatar ${i + 1}`}
        >
          <img src={url} alt={`Avatar ${i + 1}`} width={50} height={50} />
        </button>
      ))}
    </div>
  );
}

// ── FileTab ───────────────────────────────────────────────────────────────────

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}

function Slider({ label, min, max, step, value, onChange, disabled }: SliderProps) {
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        className={styles.slider}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

interface FileTabProps {
  onPreview: (url: string) => void;
}

function FileTab({ onPreview }: FileTabProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag tracking — kept in refs so mousemove handler never has stale closures
  const isDragging = useRef(false);
  const lastClientPos = useRef({ x: 0, y: 0 });

  const [hasImage, setHasImage] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);

  // ── Canvas draw ─────────────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const S = 200; // internal canvas resolution

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.filter = `contrast(${contrast}%) saturate(${saturation}%)`;

    // Scale image to cover the canvas, then apply zoom and drag offset
    const imgAspect = img.naturalWidth / img.naturalHeight;
    let drawW: number, drawH: number;
    if (imgAspect >= 1) {
      drawH = S * zoom;
      drawW = drawH * imgAspect;
    } else {
      drawW = S * zoom;
      drawH = drawW / imgAspect;
    }
    ctx.drawImage(img, (S - drawW) / 2 + offsetX, (S - drawH) / 2 + offsetY, drawW, drawH);
    ctx.restore();

    onPreview(canvas.toDataURL('image/png'));
  }, [zoom, offsetX, offsetY, contrast, saturation, onPreview]);

  useEffect(() => {
    if (hasImage) redraw();
  }, [redraw, hasImage]);

  // ── Document-level pointer listeners (capture release anywhere on page) ──────
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Scale screen-pixel delta → canvas-pixel delta using the actual display size.
      // This stays correct at every zoom level because zoom only affects the drawn
      // image size, not the canvas element's CSS size.
      const { width } = canvas.getBoundingClientRect();
      const scale = 200 / width;
      setOffsetX((x) => x + (e.clientX - lastClientPos.current.x) * scale);
      setOffsetY((y) => y + (e.clientY - lastClientPos.current.y) * scale);
      lastClientPos.current = { x: e.clientX, y: e.clientY };
    }

    function onMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      setDragging(false);
    }

    function onTouchMove(e: TouchEvent) {
      if (!isDragging.current || e.touches.length !== 1) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { width } = canvas.getBoundingClientRect();
      const scale = 200 / width;
      const t = e.touches[0];
      setOffsetX((x) => x + (t.clientX - lastClientPos.current.x) * scale);
      setOffsetY((y) => y + (t.clientY - lastClientPos.current.y) * scale);
      lastClientPos.current = { x: t.clientX, y: t.clientY };
      e.preventDefault();
    }

    function onTouchEnd() {
      isDragging.current = false;
      setDragging(false);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, []); // setOffsetX/Y and setDragging are stable across renders

  // ── Pointer-down on canvas ──────────────────────────────────────────────────
  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!hasImage) return;
    isDragging.current = true;
    setDragging(true);
    lastClientPos.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }

  function handleTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    if (!hasImage || e.touches.length !== 1) return;
    isDragging.current = true;
    setDragging(true);
    lastClientPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }

  // ── File picker ─────────────────────────────────────────────────────────────
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      imgRef.current = img;
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      setContrast(100);
      setSaturation(100);
      setHasImage(true);
    };
    img.src = url;
    e.target.value = '';
  }

  return (
    <div className={styles.fileTab}>
      <div className={styles.canvasArea}>
        <canvas
          ref={canvasRef}
          width={200}
          height={200}
          className={`${styles.previewCanvas} ${hasImage ? (dragging ? styles.canvasDragging : styles.canvasGrab) : ''}`}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
        />
        {!hasImage && (
          <div className={styles.uploadPlaceholder} onClick={() => fileInputRef.current?.click()}>
            <Upload size={22} />
            <span>Click to upload</span>
          </div>
        )}
        {hasImage && !dragging && (
          <div className={styles.dragHint}>drag to reposition</div>
        )}
      </div>

      <div className={styles.fileControls}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFile}
        />
        {hasImage && (
          <button
            type="button"
            className={styles.changeBtn}
            onClick={() => fileInputRef.current?.click()}
          >
            Change image
          </button>
        )}
        <Slider label="Zoom" min={0.5} max={3} step={0.01} value={zoom} onChange={setZoom} disabled={!hasImage} />
        <Slider label="Contrast" min={0} max={200} step={1} value={contrast} onChange={setContrast} disabled={!hasImage} />
        <Slider label="Saturation" min={0} max={200} step={1} value={saturation} onChange={setSaturation} disabled={!hasImage} />
      </div>
    </div>
  );
}

// ── Dialog ────────────────────────────────────────────────────────────────────

export interface AvatarPickerDialogProps {
  name: string;
  onApply: (dataUrl: string) => void;
  onClose: () => void;
}

export function AvatarPickerDialog({ name, onApply, onClose }: AvatarPickerDialogProps) {
  const [tab, setTab] = useState<Tab>('initial');
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);

  function handleTabChange(t: Tab) {
    setTab(t);
    setPreview(null);
    setSelectedAvatar(null);
  }

  function handleApply() {
    if (preview) {
      onApply(preview);
      onClose();
    }
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Edit avatar">
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>Edit avatar</span>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>

        <div className={styles.tabBar}>
          {(['initial', 'avatar', 'file'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.tabBtn} ${tab === t ? styles.tabBtnActive : ''}`}
              onClick={() => handleTabChange(t)}
            >
              {t === 'initial' ? 'Initial' : t === 'avatar' ? 'Avatar' : 'Upload'}
            </button>
          ))}
        </div>

        <div className={styles.dialogBody}>
          {tab === 'initial' && <InitialTab name={name} onPreview={setPreview} />}
          {tab === 'avatar' && (
            <AvatarTab
              selected={selectedAvatar}
              onSelect={setSelectedAvatar}
              onPreview={setPreview}
            />
          )}
          {tab === 'file' && <FileTab onPreview={setPreview} />}
        </div>

        <div className={styles.dialogFooter}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.applyBtn}
            disabled={!preview}
            onClick={handleApply}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
