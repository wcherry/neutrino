export interface TextStyle {
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough?: boolean;
  color: string;
  backgroundColor?: string;
  align: 'left' | 'center' | 'right' | 'justify';
  fontFamily: string;
  lineHeight?: number;
  spaceBefore?: number;  // pt — space above each paragraph (except first)
  spaceAfter?: number;   // pt — space below each paragraph
  listType?: 'none' | 'bullet' | 'numbered';
  shadow?: boolean;
  shadowColor?: string;
}

export interface ElementAnimation {
  type: 'none' | 'fade' | 'fly-in' | 'zoom';
  duration: number; // ms
  delay: number; // ms
  direction?: 'left' | 'right' | 'top' | 'bottom';
}

export interface TextElement {
  id: string;
  type: 'text';
  x: number; // percentage 0-100
  y: number;
  w: number;
  h: number;
  content: string;
  style: TextStyle;
  animation?: ElementAnimation;
}

export interface ShapeElement {
  id: string;
  type: 'shape';
  shape: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeDash?: string;
  animation?: ElementAnimation;
}

export interface LineElement {
  id: string;
  type: 'line';
  x1: number; // percentage 0-100
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  strokeDash?: string;
  startArrow?: 'none' | 'arrow' | 'triangle';
  endArrow?: 'none' | 'arrow' | 'triangle';
  animation?: ElementAnimation;
}

export interface SheetEmbedElement {
  id: string;
  type: 'sheetEmbed';
  x: number; // percentage 0-100
  y: number;
  w: number;
  h: number;
  /** The drive file ID of the parent spreadsheet. */
  spreadsheetId: string;
  /** The FortuneSheet tab index (as a string) within the spreadsheet. */
  sheetId: string;
  namedRangeId: string;
  /** JSON-serialised CellValue[][] — persisted so deleted-sheet fallback works. */
  cachedData: string | null;
  cachedAt: string | null;
  /** Optional display title shown in the embed header. */
  title: string | null;
  animation?: ElementAnimation;
}

export interface VideoElement {
  id: string;
  type: 'video';
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  startSeconds?: number;
  animation?: ElementAnimation;
}

export interface ImageElement {
  id: string;
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
  driveFileId?: string;
  opacity: number;
  tintColor?: string;
  tintStrength: number;
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  objectFit: 'cover' | 'contain' | 'fill';
  animation?: ElementAnimation;
}

export type SlideElement = TextElement | ShapeElement | LineElement | SheetEmbedElement | VideoElement | ImageElement;

export type SlideBackground =
  | { type: 'color'; value: string }
  | { type: 'gradient'; value: string }
  | { type: 'image'; value: string; objectFit?: 'cover' | 'contain' | 'fill' };

export interface Slide {
  id: string;
  background: SlideBackground;
  elements: SlideElement[];
  notes: string;
  transition: 'none' | 'fade' | 'dissolve' | 'slide' | 'slide-left' | 'flip' | 'cube' | 'gallery' | 'pixelate' | 'cover' | 'wipe' | 'zoom';
}

export interface Theme {
  name: string;
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontFamily: string;
  backgroundImage?: string;
  gradient?: string;
  defaultTransition: Slide['transition'];
}

export interface SlideMaster {
  background: string;
  titleFontSize: number;
  titleBold: boolean;
  titleColor: string;
  bodyFontSize: number;
  bodyBold: boolean;
  bodyColor: string;
}

export interface SlidePresentation {
  slides: Slide[];
  theme: Theme;
  master?: SlideMaster;
}

/** A single rectangle drawn in the 160×90 SVG layout preview. */
export interface LayoutPreviewRect {
  x: number; y: number; w: number; h: number;
  fill: string; rx?: number;
}

export interface SlideLayout {
  id: string;
  name: string;
  /** Shapes to render in the 160×90 SVG thumbnail. */
  preview: LayoutPreviewRect[];
  /** Produces slide elements styled with the active theme. */
  makeElements: (theme: Theme, master: SlideMaster) => SlideElement[];
}
