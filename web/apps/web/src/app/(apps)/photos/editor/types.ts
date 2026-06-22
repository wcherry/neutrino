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
  | 'blackbox';

export interface Adjustments {
  brightness: number;   // -100 to 100
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  sharpness: number;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MarkupStroke {
  id: string;
  tool: Tool;
  color: string;
  lineWidth: number;
  points: { x: number; y: number }[];
  text?: string;
}

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  temperature: 0,
  sharpness: 0,
};
