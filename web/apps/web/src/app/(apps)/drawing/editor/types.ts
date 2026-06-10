export type ShapeType = 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'pen' | 'text';
export type ToolType = 'select' | 'pen' | 'line' | 'rectangle' | 'ellipse' | 'arrow' | 'text' | 'eraser';

export interface Layer {
  id: string;
  name: string;
  hidden?: boolean;
  locked?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export type StrokeStyle = 'solid' | 'dashed' | 'dotted' | 'long-dash';

export interface Shape {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  points: Point[];
  text: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  rotation: number;
  opacity: number;
  layerId?: string;
  strokeDash?: boolean;
  strokeStyle?: StrokeStyle;
  fontFamily?: string;
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  locked?: boolean;
  hidden?: boolean;
}

export interface DrawingContent {
  version: 1;
  shapes: Shape[];
  layers?: Layer[];
}

export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';
