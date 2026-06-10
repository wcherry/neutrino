'use client';

import React from 'react';
import styles from './Ruler.module.css';

const RULER_THICKNESS = 20;   // horizontal ruler height
const V_RULER_THICKNESS = 28;  // vertical ruler width — wider to fit larger labels
const PX_PER_INCH = 96;
// Ticks at every 1/8 inch (12 px)
const TICKS_PER_INCH = 8;
const TICK_SPACING = PX_PER_INCH / TICKS_PER_INCH; // 12 px

function hTickHeight(idx: number): number {
  if (idx % TICKS_PER_INCH === 0) return 10;
  if (idx % 4 === 0) return 6;
  if (idx % 2 === 0) return 4;
  return 2;
}

// ── Horizontal ruler (top) ────────────────────────────────────────────────

export interface HorizontalRulerProps {
  pageWidthPx: number;
  marginLeftPx: number;
  marginRightPx: number;
}

export function HorizontalRuler({ pageWidthPx, marginLeftPx, marginRightPx }: HorizontalRulerProps) {
  const ticks: React.ReactNode[] = [];
  const total = Math.ceil(pageWidthPx / TICK_SPACING);

  for (let i = 0; i <= total; i++) {
    const x = i * TICK_SPACING;
    if (x > pageWidthPx) break;
    const h = hTickHeight(i);
    ticks.push(
      <line
        key={i}
        x1={x + 0.5} y1={RULER_THICKNESS - h}
        x2={x + 0.5} y2={RULER_THICKNESS}
        stroke="#9aa0a6"
        strokeWidth="0.75"
      />
    );
    if (i > 0 && i % TICKS_PER_INCH === 0) {
      ticks.push(
        <text
          key={`n${i}`}
          x={x}
          y={RULER_THICKNESS - 10}
          textAnchor="middle"
          fontSize="9"
          fontWeight="600"
          fill="#3c4043"
          fontFamily="Arial, sans-serif"
        >
          {i / TICKS_PER_INCH}
        </text>
      );
    }
  }

  return (
    <div className={styles.hRuler} style={{ width: pageWidthPx }}>
      {/* Margin zones */}
      <div className={styles.hMarginZone} style={{ left: 0, width: marginLeftPx }} />
      <div className={styles.hMarginZone} style={{ right: 0, width: marginRightPx }} />
      <svg width={pageWidthPx} height={RULER_THICKNESS} style={{ display: 'block', position: 'relative' }}>
        {ticks}
      </svg>
    </div>
  );
}

// ── Vertical ruler (side) ─────────────────────────────────────────────────

export interface VerticalRulerProps {
  pageHeightPx: number;
  marginTopPx: number;
  marginBottomPx: number;
  totalPages: number;
}

export function VerticalRuler({ pageHeightPx, marginTopPx, marginBottomPx, totalPages }: VerticalRulerProps) {
  const contentHeightPx = pageHeightPx - marginTopPx - marginBottomPx;
  const totalHeight = totalPages * pageHeightPx;
  const ticks: React.ReactNode[] = [];
  const segments: React.ReactNode[] = [];

  // Text is centered at x=10, well clear of tick marks which start at x=18 (w=10)
  const TEXT_X = 10;

  for (let p = 0; p < totalPages; p++) {
    const top = p * pageHeightPx;
    segments.push(
      <rect key={`tm${p}`} x={0} y={top}                              width={V_RULER_THICKNESS} height={marginTopPx}    fill="#e8eaed" />,
      <rect key={`ct${p}`} x={0} y={top + marginTopPx}                width={V_RULER_THICKNESS} height={contentHeightPx} fill="#ffffff" />,
      <rect key={`bm${p}`} x={0} y={top + marginTopPx + contentHeightPx} width={V_RULER_THICKNESS} height={marginBottomPx} fill="#e8eaed" />,
    );
  }

  const totalTicks = Math.ceil(totalHeight / TICK_SPACING);
  for (let i = 0; i <= totalTicks; i++) {
    const y = i * TICK_SPACING;
    if (y > totalHeight) break;

    const pageIdx = Math.floor(y / pageHeightPx);
    const posInPage = y - pageIdx * pageHeightPx;
    const tickInPage = Math.round(posInPage / TICK_SPACING);

    let w: number;
    if (tickInPage % TICKS_PER_INCH === 0) w = 10;
    else if (tickInPage % 4 === 0) w = 6;
    else if (tickInPage % 2 === 0) w = 4;
    else w = 2;

    ticks.push(
      <line
        key={i}
        x1={V_RULER_THICKNESS - w} y1={y + 0.5}
        x2={V_RULER_THICKNESS}     y2={y + 0.5}
        stroke="#9aa0a6"
        strokeWidth="0.75"
      />
    );

    if (tickInPage > 0 && tickInPage % TICKS_PER_INCH === 0) {
      const inch = tickInPage / TICKS_PER_INCH;
      ticks.push(
        <text
          key={`n${i}`}
          x={TEXT_X}
          y={y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="9"
          fontWeight="600"
          fill="#3c4043"
          fontFamily="Arial, sans-serif"
        >
          {inch}
        </text>
      );
    }
  }

  return (
    <div className={styles.vRulerOuter} style={{ height: totalHeight }}>
      <svg width={V_RULER_THICKNESS} height={totalHeight} style={{ display: 'block' }}>
        {segments}
        {ticks}
      </svg>
    </div>
  );
}
