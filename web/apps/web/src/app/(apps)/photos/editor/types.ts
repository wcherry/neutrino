export type Tool =
  | 'select'
  | 'crop'
  | 'pen'
  | 'highlighter'
  | 'arrow'
  | 'rectangle'
  | 'circle'
  | 'line'
  | 'text'
  | 'blur'
  | 'pixelate'
  | 'blackbox'
  | 'clone';

export type PhotoFilter = 'none' | 'grayscale' | 'sepia' | 'vintage' | 'hdr' | 'bw';

export interface Adjustments {
  brightness: number;    // -100 to 100
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  sharpness: number;
  // Phase 2
  hue: number;           // -180 to 180
  vibrance: number;      // -100 to 100
  colorBalance: number;  // -100 (green tint) to 100 (magenta tint)
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AreaSelection {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CloneShape = 'circle' | 'square';

export interface CloneStampSettings {
  size: number;      // brush diameter in canvas pixels, 10–200
  shape: CloneShape;
  edgeBlur: number;  // feather width in pixels, 0–50
  amount: number;    // blur radius (blur tool) or pixel block size (pixelate tool), 1–40
}

export const DEFAULT_CLONE_SETTINGS: CloneStampSettings = {
  size: 40,
  shape: 'circle',
  edgeBlur: 0,
  amount: 12,
};

export interface TextSettings {
  size: number;   // font size in canvas pixels, 12–72
  color: string;  // CSS hex color
}

export const DEFAULT_TEXT_SETTINGS: TextSettings = {
  size: 20,
  color: '#e53e3e',
};

export interface StrokeSettings {
  color: string;    // CSS hex color
  lineWidth: number; // stroke width in canvas pixels, 1–30
}

export const DEFAULT_STROKE_SETTINGS: StrokeSettings = {
  color: '#e53e3e',
  lineWidth: 2,
};

export interface MarkupStroke {
  id: string;
  tool: Tool;
  color: string;
  lineWidth: number;
  points: { x: number; y: number }[];
  text?: string;
  // Clone tool only
  cloneSource?: { x: number; y: number };
  cloneDragStart?: { x: number; y: number };
  cloneShape?: CloneShape;
  cloneEdgeBlur?: number;
  brushAmount?: number;  // blur radius or pixel block size for blur/pixelate strokes
}

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  temperature: 0,
  sharpness: 0,
  hue: 0,
  vibrance: 0,
  colorBalance: 0,
};

// CSS filter strings applied in addition to adjustment sliders
export const FILTER_PRESET_CSS: Record<PhotoFilter, string> = {
  none: '',
  grayscale: 'grayscale(1)',
  sepia: 'sepia(0.85)',
  bw: 'grayscale(1) contrast(1.4)',
  vintage: 'sepia(0.35) contrast(0.88) brightness(0.92)',
  hdr: 'contrast(1.4) saturate(1.6)',
};

// Displayed in the filter swatch preview (same values)
export const FILTER_PREVIEW_CSS = FILTER_PRESET_CSS;

export const FILTER_LABELS: Record<PhotoFilter, string> = {
  none: 'None',
  grayscale: 'Grayscale',
  sepia: 'Sepia',
  bw: 'B&W',
  vintage: 'Vintage',
  hdr: 'HDR',
};
