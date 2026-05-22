'use client';

import React from 'react';
import type { SlideTheme } from '@neutrino/api-slides';
import type { LayoutPreviewRect } from './slideEditorTypes';

/** Small SVG thumbnail used inside the layout picker grid. */
export function LayoutPreview({ shapes }: { shapes: LayoutPreviewRect[] }) {
  return (
    <svg viewBox="0 0 160 90" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', width: '100%', height: '100%' }}>
      <rect x="0" y="0" width="160" height="90" fill="#f9fafb" rx="2" />
      {shapes.map((s, i) => (
        <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.fill} rx={s.rx ?? 1} />
      ))}
    </svg>
  );
}

/** Small thumbnail used inside the theme picker grid. */
export function ThemePreview({ theme }: { theme: SlideTheme }) {
  const bgStyle: React.CSSProperties = theme.backgroundImage
    ? { backgroundImage: `url(${theme.backgroundImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: theme.gradientBackground ?? theme.backgroundColor };
  return (
    <div style={{ position: 'absolute', inset: 0, ...bgStyle }}>
      {/* Title bar */}
      <div style={{
        position: 'absolute', top: '22%', left: '10%', right: '10%', height: '14%',
        background: theme.primaryColor, borderRadius: 2,
      }} />
      {/* Content lines */}
      <div style={{
        position: 'absolute', top: '44%', left: '10%', right: '22%', height: '9%',
        background: theme.accentColor, opacity: 0.75, borderRadius: 1,
      }} />
      <div style={{
        position: 'absolute', top: '58%', left: '10%', right: '32%', height: '9%',
        background: theme.accentColor, opacity: 0.5, borderRadius: 1,
      }} />
      <div style={{
        position: 'absolute', top: '72%', left: '10%', right: '27%', height: '9%',
        background: theme.accentColor, opacity: 0.35, borderRadius: 1,
      }} />
    </div>
  );
}
