import type { Slide, SlideElement, ImageElement, ShapeElement, TextElement, LineElement, SlidePresentation, SlideBackground, TextStyle } from './slideEditorTypes';
import { makeDefaultPresentation, makeDefaultMaster, uid, DEFAULT_THEME } from './slideEditorConstants';

const PPTX_MAX_BYTES = 100 * 1024 * 1024;
const NS_A    = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_P    = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_R    = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';

const SCHEME_KEYS = ['dk1','lt1','dk2','lt2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'];

const PRST_GEOM_MAP: Record<string, string> = {
  rect: 'rect', roundRect: 'rounded-rect', ellipse: 'circle',
  triangle: 'triangle', rtTriangle: 'right-triangle',
  parallelogram: 'parallelogram', trapezoid: 'trapezoid', diamond: 'diamond',
  pentagon: 'pentagon', hexagon: 'hexagon', octagon: 'octagon',
  cross: 'cross', heart: 'heart',
  star4: 'star4', star5: 'star5', star6: 'star6',
  star7: 'star5', star8: 'star5', star10: 'star5', star12: 'star5', star16: 'star5',
  rightArrow: 'arrow-right', leftArrow: 'arrow-left',
  upArrow: 'arrow-up', downArrow: 'arrow-down',
  leftRightArrow: 'arrow-lr', upDownArrow: 'arrow-ud',
  chevron: 'chevron-r', leftChevron: 'chevron-l',
  homePlate: 'arrow-pentagon', notchedRightArrow: 'arrow-notched',
  quadArrow: 'arrow-quad',
  wedgeRectCallout: 'callout-rect', wedgeRoundRectCallout: 'callout-rounded',
  wedgeEllipseCallout: 'callout-oval', cloudCallout: 'callout-cloud',
};

type ThemeColors = Record<string, string>; // slot → 6-char hex (no #)

// ── Color helpers ─────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.padStart(6, '0');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ];
}

function toHex6(r: number, g: number, b: number): string {
  return [r,g,b].map(x => clamp(x,0,255).toString(16).padStart(2,'0')).join('');
}

function applyColorMods(hex: string, el: Element): string {
  let [h, s, l] = rgbToHsl(...hexToRgb(hex));
  const pct = (tag: string): number | null => {
    const n = el.getElementsByTagNameNS(NS_A, tag)[0];
    return n ? parseInt(n.getAttribute('val') ?? '100000') / 100000 : null;
  };
  const lumMod = pct('lumMod'); if (lumMod !== null) l *= lumMod;
  const lumOff = pct('lumOff'); if (lumOff !== null) l += lumOff;
  const shade  = pct('shade');  if (shade !== null)  l *= shade;
  const tint   = pct('tint');   if (tint !== null)   l = l + (1 - l) * (1 - tint);
  return toHex6(...hslToRgb(h, s, clamp(l, 0, 1)));
}

const PRST_COLORS: Record<string, string> = {
  white: 'ffffff', black: '000000', red: 'ff0000', green: '008000',
  blue: '0000ff', yellow: 'ffff00', cyan: '00ffff', magenta: 'ff00ff',
  orange: 'ffa500', purple: '800080', gray: '808080', grey: '808080',
  darkGray: 'a9a9a9', lightGray: 'd3d3d3', brown: 'a52a2a',
};

function resolveColor(container: Element, themeColors: ThemeColors): string | null {
  const srgb = container.getElementsByTagNameNS(NS_A, 'srgbClr')[0];
  if (srgb) { const v = srgb.getAttribute('val'); if (v) return `#${applyColorMods(v, srgb)}`; }

  const scheme = container.getElementsByTagNameNS(NS_A, 'schemeClr')[0];
  if (scheme) {
    const slot = scheme.getAttribute('val') ?? '';
    const base = themeColors[slot] ?? '000000';
    return `#${applyColorMods(base, scheme)}`;
  }

  const sys = container.getElementsByTagNameNS(NS_A, 'sysClr')[0];
  if (sys) { const last = sys.getAttribute('lastClr'); if (last) return `#${last}`; }

  const prst = container.getElementsByTagNameNS(NS_A, 'prstClr')[0];
  if (prst) {
    const v = prst.getAttribute('val') ?? '';
    return `#${applyColorMods(PRST_COLORS[v] ?? '000000', prst)}`;
  }
  return null;
}

function resolveSolidFill(solidFill: Element | undefined, themeColors: ThemeColors): string | null {
  if (!solidFill) return null;
  return resolveColor(solidFill, themeColors);
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function resolveRelPath(base: string, rel: string): string {
  const parts = base.split('/'); parts.pop();
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function relsPathFor(xmlPath: string): string {
  const parts = xmlPath.split('/');
  const file = parts.pop()!;
  return [...parts, '_rels', `${file}.rels`].join('/');
}

// ── Zip helpers ───────────────────────────────────────────────────────────────

async function loadDoc(zip: any, path: string, parser: DOMParser, cache: Map<string, Document>): Promise<Document | null> {
  if (cache.has(path)) return cache.get(path)!;
  if (!zip.files[path]) return null;
  const xml = await zip.files[path].async('text');
  const doc = parser.parseFromString(xml, 'application/xml');
  cache.set(path, doc);
  return doc;
}

async function loadRels(zip: any, xmlPath: string, parser: DOMParser, cache: Map<string, Record<string, string>>): Promise<Record<string, string>> {
  const rp = relsPathFor(xmlPath);
  if (cache.has(rp)) return cache.get(rp)!;
  const rels: Record<string, string> = {};
  if (!zip.files[rp]) { cache.set(rp, rels); return rels; }
  const xml = await zip.files[rp].async('text');
  const doc = parser.parseFromString(xml, 'application/xml');
  for (const rel of Array.from(doc.getElementsByTagNameNS(NS_RELS, 'Relationship')) as Element[]) {
    rels[rel.getAttribute('Id') ?? ''] = rel.getAttribute('Target') ?? '';
  }
  cache.set(rp, rels);
  return rels;
}

async function toDataUrl(zip: any, zipPath: string): Promise<string | null> {
  if (!zip.files[zipPath]) return null;
  const b64 = await zip.files[zipPath].async('base64');
  const ext = zipPath.split('.').pop()?.toLowerCase() ?? 'png';
  const mime: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
    svg: 'image/svg+xml', tiff: 'image/tiff', tif: 'image/tiff',
  };
  return `data:${mime[ext] ?? 'image/png'};base64,${b64}`;
}

// ── Theme ─────────────────────────────────────────────────────────────────────

async function parseTheme(zip: any, parser: DOMParser, themeFile?: string): Promise<{ colors: ThemeColors; minorFont: string }> {
  const file = themeFile ?? Object.keys(zip.files).find((n: string) => /^ppt\/theme\/theme\d+\.xml$/.test(n));
  if (!file) return { colors: {}, minorFont: 'Inter' };
  const xml = await zip.files[file].async('text');
  const doc = parser.parseFromString(xml, 'application/xml');

  const colors: ThemeColors = {};
  const clrScheme = doc.getElementsByTagNameNS(NS_A, 'clrScheme')[0];
  if (clrScheme) {
    for (const key of SCHEME_KEYS) {
      const el = clrScheme.getElementsByTagNameNS(NS_A, key)[0];
      if (!el) continue;
      const srgb = el.getElementsByTagNameNS(NS_A, 'srgbClr')[0];
      if (srgb) { colors[key] = srgb.getAttribute('val') ?? '000000'; continue; }
      const sys = el.getElementsByTagNameNS(NS_A, 'sysClr')[0];
      if (sys) colors[key] = sys.getAttribute('lastClr') ?? '000000';
    }
  }

  let minorFont = 'Inter';
  const fs = doc.getElementsByTagNameNS(NS_A, 'fontScheme')[0];
  if (fs) {
    const mn = fs.getElementsByTagNameNS(NS_A, 'minorFont')[0];
    const tf = mn?.getElementsByTagNameNS(NS_A, 'latin')[0]?.getAttribute('typeface');
    if (tf && !tf.startsWith('+')) minorFont = tf;
  }
  return { colors, minorFont };
}

// ── Slide dimensions ──────────────────────────────────────────────────────────

async function parseSlideDims(zip: any, parser: DOMParser): Promise<{ w: number; h: number }> {
  if (!zip.files['ppt/presentation.xml']) return { w: 9144000, h: 5143500 };
  const xml = await zip.files['ppt/presentation.xml'].async('text');
  const doc = parser.parseFromString(xml, 'application/xml');
  const s = doc.getElementsByTagNameNS(NS_P, 'sldSz')[0];
  return { w: parseInt(s?.getAttribute('cx') ?? '9144000'), h: parseInt(s?.getAttribute('cy') ?? '5143500') };
}

// ── Layout / master loading ───────────────────────────────────────────────────

// Find the layout path for a slide from its rels
function layoutPathFromRels(slideRels: Record<string, string>, slidePath: string): string | null {
  const t = Object.values(slideRels).find(v => v.includes('slideLayouts/'));
  return t ? resolveRelPath(slidePath, t) : null;
}

// Find the master path for a layout from its rels
function masterPathFromRels(layoutRels: Record<string, string>, layoutPath: string): string | null {
  const t = Object.values(layoutRels).find(v => v.includes('slideMasters/'));
  return t ? resolveRelPath(layoutPath, t) : null;
}

// ── Placeholder lookup ────────────────────────────────────────────────────────

// Find a matching placeholder sp in a layout/master doc by phType and phIdx
function findMatchingPh(doc: Document | null, phType: string | null, phIdx: string | null): Element | null {
  if (!doc) return null;
  for (const sp of Array.from(doc.getElementsByTagNameNS(NS_P, 'sp')) as Element[]) {
    const ph = sp.getElementsByTagNameNS(NS_P, 'ph')[0];
    if (!ph) continue;
    if (phType && ph.getAttribute('type') === phType) return sp;
    if (!phType && phIdx && ph.getAttribute('idx') === phIdx) return sp;
  }
  // For body (type=body or idx=1), also try matching idx-only
  if (phIdx) {
    for (const sp of Array.from(doc.getElementsByTagNameNS(NS_P, 'sp')) as Element[]) {
      const ph = sp.getElementsByTagNameNS(NS_P, 'ph')[0];
      if (ph?.getAttribute('idx') === phIdx) return sp;
    }
  }
  return null;
}

// Get defRPr from a txBody's lstStyle at a given level (1-based)
function getLstDefRPr(txBody: Element | null | undefined, level: number): Element | null {
  if (!txBody) return null;
  const lst = txBody.getElementsByTagNameNS(NS_A, 'lstStyle')[0];
  if (!lst) return null;
  const lvlPPr = lst.getElementsByTagNameNS(NS_A, `lvl${level}pPr`)[0];
  return lvlPPr?.getElementsByTagNameNS(NS_A, 'defRPr')[0] ?? null;
}

// ── Gradient ──────────────────────────────────────────────────────────────────

function parseGradFill(grad: Element, themeColors: ThemeColors): string {
  const stops = Array.from(grad.getElementsByTagNameNS(NS_A, 'gs')) as Element[];
  if (!stops.length) return 'linear-gradient(90deg, #cccccc, #ffffff)';
  const colorStops = stops.map(gs => {
    const pos = parseInt(gs.getAttribute('pos') ?? '0') / 1000;
    return `${resolveColor(gs, themeColors) ?? '#000000'} ${pos}%`;
  }).join(', ');
  const lin = grad.getElementsByTagNameNS(NS_A, 'lin')[0];
  const deg = lin ? (parseInt(lin.getAttribute('ang') ?? '0') / 60000 + 90) % 360 : 90;
  return `linear-gradient(${Math.round(deg)}deg, ${colorStops})`;
}

// ── Background ────────────────────────────────────────────────────────────────

// Try to extract a SlideBackground from a p:bg element in the given doc and its rels
async function parseBgPr(
  bgNode: Element | undefined,
  rels: Record<string, string>,
  xmlPath: string,
  zip: any,
  themeColors: ThemeColors,
): Promise<SlideBackground | null> {
  if (!bgNode) return null;

  const bgPr = bgNode.getElementsByTagNameNS(NS_P, 'bgPr')[0];
  if (bgPr) {
    // Gradient
    const grad = bgPr.getElementsByTagNameNS(NS_A, 'gradFill')[0];
    if (grad) return { type: 'gradient', value: parseGradFill(grad, themeColors) };

    // Image
    const blipFill = bgPr.getElementsByTagNameNS(NS_A, 'blipFill')[0];
    if (blipFill) {
      const blip = blipFill.getElementsByTagNameNS(NS_A, 'blip')[0];
      const rId = blip?.getAttributeNS(NS_R, 'embed') ?? blip?.getAttribute('r:embed');
      if (rId) {
        const target = rels[rId];
        if (target) {
          const imgPath = resolveRelPath(xmlPath, target);
          const src = await toDataUrl(zip, imgPath);
          if (src) return { type: 'image', value: src, objectFit: 'cover' };
        }
      }
    }

    // Solid
    const solid = bgPr.getElementsByTagNameNS(NS_A, 'solidFill')[0];
    const c = resolveSolidFill(solid, themeColors);
    if (c) return { type: 'color', value: c };
  }

  // bgRef: the color is inline
  const bgRef = bgNode.getElementsByTagNameNS(NS_P, 'bgRef')[0];
  if (bgRef) {
    const c = resolveColor(bgRef, themeColors);
    if (c) return { type: 'color', value: c };
  }

  return null;
}

async function resolveBackground(
  slideDoc: Document,
  slideRels: Record<string, string>,
  slidePath: string,
  layoutDoc: Document | null,
  layoutRels: Record<string, string>,
  layoutPath: string,
  masterDoc: Document | null,
  masterRels: Record<string, string>,
  masterPath: string,
  zip: any,
  themeColors: ThemeColors,
): Promise<SlideBackground> {
  // Slide bg
  const slideBg = slideDoc.getElementsByTagNameNS(NS_P, 'bg')[0];
  const fromSlide = await parseBgPr(slideBg, slideRels, slidePath, zip, themeColors);
  if (fromSlide) return fromSlide;

  // Layout bg fallback
  if (layoutDoc) {
    const layoutBg = layoutDoc.getElementsByTagNameNS(NS_P, 'bg')[0];
    const fromLayout = await parseBgPr(layoutBg, layoutRels, layoutPath, zip, themeColors);
    if (fromLayout) return fromLayout;
  }

  // Master bg fallback
  if (masterDoc) {
    const masterBg = masterDoc.getElementsByTagNameNS(NS_P, 'bg')[0];
    const fromMaster = await parseBgPr(masterBg, masterRels, masterPath, zip, themeColors);
    if (fromMaster) return fromMaster;
  }

  return { type: 'color', value: '#ffffff' };
}

// ── Transition ────────────────────────────────────────────────────────────────

function parseTransition(slideDoc: Document): Slide['transition'] {
  const trans = slideDoc.getElementsByTagNameNS(NS_P, 'transition')[0];
  if (!trans) return 'none';
  const child = Array.from(trans.childNodes).find(n => n.nodeType === 1) as Element | undefined;
  if (!child) return 'none';
  const name = child.localName;
  const dir  = child.getAttribute('dir') ?? '';
  if (name === 'fade' || name === 'smoothFade') return 'fade';
  if (name === 'dissolve') return 'dissolve';
  if (name === 'zoom' || name === 'flythrough') return 'zoom';
  if (name === 'flip') return 'flip';
  if (name === 'cube') return 'cube';
  if (name === 'wipe') return 'wipe';
  if (name === 'cover' || name === 'uncover') return 'cover';
  if (name === 'push' || name === 'pull') return dir === 'r' || dir === 'd' ? 'slide-left' : 'slide';
  if (name === 'conveyor') return dir === 'r' ? 'slide-left' : 'slide';
  if (name === 'gallery') return 'gallery';
  if (name === 'checker' || name === 'blinds' || name === 'circle') return 'pixelate';
  return 'none';
}

// ── Position ──────────────────────────────────────────────────────────────────

function parseXfrm(xfrm: Element, sw: number, sh: number): { x: number; y: number; w: number; h: number } | null {
  const off = xfrm.getElementsByTagNameNS(NS_A, 'off')[0];
  const ext = xfrm.getElementsByTagNameNS(NS_A, 'ext')[0];
  if (!off || !ext) return null;
  const x = parseInt(off.getAttribute('x') ?? '0');
  const y = parseInt(off.getAttribute('y') ?? '0');
  const cx = parseInt(ext.getAttribute('cx') ?? '0');
  const cy = parseInt(ext.getAttribute('cy') ?? '0');
  const w = (cx / sw) * 100;
  const h = (cy / sh) * 100;
  if (w <= 0 || h <= 0) return null;
  return { x: clamp((x / sw) * 100, 0, 100), y: clamp((y / sh) * 100, 0, 100), w: clamp(w, 0, 100), h: clamp(h, 0, 100) };
}

// ── Arrow / line helpers ──────────────────────────────────────────────────────

function parseArrowType(end: Element | undefined): LineElement['startArrow'] {
  if (!end) return 'none';
  const type = end.getAttribute('type') ?? 'none';
  if (type === 'none') return 'none';
  if (type === 'triangle' || type === 'stealth') return 'triangle';
  return 'arrow';
}

function parseLineEndpoints(
  xfrm: Element, sw: number, sh: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const off = xfrm.getElementsByTagNameNS(NS_A, 'off')[0];
  const ext = xfrm.getElementsByTagNameNS(NS_A, 'ext')[0];
  const ox  = parseInt(off?.getAttribute('x')  ?? '0');
  const oy  = parseInt(off?.getAttribute('y')  ?? '0');
  const ecx = parseInt(ext?.getAttribute('cx') ?? '0');
  const ecy = parseInt(ext?.getAttribute('cy') ?? '0');
  const flipH = xfrm.getAttribute('flipH') === '1';
  const flipV = xfrm.getAttribute('flipV') === '1';
  // Default: (ox, oy) → (ox+ecx, oy+ecy); flip swaps the respective endpoints
  return {
    x1: clamp(((flipH ? ox + ecx : ox) / sw) * 100, 0, 100),
    y1: clamp(((flipV ? oy + ecy : oy) / sh) * 100, 0, 100),
    x2: clamp(((flipH ? ox : ox + ecx) / sw) * 100, 0, 100),
    y2: clamp(((flipV ? oy : oy + ecy) / sh) * 100, 0, 100),
  };
}

function parseCxnSp(
  cxnSp: Element, themeColors: ThemeColors, sw: number, sh: number,
): LineElement | null {
  const spPr = cxnSp.getElementsByTagNameNS(NS_P, 'spPr')[0];
  const xfrm = spPr?.getElementsByTagNameNS(NS_A, 'xfrm')[0];
  if (!xfrm) return null;

  const pts = parseLineEndpoints(xfrm, sw, sh);
  if (pts.x1 === pts.x2 && pts.y1 === pts.y2) return null;

  const ln        = spPr?.getElementsByTagNameNS(NS_A, 'ln')[0];
  const lnSolid   = ln?.getElementsByTagNameNS(NS_A, 'solidFill')[0];
  const stroke    = resolveSolidFill(lnSolid, themeColors) ?? '#000000';
  const wAttr     = ln?.getAttribute('w');
  const strokeWidth = wAttr ? Math.max(1, Math.round(parseInt(wAttr) / 12700)) : 1;

  return {
    id: uid(), type: 'line', ...pts, stroke, strokeWidth,
    startArrow: parseArrowType(ln?.getElementsByTagNameNS(NS_A, 'headEnd')[0]),
    endArrow:   parseArrowType(ln?.getElementsByTagNameNS(NS_A, 'tailEnd')[0]),
  };
}

// ── Text / shape element ──────────────────────────────────────────────────────

function parseSp(
  sp: Element,
  themeColors: ThemeColors,
  defaultFont: string,
  sw: number,
  sh: number,
  layoutDoc: Document | null,
  masterDoc: Document | null,
): SlideElement | null {
  const spPr = sp.getElementsByTagNameNS(NS_P, 'spPr')[0];
  const xfrm = spPr?.getElementsByTagNameNS(NS_A, 'xfrm')[0];
  if (!xfrm) return null;
  const pos = parseXfrm(xfrm, sw, sh);
  if (!pos) return null;

  const txBody = sp.getElementsByTagNameNS(NS_P, 'txBody')[0];

  // Collect paragraph text
  const paras = txBody ? Array.from(txBody.getElementsByTagNameNS(NS_A, 'p')) as Element[] : [];
  const paraTexts = paras.map(p =>
    (Array.from(p.getElementsByTagNameNS(NS_A, 'r')) as Element[])
      .map(r => r.getElementsByTagNameNS(NS_A, 't')[0]?.textContent ?? '').join('')
  );
  const content = paraTexts.join('\n').trim();

  if (content) {
    // Determine placeholder type/idx for layout lookup
    const ph = sp.getElementsByTagNameNS(NS_P, 'ph')[0];
    const phType = ph?.getAttribute('type') ?? null;
    const phIdx  = ph?.getAttribute('idx') ?? null;

    // Find matching placeholder in layout, then master
    const layoutPh = findMatchingPh(layoutDoc, phType, phIdx);
    const masterPh = findMatchingPh(masterDoc, phType, phIdx);

    // Paragraph level for lstStyle lookup (0-based in XML → 1-based)
    const firstPara = paras[0];
    const pPr = firstPara?.getElementsByTagNameNS(NS_A, 'pPr')[0];
    const paraLvl = Math.max(1, parseInt(pPr?.getAttribute('lvl') ?? '0') + 1);

    // First run's rPr
    const firstRun = firstPara
      ? (Array.from(firstPara.getElementsByTagNameNS(NS_A, 'r')) as Element[])[0]
      : undefined;
    const rPr    = firstRun?.getElementsByTagNameNS(NS_A, 'rPr')[0];
    const pDefR  = pPr?.getElementsByTagNameNS(NS_A, 'defRPr')[0];
    const sldR   = getLstDefRPr(txBody, paraLvl);
    const layR   = getLstDefRPr(layoutPh?.getElementsByTagNameNS(NS_P, 'txBody')[0], paraLvl);
    const masR   = getLstDefRPr(masterPh?.getElementsByTagNameNS(NS_P, 'txBody')[0], paraLvl);

    // Cascade: run rPr → paragraph defRPr → slide lstStyle defRPr → layout lstStyle defRPr → master lstStyle defRPr
    const srcs = [rPr, pDefR, sldR, layR, masR].filter(Boolean) as Element[];

    const getAttr = (attr: string): string | undefined => {
      for (const s of srcs) { const v = s.getAttribute(attr); if (v !== null) return v; }
    };

    const szStr = getAttr('sz');
    const fontSize = szStr ? Math.round(parseInt(szStr) / 100 * 1.333) : 24;
    const bold        = getAttr('b') === '1';
    const italic      = getAttr('i') === '1';
    const underline   = getAttr('u') === 'sng';
    const strikethrough = getAttr('strike') === 'sngStrike';

    let color = '#1f2937';
    for (const s of srcs) {
      const c = resolveSolidFill(s.getElementsByTagNameNS(NS_A, 'solidFill')[0], themeColors);
      if (c) { color = c; break; }
    }

    let fontFamily = defaultFont;
    for (const s of srcs) {
      const tf = s.getElementsByTagNameNS(NS_A, 'latin')[0]?.getAttribute('typeface');
      if (tf && !tf.startsWith('+')) { fontFamily = tf; break; }
    }

    const algn  = pPr?.getAttribute('algn');
    const align: TextStyle['align'] = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left';

    // Compute line height from spcBef (space before paragraph) and lnSpc (line spacing).
    // spcBef is in hundredths of a point; sz is also in hundredths of a point.
    const fontSizeHundredths = szStr ? parseInt(szStr) : 1800;
    const spcBefs = paras.slice(1).map(p => {
      const pp = p.getElementsByTagNameNS(NS_A, 'pPr')[0];
      const spcPts = pp?.getElementsByTagNameNS(NS_A, 'spcBef')[0]?.getElementsByTagNameNS(NS_A, 'spcPts')[0];
      return spcPts ? parseInt(spcPts.getAttribute('val') ?? '0') : 0;
    });
    const maxSpcBef = spcBefs.length > 0 ? Math.max(...spcBefs) : 0;
    const lnSpcPct = firstPara?.getElementsByTagNameNS(NS_A, 'pPr')[0]
      ?.getElementsByTagNameNS(NS_A, 'lnSpc')[0]
      ?.getElementsByTagNameNS(NS_A, 'spcPct')[0];
    const lnSpcMult = lnSpcPct ? parseInt(lnSpcPct.getAttribute('val') ?? '100000') / 100000 : 1.0;
    const lineHeight = maxSpcBef > 0
      ? Math.round((lnSpcMult + maxSpcBef / fontSizeHundredths) * 100) / 100
      : undefined;

    // Text box background from spPr solidFill
    let backgroundColor: string | undefined;
    const spSolid = spPr?.getElementsByTagNameNS(NS_A, 'solidFill')[0];
    if (spSolid) {
      const c = resolveSolidFill(spSolid, themeColors);
      if (c && c !== '#ffffff') backgroundColor = c;
    }

    const el: TextElement = {
      id: uid(), type: 'text', ...pos, content,
      style: {
        fontSize: clamp(fontSize, 8, 120),
        bold, italic, underline, strikethrough, color, align, fontFamily,
        ...(lineHeight !== undefined ? { lineHeight } : {}),
        ...(backgroundColor ? { backgroundColor } : {}),
      },
    };
    return el;
  }

  // No text → line or shape element
  const prst = spPr?.getElementsByTagNameNS(NS_A, 'prstGeom')[0]?.getAttribute('prst') ?? 'rect';
  const ln   = spPr?.getElementsByTagNameNS(NS_A, 'ln')[0];

  if (prst === 'line') {
    const lnSolid   = ln?.getElementsByTagNameNS(NS_A, 'solidFill')[0];
    const stroke    = resolveSolidFill(lnSolid, themeColors) ?? '#000000';
    const wAttr     = ln?.getAttribute('w');
    const strokeWidth = wAttr ? Math.max(1, Math.round(parseInt(wAttr) / 12700)) : 1;
    return {
      id: uid(), type: 'line',
      ...parseLineEndpoints(xfrm, sw, sh),
      stroke, strokeWidth,
      startArrow: parseArrowType(ln?.getElementsByTagNameNS(NS_A, 'headEnd')[0]),
      endArrow:   parseArrowType(ln?.getElementsByTagNameNS(NS_A, 'tailEnd')[0]),
    } as LineElement;
  }

  const noFill   = spPr?.getElementsByTagNameNS(NS_A, 'noFill')[0];
  const solid    = spPr?.getElementsByTagNameNS(NS_A, 'solidFill')[0];
  const grad     = spPr?.getElementsByTagNameNS(NS_A, 'gradFill')[0];
  if (!solid && !grad && noFill) return null;

  let fill = 'transparent';
  if (solid) fill = resolveSolidFill(solid, themeColors) ?? 'transparent';
  else if (grad) fill = parseGradFill(grad, themeColors);

  const lnSolid   = ln?.getElementsByTagNameNS(NS_A, 'solidFill')[0];
  const stroke    = resolveSolidFill(lnSolid, themeColors) ?? 'transparent';
  const wAttr     = ln?.getAttribute('w');
  const strokeWidth = wAttr ? Math.max(1, Math.round(parseInt(wAttr) / 12700)) : 0;

  const shape = PRST_GEOM_MAP[prst] ?? 'rect';

  if (fill === 'transparent' && stroke === 'transparent') return null;

  const el: ShapeElement = {
    id: uid(), type: 'shape', shape, ...pos, fill, stroke, strokeWidth,
  };
  return el;
}

// ── Image element ─────────────────────────────────────────────────────────────

async function parsePic(
  pic: Element,
  slideRels: Record<string, string>,
  slidePath: string,
  zip: any,
  sw: number,
  sh: number,
): Promise<ImageElement | null> {
  const blipFill = pic.getElementsByTagNameNS(NS_P, 'blipFill')[0];
  const blip     = blipFill?.getElementsByTagNameNS(NS_A, 'blip')[0];
  const rId      = blip?.getAttributeNS(NS_R, 'embed') ?? blip?.getAttribute('r:embed');
  if (!rId) return null;

  const target = slideRels[rId];
  if (!target) return null;

  const src = await toDataUrl(zip, resolveRelPath(slidePath, target));
  if (!src) return null;

  const spPr = pic.getElementsByTagNameNS(NS_P, 'spPr')[0];
  const xfrm = spPr?.getElementsByTagNameNS(NS_A, 'xfrm')[0];
  if (!xfrm) return null;
  const pos = parseXfrm(xfrm, sw, sh);
  if (!pos) return null;

  return {
    id: uid(), type: 'image', ...pos, src,
    opacity: 1, tintStrength: 0, brightness: 0, contrast: 0,
    saturation: 0, warmth: 0, objectFit: 'cover',
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function importFromPptx(file: File): Promise<SlidePresentation> {
  if (file.size > PPTX_MAX_BYTES) throw new Error('File size exceeds 100 MB limit');

  // @ts-ignore
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);
  const parser = new DOMParser();

  const docCache  = new Map<string, Document>();
  const relsCache = new Map<string, Record<string, string>>();

  const slideFiles = Object.keys(zip.files)
    .filter((n: string) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a: string, b: string) => {
      const n = (s: string) => parseInt(s.match(/(\d+)\.xml$/)![1]);
      return n(a) - n(b);
    });

  if (slideFiles.length === 0) return makeDefaultPresentation();

  // Follow first slide → layout → master → theme to load the correct theme file.
  let masterThemeFile: string | undefined;
  const firstSlideRels = await loadRels(zip, slideFiles[0], parser, relsCache);
  const firstLayoutTarget = Object.values(firstSlideRels).find((v: string) => v.includes('slideLayouts/'));
  if (firstLayoutTarget) {
    const firstLayoutPath = resolveRelPath(slideFiles[0], firstLayoutTarget);
    const firstLayoutRels = await loadRels(zip, firstLayoutPath, parser, relsCache);
    const firstMasterTarget = Object.values(firstLayoutRels).find((v: string) => v.includes('slideMasters/'));
    if (firstMasterTarget) {
      const firstMasterPath = resolveRelPath(firstLayoutPath, firstMasterTarget);
      const firstMasterRels = await loadRels(zip, firstMasterPath, parser, relsCache);
      const themeTarget = Object.values(firstMasterRels).find((v: string) => v.includes('theme/'));
      if (themeTarget) masterThemeFile = resolveRelPath(firstMasterPath, themeTarget);
    }
  }

  const [{ colors: themeColors, minorFont }, slideDims] = await Promise.all([
    parseTheme(zip, parser, masterThemeFile),
    parseSlideDims(zip, parser),
  ]);

  const slides: Slide[] = [];

  for (const slidePath of slideFiles) {
    const slideIndex = slidePath.match(/(\d+)\.xml$/)![1];

    const [slideDoc, slideRels] = await Promise.all([
      loadDoc(zip, slidePath, parser, docCache) as Promise<Document>,
      loadRels(zip, slidePath, parser, relsCache),
    ]);

    // Load layout and master (cached across slides that share the same layout)
    const layoutPath = layoutPathFromRels(slideRels, slidePath);
    const layoutDoc  = layoutPath ? await loadDoc(zip, layoutPath, parser, docCache) : null;
    const layoutRels = layoutPath ? await loadRels(zip, layoutPath, parser, relsCache) : {};

    const masterPath  = layoutPath ? masterPathFromRels(layoutRels, layoutPath) : null;
    const masterDoc   = masterPath ? await loadDoc(zip, masterPath, parser, docCache) : null;
    const masterRels  = masterPath ? await loadRels(zip, masterPath, parser, relsCache) : {};

    // Background: slide → layout → master fallback
    const background = await resolveBackground(
      slideDoc, slideRels, slidePath,
      layoutDoc, layoutRels, layoutPath ?? slidePath,
      masterDoc, masterRels, masterPath ?? slidePath,
      zip, themeColors,
    );

    // Elements
    const spTree = slideDoc.getElementsByTagNameNS(NS_P, 'spTree')[0];
    const elements: SlideElement[] = [];

    if (spTree) {
      for (const child of Array.from(spTree.childNodes) as Node[]) {
        if (!(child instanceof Element)) continue;
        if (child.localName === 'sp') {
          const el = parseSp(child, themeColors, minorFont, slideDims.w, slideDims.h, layoutDoc, masterDoc);
          if (el) elements.push(el);
        } else if (child.localName === 'pic') {
          const el = await parsePic(child, slideRels, slidePath, zip, slideDims.w, slideDims.h);
          if (el) elements.push(el);
        } else if (child.localName === 'cxnSp') {
          const el = parseCxnSp(child, themeColors, slideDims.w, slideDims.h);
          if (el) elements.push(el);
        }
      }
    }

    // Notes
    let notes = '';
    const notesPath = `ppt/notesSlides/notesSlide${slideIndex}.xml`;
    if (zip.files[notesPath]) {
      const notesXml = await zip.files[notesPath].async('text');
      const notesDoc = parser.parseFromString(notesXml, 'application/xml');
      for (const noteSp of (Array.from(notesDoc.getElementsByTagNameNS(NS_P, 'sp')) as Element[]).slice(1)) {
        const txBody = noteSp.getElementsByTagNameNS(NS_P, 'txBody')[0];
        if (!txBody) continue;
        const text = Array.from(txBody.getElementsByTagNameNS(NS_A, 't')).map(t => t.textContent ?? '').join('');
        if (text.trim()) { notes = text.trim(); break; }
      }
    }

    const transition = parseTransition(slideDoc);
    slides.push({ id: uid(), background, elements, notes, transition });
  }

  return {
    slides: slides.length > 0 ? slides : makeDefaultPresentation().slides,
    theme: DEFAULT_THEME,
    master: makeDefaultMaster(),
  };
}
