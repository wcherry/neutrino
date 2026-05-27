import type React from 'react';
import type { Theme, SlideMaster, SlidePresentation, SlideLayout, SlideElement } from './slideEditorTypes';

// ── Preview color tokens ──────────────────────────────────────────────────────

export const TITLE_PV = '#4f46e5';   // preview accent (title bars)
export const BODY_PV  = '#d1d5db';   // preview body lines
export const BOX_PV   = '#e5e7eb';   // preview content area box
export const SUB_PV   = '#9ca3af';   // preview subtitle / caption

// ── Utilities ─────────────────────────────────────────────────────────────────

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_THEME: Theme = {
  name: 'Default',
  primaryColor: '#4f46e5',
  backgroundColor: '#ffffff',
  textColor: '#1f2937',
  accentColor: '#818cf8',
  fontFamily: 'Inter',
  defaultTransition: 'fade',
};

export function makeDefaultMaster(): SlideMaster {
  return {
    background: '#ffffff',
    titleFontSize: 40,
    titleBold: true,
    titleColor: '#1f2937',
    bodyFontSize: 24,
    bodyBold: false,
    bodyColor: '#6b7280',
  };
}

export function makeDefaultPresentation(): SlidePresentation {
  return {
    slides: [
      {
        id: uid(),
        background: { type: 'color', value: '#ffffff' },
        elements: [
          {
            id: uid(),
            type: 'text',
            x: 10, y: 30, w: 80, h: 20,
            content: 'Click to add title',
            style: { fontSize: 40, bold: true, italic: false, underline: false, color: '#1f2937', align: 'center', fontFamily: 'Inter' },
          },
          {
            id: uid(),
            type: 'text',
            x: 15, y: 55, w: 70, h: 15,
            content: 'Click to add subtitle',
            style: { fontSize: 24, bold: false, italic: false, underline: false, color: '#6b7280', align: 'center', fontFamily: 'Inter' },
          },
        ],
        notes: '',
        transition: 'fade',
      },
    ],
    theme: DEFAULT_THEME,
    master: makeDefaultMaster(),
  };
}

// ── Shape catalog ─────────────────────────────────────────────────────────────

export const SHAPE_CATALOG: Record<string, { label: string; group: 'general' | 'arrows' | 'callouts'; path: string }> = {
  // General
  'rect':           { label: 'Rectangle',          group: 'general',
    path: 'M 0,0 H 100 V 100 H 0 Z' },
  'rounded-rect':   { label: 'Rounded Rect',        group: 'general',
    path: 'M 15,0 H 85 Q 100,0 100,15 V 85 Q 100,100 85,100 H 15 Q 0,100 0,85 V 15 Q 0,0 15,0 Z' },
  'circle':         { label: 'Circle',              group: 'general',
    path: 'M 50,0 C 77.6,0 100,22.4 100,50 C 100,77.6 77.6,100 50,100 C 22.4,100 0,77.6 0,50 C 0,22.4 22.4,0 50,0 Z' },
  'triangle':       { label: 'Triangle',            group: 'general',
    path: 'M 50,0 L 100,100 L 0,100 Z' },
  'right-triangle': { label: 'Right Triangle',      group: 'general',
    path: 'M 0,0 L 100,100 L 0,100 Z' },
  'parallelogram':  { label: 'Parallelogram',       group: 'general',
    path: 'M 20,0 L 100,0 L 80,100 L 0,100 Z' },
  'trapezoid':      { label: 'Trapezoid',           group: 'general',
    path: 'M 20,0 L 80,0 L 100,100 L 0,100 Z' },
  'diamond':        { label: 'Diamond',             group: 'general',
    path: 'M 50,0 L 100,50 L 50,100 L 0,50 Z' },
  'pentagon':       { label: 'Pentagon',            group: 'general',
    path: 'M 50,0 L 97.6,34.5 L 79.4,90.5 L 20.6,90.5 L 2.4,34.5 Z' },
  'hexagon':        { label: 'Hexagon',             group: 'general',
    path: 'M 50,0 L 93.3,25 L 93.3,75 L 50,100 L 6.7,75 L 6.7,25 Z' },
  'octagon':        { label: 'Octagon',             group: 'general',
    path: 'M 30,0 L 70,0 L 100,30 L 100,70 L 70,100 L 30,100 L 0,70 L 0,30 Z' },
  'cross':          { label: 'Cross',               group: 'general',
    path: 'M 35,0 H 65 V 35 H 100 V 65 H 65 V 100 H 35 V 65 H 0 V 35 H 35 Z' },
  'star4':          { label: '4-Point Star',        group: 'general',
    path: 'M 50,0 L 64,36 L 100,50 L 64,64 L 50,100 L 36,64 L 0,50 L 36,36 Z' },
  'star5':          { label: '5-Point Star',        group: 'general',
    path: 'M 50,0 L 62,34 L 98,35 L 69,56 L 79,91 L 50,70 L 21,91 L 31,56 L 2,35 L 38,34 Z' },
  'star6':          { label: '6-Point Star',        group: 'general',
    path: 'M 50,0 L 62.5,28 L 93.3,25 L 75,50 L 93.3,75 L 62.5,72 L 50,100 L 37.5,72 L 6.7,75 L 25,50 L 6.7,25 L 37.5,28 Z' },
  'heart':          { label: 'Heart',               group: 'general',
    path: 'M 50,85 C 10,65 0,40 15,25 C 25,15 38,18 50,32 C 62,18 75,15 85,25 C 100,40 90,65 50,85 Z' },

  // Arrows
  'arrow-right':    { label: 'Right Arrow',         group: 'arrows',
    path: 'M 0,30 H 60 V 10 L 100,50 L 60,90 V 70 H 0 Z' },
  'arrow-left':     { label: 'Left Arrow',          group: 'arrows',
    path: 'M 100,30 H 40 V 10 L 0,50 L 40,90 V 70 H 100 Z' },
  'arrow-up':       { label: 'Up Arrow',            group: 'arrows',
    path: 'M 30,100 V 45 H 10 L 50,0 L 90,45 H 70 V 100 Z' },
  'arrow-down':     { label: 'Down Arrow',          group: 'arrows',
    path: 'M 30,0 V 55 H 10 L 50,100 L 90,55 H 70 V 0 Z' },
  'arrow-lr':       { label: 'Left-Right Arrow',    group: 'arrows',
    path: 'M 0,50 L 25,10 V 35 H 75 V 10 L 100,50 L 75,90 V 65 H 25 V 90 Z' },
  'arrow-ud':       { label: 'Up-Down Arrow',       group: 'arrows',
    path: 'M 50,0 L 90,25 H 65 V 75 H 90 L 50,100 L 10,75 H 35 V 25 H 10 Z' },
  'chevron-r':      { label: 'Chevron Right',       group: 'arrows',
    path: 'M 0,0 H 65 L 100,50 L 65,100 H 0 L 35,50 Z' },
  'chevron-l':      { label: 'Chevron Left',        group: 'arrows',
    path: 'M 100,0 H 35 L 0,50 L 35,100 H 100 L 65,50 Z' },
  'arrow-pentagon': { label: 'Pentagon Arrow',      group: 'arrows',
    path: 'M 0,0 H 70 L 100,50 L 70,100 H 0 Z' },
  'arrow-notched':  { label: 'Notched Arrow',       group: 'arrows',
    path: 'M 0,25 H 60 V 0 L 100,50 L 60,100 V 75 H 0 L 20,50 Z' },
  'arrow-quad':     { label: 'Four Arrows',         group: 'arrows',
    path: 'M 50,0 L 65,20 L 57,20 L 57,43 L 80,43 L 80,35 L 100,50 L 80,65 L 80,57 L 57,57 L 57,80 L 65,80 L 50,100 L 35,80 L 43,80 L 43,57 L 20,57 L 20,65 L 0,50 L 20,35 L 20,43 L 43,43 L 43,20 L 35,20 Z' },

  // Callouts
  'callout-rect':    { label: 'Rect Callout',       group: 'callouts',
    path: 'M 0,0 H 100 V 70 H 35 L 15,100 L 25,70 H 0 Z' },
  'callout-rounded': { label: 'Rounded Callout',    group: 'callouts',
    path: 'M 12,0 H 88 Q 100,0 100,12 V 58 Q 100,70 88,70 H 35 L 15,100 L 25,70 H 12 Q 0,70 0,58 V 12 Q 0,0 12,0 Z' },
  'callout-oval':    { label: 'Oval Callout',       group: 'callouts',
    path: 'M 50,0 C 80,0 100,17 100,45 C 100,65 85,78 65,80 L 30,100 L 55,78 C 25,74 0,62 0,45 C 0,17 20,0 50,0 Z' },
  'callout-cloud':   { label: 'Cloud Callout',      group: 'callouts',
    path: 'M 48,8 C 58,2 72,6 76,16 C 85,14 95,22 93,33 C 100,36 103,46 97,52 C 102,58 100,70 90,72 C 90,82 80,88 70,84 C 65,92 53,95 46,88 C 38,94 26,91 24,82 C 14,82 6,74 8,64 C 0,60 -2,48 5,42 C 0,35 4,24 13,22 C 12,11 22,4 32,8 C 36,2 45,2 48,8 Z M 28,88 C 24,93 20,97 17,100 C 20,96 22,90 24,82 Z' },
};

export const SHAPE_GROUPS: Array<{ key: 'general' | 'arrows' | 'callouts'; label: string }> = [
  { key: 'general',  label: 'General' },
  { key: 'arrows',   label: 'Arrows' },
  { key: 'callouts', label: 'Callouts' },
];

// ── Line catalog ──────────────────────────────────────────────────────────────

export const LINE_CATALOG: Record<string, {
  label: string;
  strokeDash?: string;
  startArrow?: 'none' | 'arrow' | 'triangle';
  endArrow?: 'none' | 'arrow' | 'triangle';
}> = {
  straight:       { label: 'Line' },
  'arrow-left':   { label: 'Left Arrow',    startArrow: 'triangle' },
  arrow:          { label: 'Right Arrow',   endArrow: 'triangle' },
  'double-arrow': { label: 'Double Arrow',  startArrow: 'triangle', endArrow: 'triangle' },
  dashed:         { label: 'Dashed',        strokeDash: '8 4' },
  'dashed-arrow': { label: 'Dashed Arrow',  strokeDash: '8 4', endArrow: 'triangle' },
};

// ── Background gradients ──────────────────────────────────────────────────────

export const PRESET_GRADIENTS = [
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

// ── Resize handles ────────────────────────────────────────────────────────────

export const RESIZE_HANDLES: Array<{ id: string; cursor: React.CSSProperties['cursor']; top: string; left: string }> = [
  { id: 'nw', cursor: 'nw-resize', top: '0%',   left: '0%'   },
  { id: 'n',  cursor: 'n-resize',  top: '0%',   left: '50%'  },
  { id: 'ne', cursor: 'ne-resize', top: '0%',   left: '100%' },
  { id: 'e',  cursor: 'e-resize',  top: '50%',  left: '100%' },
  { id: 'se', cursor: 'se-resize', top: '100%', left: '100%' },
  { id: 's',  cursor: 's-resize',  top: '100%', left: '50%'  },
  { id: 'sw', cursor: 'sw-resize', top: '100%', left: '0%'   },
  { id: 'w',  cursor: 'w-resize',  top: '50%',  left: '0%'   },
];

// ── Slide layouts ─────────────────────────────────────────────────────────────

export const SLIDE_LAYOUTS: SlideLayout[] = [
  // 1. Blank
  {
    id: 'blank',
    name: 'Blank',
    preview: [],
    makeElements: () => [],
  },

  // 2. Title Slide
  {
    id: 'title-slide',
    name: 'Title Slide',
    preview: [
      { x: 16, y: 24, w: 128, h: 14, fill: TITLE_PV },
      { x: 36, y: 44, w: 88,  h:  7, fill: SUB_PV },
    ],
    makeElements: (_theme, master) => [
      { id: uid(), type: 'text', x: 10, y: 25, w: 80, h: 22,
        content: 'Presentation Title',
        style: { fontSize: master.titleFontSize, bold: master.titleBold, italic: false, underline: false,
                 color: master.titleColor, align: 'center', fontFamily: 'Inter' } },
      { id: uid(), type: 'text', x: 15, y: 53, w: 70, h: 12,
        content: 'Subtitle or author name',
        style: { fontSize: master.bodyFontSize, bold: false, italic: false, underline: false,
                 color: master.bodyColor, align: 'center', fontFamily: 'Inter' } },
    ],
  },

  // 3. Title and Content
  {
    id: 'title-content',
    name: 'Title & Content',
    preview: [
      { x: 8,  y:  5, w: 96,  h:  9, fill: TITLE_PV },
      { x: 8,  y: 16, w: 144, h:  1, fill: BOX_PV, rx: 0 },
      { x: 8,  y: 21, w: 144, h:  5, fill: BODY_PV },
      { x: 8,  y: 30, w: 120, h:  5, fill: BODY_PV },
      { x: 8,  y: 39, w: 132, h:  5, fill: BODY_PV },
      { x: 8,  y: 48, w: 100, h:  5, fill: BODY_PV },
      { x: 8,  y: 57, w: 112, h:  5, fill: BODY_PV },
      { x: 8,  y: 66, w: 88,  h:  5, fill: BODY_PV },
    ],
    makeElements: (theme, master) => [
      { id: uid(), type: 'text', x: 5, y: 5, w: 90, h: 14,
        content: 'Slide Title',
        style: { fontSize: master.titleFontSize, bold: master.titleBold, italic: false, underline: false,
                 color: master.titleColor, align: 'left', fontFamily: 'Inter' } },
      { id: uid(), type: 'shape', shape: 'rect', x: 5, y: 20, w: 90, h: 1,
        fill: theme.primaryColor, stroke: 'transparent', strokeWidth: 0 },
      { id: uid(), type: 'text', x: 5, y: 24, w: 90, h: 66,
        content: 'Click to add content',
        style: { fontSize: master.bodyFontSize, bold: master.bodyBold, italic: false, underline: false,
                 color: master.bodyColor, align: 'left', fontFamily: 'Inter' } },
    ],
  },

  // 4. Title Only
  {
    id: 'title-only',
    name: 'Title Only',
    preview: [
      { x: 8, y: 5, w: 96, h: 9, fill: TITLE_PV },
      { x: 8, y: 16, w: 144, h: 1, fill: BOX_PV, rx: 0 },
    ],
    makeElements: (theme, master) => [
      { id: uid(), type: 'text', x: 5, y: 5, w: 90, h: 16,
        content: 'Slide Title',
        style: { fontSize: master.titleFontSize, bold: master.titleBold, italic: false, underline: false,
                 color: master.titleColor, align: 'left', fontFamily: 'Inter' } },
      { id: uid(), type: 'shape', shape: 'rect', x: 5, y: 22, w: 90, h: 1,
        fill: theme.primaryColor, stroke: 'transparent', strokeWidth: 0 },
    ],
  },

  // 5. Section Header
  {
    id: 'section-header',
    name: 'Section Header',
    preview: [
      { x: 16, y: 26, w: 128, h: 16, fill: TITLE_PV },
      { x: 40, y: 48, w: 80,  h:  7, fill: SUB_PV },
    ],
    makeElements: (_theme, master) => [
      { id: uid(), type: 'text', x: 10, y: 30, w: 80, h: 26,
        content: 'Section Title',
        style: { fontSize: Math.round(master.titleFontSize * 1.1), bold: true, italic: false, underline: false,
                 color: master.titleColor, align: 'center', fontFamily: 'Inter' } },
      { id: uid(), type: 'text', x: 20, y: 60, w: 60, h: 12,
        content: 'Section subtitle',
        style: { fontSize: master.bodyFontSize, bold: false, italic: false, underline: false,
                 color: master.bodyColor, align: 'center', fontFamily: 'Inter' } },
    ],
  },

  // 6. Two Column
  {
    id: 'two-column',
    name: 'Two Column',
    preview: [
      { x: 8,  y:  5, w: 96,  h:  9, fill: TITLE_PV },
      { x: 8,  y: 16, w: 144, h:  1, fill: BOX_PV, rx: 0 },
      { x: 8,  y: 21, w: 66,  h:  5, fill: BODY_PV },
      { x: 8,  y: 30, w: 56,  h:  5, fill: BODY_PV },
      { x: 8,  y: 39, w: 62,  h:  5, fill: BODY_PV },
      { x: 8,  y: 48, w: 50,  h:  5, fill: BODY_PV },
      { x: 86, y: 21, w: 66,  h:  5, fill: BODY_PV },
      { x: 86, y: 30, w: 56,  h:  5, fill: BODY_PV },
      { x: 86, y: 39, w: 62,  h:  5, fill: BODY_PV },
      { x: 86, y: 48, w: 50,  h:  5, fill: BODY_PV },
    ],
    makeElements: (theme, master) => [
      { id: uid(), type: 'text', x: 5, y: 5, w: 90, h: 14,
        content: 'Two Column Layout',
        style: { fontSize: master.titleFontSize, bold: master.titleBold, italic: false, underline: false,
                 color: master.titleColor, align: 'center', fontFamily: 'Inter' } },
      { id: uid(), type: 'shape', shape: 'rect', x: 5, y: 20, w: 90, h: 1,
        fill: theme.primaryColor, stroke: 'transparent', strokeWidth: 0 },
      { id: uid(), type: 'text', x: 5, y: 24, w: 43, h: 66,
        content: 'Left Column\n\n• Point one\n• Point two\n• Point three',
        style: { fontSize: master.bodyFontSize, bold: master.bodyBold, italic: false, underline: false,
                 color: master.bodyColor, align: 'left', fontFamily: 'Inter' } },
      { id: uid(), type: 'text', x: 52, y: 24, w: 43, h: 66,
        content: 'Right Column\n\n• Point one\n• Point two\n• Point three',
        style: { fontSize: master.bodyFontSize, bold: master.bodyBold, italic: false, underline: false,
                 color: master.bodyColor, align: 'left', fontFamily: 'Inter' } },
    ],
  },

  // 7. Comparison
  {
    id: 'comparison',
    name: 'Comparison',
    preview: [
      { x: 8,  y:  4, w: 96,  h:  8, fill: TITLE_PV },
      { x: 8,  y: 15, w: 66,  h:  7, fill: '#818cf8' },
      { x: 86, y: 15, w: 66,  h:  7, fill: '#6ee7b7' },
      { x: 8,  y: 26, w: 60,  h:  4, fill: BODY_PV },
      { x: 8,  y: 34, w: 50,  h:  4, fill: BODY_PV },
      { x: 8,  y: 42, w: 55,  h:  4, fill: BODY_PV },
      { x: 8,  y: 50, w: 46,  h:  4, fill: BODY_PV },
      { x: 86, y: 26, w: 60,  h:  4, fill: BODY_PV },
      { x: 86, y: 34, w: 50,  h:  4, fill: BODY_PV },
      { x: 86, y: 42, w: 55,  h:  4, fill: BODY_PV },
      { x: 86, y: 50, w: 46,  h:  4, fill: BODY_PV },
    ],
    makeElements: (theme, master) => [
      { id: uid(), type: 'text', x: 5, y: 4, w: 90, h: 13,
        content: 'Comparison',
        style: { fontSize: master.titleFontSize, bold: master.titleBold, italic: false, underline: false,
                 color: master.titleColor, align: 'center', fontFamily: 'Inter' } },
      { id: uid(), type: 'shape', shape: 'rect', x: 5, y: 19, w: 43, h: 73,
        fill: theme.accentColor + '33', stroke: theme.accentColor, strokeWidth: 2 },
      { id: uid(), type: 'shape', shape: 'rect', x: 52, y: 19, w: 43, h: 73,
        fill: theme.primaryColor + '22', stroke: theme.primaryColor, strokeWidth: 2 },
      { id: uid(), type: 'text', x: 5, y: 20, w: 43, h: 12,
        content: 'Option A',
        style: { fontSize: Math.round(master.bodyFontSize * 1.1), bold: true, italic: false, underline: false,
                 color: theme.accentColor, align: 'center', fontFamily: 'Inter' } },
      { id: uid(), type: 'text', x: 52, y: 20, w: 43, h: 12,
        content: 'Option B',
        style: { fontSize: Math.round(master.bodyFontSize * 1.1), bold: true, italic: false, underline: false,
                 color: theme.primaryColor, align: 'center', fontFamily: 'Inter' } },
      { id: uid(), type: 'text', x: 7, y: 34, w: 39, h: 55,
        content: '+ Advantage one\n+ Advantage two\n+ Advantage three',
        style: { fontSize: master.bodyFontSize, bold: master.bodyBold, italic: false, underline: false,
                 color: master.bodyColor, align: 'left', fontFamily: 'Inter' } },
      { id: uid(), type: 'text', x: 54, y: 34, w: 39, h: 55,
        content: '+ Advantage one\n+ Advantage two\n+ Advantage three',
        style: { fontSize: master.bodyFontSize, bold: master.bodyBold, italic: false, underline: false,
                 color: master.bodyColor, align: 'left', fontFamily: 'Inter' } },
    ],
  },

  // 8. Content with Caption
  {
    id: 'content-caption',
    name: 'Content & Caption',
    preview: [
      { x: 8,   y:  5, w: 96, h: 9, fill: TITLE_PV },
      { x: 8,   y: 16, w: 144, h: 1, fill: BOX_PV, rx: 0 },
      { x: 8,   y: 20, w: 104, h: 62, fill: BOX_PV },
      { x: 118, y: 20, w:  34, h:  9, fill: '#818cf8' },
      { x: 118, y: 33, w:  34, h:  4, fill: BODY_PV },
      { x: 118, y: 41, w:  28, h:  4, fill: BODY_PV },
      { x: 118, y: 49, w:  32, h:  4, fill: BODY_PV },
    ],
    makeElements: (theme, master) => [
      { id: uid(), type: 'text', x: 5, y: 5, w: 90, h: 13,
        content: 'Slide Title',
        style: { fontSize: master.titleFontSize, bold: master.titleBold, italic: false, underline: false,
                 color: master.titleColor, align: 'left', fontFamily: 'Inter' } },
      { id: uid(), type: 'shape', shape: 'rect', x: 5, y: 20, w: 90, h: 1,
        fill: theme.primaryColor, stroke: 'transparent', strokeWidth: 0 },
      { id: uid(), type: 'text', x: 5, y: 24, w: 65, h: 66,
        content: 'Main content area',
        style: { fontSize: master.bodyFontSize, bold: master.bodyBold, italic: false, underline: false,
                 color: master.bodyColor, align: 'left', fontFamily: 'Inter' } },
      { id: uid(), type: 'text', x: 73, y: 24, w: 22, h: 14,
        content: 'Caption',
        style: { fontSize: Math.round(master.bodyFontSize * 0.9), bold: true, italic: false, underline: false,
                 color: theme.primaryColor, align: 'left', fontFamily: 'Inter' } },
      { id: uid(), type: 'text', x: 73, y: 40, w: 22, h: 50,
        content: 'Add a caption or supporting note here.',
        style: { fontSize: Math.round(master.bodyFontSize * 0.8), bold: false, italic: false, underline: false,
                 color: master.bodyColor, align: 'left', fontFamily: 'Inter' } },
    ],
  },

  // 9. Big Statement
  {
    id: 'big-statement',
    name: 'Big Statement',
    preview: [
      { x: 12, y: 25, w: 136, h: 20, fill: TITLE_PV },
      { x: 52, y: 52, w:  56, h:  7, fill: SUB_PV },
    ],
    makeElements: (_theme, master) => [
      { id: uid(), type: 'text', x: 10, y: 22, w: 80, h: 30,
        content: 'Your Big Statement',
        style: { fontSize: Math.round(master.titleFontSize * 1.2), bold: true, italic: false, underline: false,
                 color: master.titleColor, align: 'center', fontFamily: 'Inter' } },
      { id: uid(), type: 'text', x: 20, y: 58, w: 60, h: 14,
        content: 'Supporting context',
        style: { fontSize: master.bodyFontSize, bold: false, italic: false, underline: false,
                 color: master.bodyColor, align: 'center', fontFamily: 'Inter' } },
    ],
  },

  // 10. Quote
  {
    id: 'quote',
    name: 'Quote',
    preview: [
      { x: 10,  y: 10, w: 18, h: 22, fill: TITLE_PV, rx: 0 },
      { x: 10,  y: 28, w: 140, h: 28, fill: BODY_PV },
      { x: 50,  y: 63, w:  60, h:  6, fill: SUB_PV },
    ],
    makeElements: (_theme, master) => [
      { id: uid(), type: 'text', x: 10, y: 14, w: 16, h: 22,
        content: '“',
        style: { fontSize: 80, bold: true, italic: false, underline: false,
                 color: master.titleColor, align: 'left', fontFamily: 'Inter' } },
      { id: uid(), type: 'text', x: 10, y: 28, w: 80, h: 36,
        content: 'The quote goes here.',
        style: { fontSize: Math.round(master.bodyFontSize * 1.2), bold: false, italic: true, underline: false,
                 color: master.bodyColor, align: 'center', fontFamily: 'Inter' } },
      { id: uid(), type: 'text', x: 20, y: 68, w: 60, h: 12,
        content: '— Attribution',
        style: { fontSize: master.bodyFontSize, bold: false, italic: false, underline: false,
                 color: master.bodyColor, align: 'center', fontFamily: 'Inter' } },
    ],
  },
];

