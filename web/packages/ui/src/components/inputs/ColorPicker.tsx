'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import styles from './ColorPicker.module.css';

// ── Color math ────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
    const n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b]
        .map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
        .join('');
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const v = max, s = max === 0 ? 0 : d / max;
    let h = 0;
    if (d > 0) {
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return [h, s, v];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const i = Math.floor(h * 6) % 6;
    const f = h * 6 - Math.floor(h * 6);
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    let r = 0, g = 0, b = 0;
    switch (i) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function rgbToLch(r: number, g: number, b: number): [number, number, number] {
    const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const R = lin(r), G = lin(g), B = lin(b);
    const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
    const Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
    const Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041;
    const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    const fy = f(Y), L = 116 * fy - 16;
    const a = 500 * (f(X / 0.95047) - fy);
    const bv = 200 * (fy - f(Z / 1.08883));
    const C = Math.sqrt(a * a + bv * bv);
    let H = Math.atan2(bv, a) * 180 / Math.PI;
    if (H < 0) H += 360;
    return [
        Math.round(L * 10) / 10,
        Math.round(C * 10) / 10,
        Math.round(H * 10) / 10,
    ];
}

function lchToRgb(L: number, C: number, H: number): [number, number, number] {
    const hr = H * Math.PI / 180;
    const a = C * Math.cos(hr), bv = C * Math.sin(hr);
    const fy = (L + 16) / 116, fx = a / 500 + fy, fz = fy - bv / 200;
    const fn = (t: number) => t > 0.206897 ? t * t * t : (t - 16 / 116) / 7.787;
    const X = fn(fx) * 0.95047, Y = fn(fy), Z = fn(fz) * 1.08883;
    const rl =  X * 3.2404542 - Y * 1.5371385 - Z * 0.4985314;
    const gl = -X * 0.9692660 + Y * 1.8760108 + Z * 0.0415560;
    const bl =  X * 0.0556434 - Y * 0.2040259 + Z * 1.0572252;
    const gm = (c: number) => { c = Math.max(0, Math.min(1, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
    return [Math.round(gm(rl) * 255), Math.round(gm(gl) * 255), Math.round(gm(bl) * 255)];
}

// ── Palette: 10 cols × 8 rows = 80 colors ─────────────────────────────
// Row-major; each column is a hue family, rows go dark→light
const PALETTE: string[] = [
    // Row 0 – darkest
    '#4d0000','#4d2200','#4d4400','#1a4d00','#004d1a','#004d4d','#00004d','#1a0066','#4d0033','#000000',
    // Row 1
    '#800000','#7a3600','#7a6c00','#2e7a00','#007a29','#007a7a','#00007a','#2900a0','#7a0052','#262626',
    // Row 2
    '#b30000','#b35200','#b39d00','#44b300','#00b33d','#00b3b3','#0000b3','#4400cc','#b30077','#4d4d4d',
    // Row 3
    '#e60000','#e66a00','#e6c800','#56e600','#00e64d','#00e6e6','#0022e6','#6600ff','#e6009a','#666666',
    // Row 4 – vivid
    '#ff3333','#ff8533','#ffdf1a','#77ff1a','#33ff66','#33ffff','#3355ff','#8844ff','#ff33bb','#888888',
    // Row 5
    '#ff8080','#ffb380','#ffec66','#aaff66','#80ffaa','#80ffff','#8088ff','#bb88ff','#ff80d5','#b3b3b3',
    // Row 6
    '#ffb3b3','#ffd4b3','#fff4b3','#ccffb3','#b3ffd1','#b3ffff','#b3b8ff','#ddb3ff','#ffb3e8','#cccccc',
    // Row 7 – lightest
    '#ffe5e5','#ffece5','#fffce5','#eaffe5','#e5fff0','#e5ffff','#e5e8ff','#f2e5ff','#ffe5f5','#ffffff',
];

// ── Wheel canvas ───────────────────────────────────────────────────────

const WHEEL_SIZE = 164;
const WHEEL_R = WHEEL_SIZE / 2;

function drawWheel(ctx: CanvasRenderingContext2D, value: number) {
    const img = ctx.createImageData(WHEEL_SIZE, WHEEL_SIZE);
    const { data } = img;
    for (let y = 0; y < WHEEL_SIZE; y++) {
        for (let x = 0; x < WHEEL_SIZE; x++) {
            const dx = x - WHEEL_R, dy = y - WHEEL_R;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const idx = (y * WHEEL_SIZE + x) * 4;
            if (dist > WHEEL_R) { data[idx + 3] = 0; continue; }
            const h = ((Math.atan2(dy, dx) / (2 * Math.PI)) + 1) % 1;
            const s = dist / WHEEL_R;
            const [r, g, b] = hsvToRgb(h, s, value);
            data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

// ── Component ──────────────────────────────────────────────────────────

type Tab = 'swatches' | 'wheel' | 'values';

export interface ColorPickerProps {
    value: string;   // hex string
    onChange: (hex: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
    const safeHex = /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : '#000000';
    const [tab, setTab] = useState<Tab>('swatches');
    const [hex, setHex] = useState(safeHex);
    const [hexInput, setHexInput] = useState(safeHex);

    // Sync when controlled value changes from outside
    useEffect(() => {
        if (safeHex !== hex) {
            setHex(safeHex);
            setHexInput(safeHex);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [safeHex]);

    const commit = useCallback((h: string) => {
        setHex(h);
        setHexInput(h);
        onChange(h);
    }, [onChange]);

    const [r, g, b] = hexToRgb(hex);
    const [hsvH, hsvS, hsvV] = rgbToHsv(r, g, b);
    const [lchL, lchC, lchH] = rgbToLch(r, g, b);

    // Wheel
    const wheelRef = useRef<HTMLCanvasElement>(null);
    const dragging = useRef(false);
    const [brightness, setBrightness] = useState(hsvV);

    useEffect(() => {
        setBrightness(rgbToHsv(...hexToRgb(hex))[2]);
    }, [hex]);

    useEffect(() => {
        const canvas = wheelRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (ctx) drawWheel(ctx, brightness);
    }, [brightness, tab]);

    const pickWheel = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = wheelRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const dx = e.clientX - rect.left - WHEEL_R;
        const dy = e.clientY - rect.top - WHEEL_R;
        const dist = Math.min(Math.sqrt(dx * dx + dy * dy), WHEEL_R);
        const h = ((Math.atan2(dy, dx) / (2 * Math.PI)) + 1) % 1;
        const s = dist / WHEEL_R;
        commit(rgbToHex(...hsvToRgb(h, s, brightness)));
    }, [brightness, commit]);

    // Dot position on wheel
    const dotX = WHEEL_R + hsvS * WHEEL_R * Math.cos(hsvH * 2 * Math.PI);
    const dotY = WHEEL_R + hsvS * WHEEL_R * Math.sin(hsvH * 2 * Math.PI);

    return (
        <div className={styles.picker}>
            {/* Tab bar */}
            <div className={styles.tabs}>
                {(['swatches', 'wheel', 'values'] as Tab[]).map(t => (
                    <button
                        key={t}
                        className={`${styles.tab}${tab === t ? ` ${styles.tabActive}` : ''}`}
                        onClick={() => setTab(t)}
                    >
                        {t === 'swatches' ? 'Grid' : t === 'wheel' ? 'Wheel' : 'Values'}
                    </button>
                ))}
            </div>

            {/* ── Grid tab ── */}
            {tab === 'swatches' && (
                <div className={styles.swatchGrid}>
                    {PALETTE.map((c, i) => (
                        <button
                            key={i}
                            className={`${styles.swatch}${hex === c.toLowerCase() ? ` ${styles.swatchSelected}` : ''}`}
                            style={{ backgroundColor: c }}
                            onClick={() => commit(c.toLowerCase())}
                            title={c}
                        />
                    ))}
                </div>
            )}

            {/* ── Wheel tab ── */}
            {tab === 'wheel' && (
                <div className={styles.wheelTab}>
                    <div className={styles.wheelWrap}>
                        <canvas
                            ref={wheelRef}
                            width={WHEEL_SIZE}
                            height={WHEEL_SIZE}
                            className={styles.wheelCanvas}
                            onMouseDown={e => { dragging.current = true; pickWheel(e); }}
                            onMouseMove={e => { if (dragging.current) pickWheel(e); }}
                            onMouseUp={() => { dragging.current = false; }}
                            onMouseLeave={() => { dragging.current = false; }}
                        />
                        <div
                            className={styles.wheelDot}
                            style={{ left: dotX, top: dotY }}
                        />
                    </div>
                    <div className={styles.brightnessRow}>
                        <span className={styles.sliderLabel}>V</span>
                        <input
                            type="range"
                            min={0} max={100}
                            value={Math.round(brightness * 100)}
                            className={styles.brightnessSlider}
                            onChange={e => {
                                const v = parseInt(e.target.value) / 100;
                                setBrightness(v);
                                commit(rgbToHex(...hsvToRgb(hsvH, hsvS, v)));
                            }}
                        />
                        <span className={styles.sliderValue}>{Math.round(brightness * 100)}</span>
                    </div>
                </div>
            )}

            {/* ── Values tab ── */}
            {tab === 'values' && (
                <div className={styles.valuesTab}>
                    <div className={styles.valuePreview} style={{ backgroundColor: hex }} />

                    <div className={styles.valueGroup}>
                        <span className={styles.valueGroupLabel}>Hex</span>
                        <input
                            className={styles.hexInput}
                            value={hexInput}
                            spellCheck={false}
                            onChange={e => {
                                const v = e.target.value;
                                setHexInput(v);
                                if (/^#[0-9a-fA-F]{6}$/.test(v)) commit(v.toLowerCase());
                            }}
                            onBlur={() => setHexInput(hex)}
                        />
                    </div>

                    <div className={styles.valueGroup}>
                        <span className={styles.valueGroupLabel}>RGB</span>
                        <div className={styles.valueFields}>
                            {([['R', r, (v: number) => commit(rgbToHex(v, g, b))],
                               ['G', g, (v: number) => commit(rgbToHex(r, v, b))],
                               ['B', b, (v: number) => commit(rgbToHex(r, g, v))]] as [string, number, (v: number) => void][])
                                .map(([label, val, fn]) => (
                                    <label key={label} className={styles.valueField}>
                                        <span className={styles.valueLabel}>{label}</span>
                                        <input
                                            type="number" min={0} max={255}
                                            className={styles.valueInput}
                                            value={val}
                                            onChange={e => fn(Math.round(Math.max(0, Math.min(255, parseInt(e.target.value) || 0))))}
                                        />
                                    </label>
                                ))}
                        </div>
                    </div>

                    <div className={styles.valueGroup}>
                        <span className={styles.valueGroupLabel}>LCH</span>
                        <div className={styles.valueFields}>
                            {([['L', lchL, 0, 100, (v: number) => commit(rgbToHex(...lchToRgb(v, lchC, lchH)))],
                               ['C', lchC, 0, 150, (v: number) => commit(rgbToHex(...lchToRgb(lchL, v, lchH)))],
                               ['H', lchH, 0, 360, (v: number) => commit(rgbToHex(...lchToRgb(lchL, lchC, v)))]] as [string, number, number, number, (v: number) => void][])
                                .map(([label, val, min, max, fn]) => (
                                    <label key={label} className={styles.valueField}>
                                        <span className={styles.valueLabel}>{label}</span>
                                        <input
                                            type="number" min={min} max={max} step={0.1}
                                            className={styles.valueInput}
                                            value={val}
                                            onChange={e => fn(Math.max(min, Math.min(max, parseFloat(e.target.value) || 0)))}
                                        />
                                    </label>
                                ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Bottom preview */}
            <div className={styles.pickerBottom}>
                <div className={styles.bottomSwatch} style={{ backgroundColor: hex }} />
                <span className={styles.bottomHex}>{hex}</span>
            </div>
        </div>
    );
}
