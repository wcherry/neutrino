import type { DiagramDocument, DiagramPage, DiagramShape, DiagramConnector } from '../../types';

function addDotGridToSVG(clone: SVGSVGElement, x: number, y: number, w: number, h: number): void {
  const ns = 'http://www.w3.org/2000/svg';
  // Use :scope > defs to find only a root-level <defs>, not one nested inside
  // the document transform group (which would place the pattern and rect in the
  // wrong coordinate space).
  let defs = clone.querySelector(':scope > defs') as SVGDefsElement | null;
  if (!defs) {
    defs = document.createElementNS(ns, 'defs') as SVGDefsElement;
    clone.insertBefore(defs, clone.firstChild);
  }
  const pattern = document.createElementNS(ns, 'pattern');
  pattern.setAttribute('id', 'export-dot-grid');
  pattern.setAttribute('x', '0');
  pattern.setAttribute('y', '0');
  pattern.setAttribute('width', '20');
  pattern.setAttribute('height', '20');
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', '0');
  dot.setAttribute('cy', '0');
  dot.setAttribute('r', '1');
  dot.setAttribute('fill', '#d0d0d0');
  pattern.appendChild(dot);
  defs.appendChild(pattern);
  const rect = document.createElementNS(ns, 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(w));
  rect.setAttribute('height', String(h));
  rect.setAttribute('fill', 'url(#export-dot-grid)');
  // Insert at SVG root level, after <defs>, before the content layers.
  clone.insertBefore(rect, defs.nextSibling);
}

export function exportSVG(container: HTMLElement, bgColor?: string, showGrid = false): string {
  const svgEl = container.querySelector('svg');
  if (!svgEl) return '';
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.querySelector('[data-grid-overlay]')?.remove();
  if (showGrid) addDotGridToSVG(clone, 0, 0, svgEl.clientWidth || 800, svgEl.clientHeight || 600);
  if (bgColor) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '100%');
    rect.setAttribute('height', '100%');
    rect.setAttribute('fill', bgColor);
    clone.insertBefore(rect, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
}

export async function exportPNG(container: HTMLElement, scale = 1, showGrid = false, bgColor = ''): Promise<Blob> {
  return rasterize(container, 'image/png', scale, showGrid, bgColor);
}

export async function exportJPEG(container: HTMLElement, scale = 1, showGrid = false, bgColor = ''): Promise<Blob> {
  return rasterize(container, 'image/jpeg', scale, showGrid, bgColor);
}

export async function exportPNGCropped(container: HTMLElement, x: number, y: number, width: number, height: number, scale = 1, showGrid = false, bgColor = ''): Promise<Blob> {
  return rasterizeCropped(container, 'image/png', x, y, width, height, scale, showGrid, bgColor);
}

export async function exportJPEGCropped(container: HTMLElement, x: number, y: number, width: number, height: number, scale = 1, showGrid = false, bgColor = ''): Promise<Blob> {
  return rasterizeCropped(container, 'image/jpeg', x, y, width, height, scale, showGrid, bgColor);
}

export function exportSVGCropped(container: HTMLElement, x: number, y: number, width: number, height: number, bgColor?: string, showGrid = false): string {
  const svgEl = container.querySelector('svg');
  if (!svgEl) return '';
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.querySelector('[data-grid-overlay]')?.remove();
  if (showGrid) addDotGridToSVG(clone, x, y, width, height);
  if (bgColor) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    rect.setAttribute('fill', bgColor);
    clone.insertBefore(rect, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
}

function drawDotGrid(ctx: CanvasRenderingContext2D, cropX: number, cropY: number, canvasW: number, canvasH: number, scale: number) {
  const spacing = 20 * scale;
  const radius = Math.max(0.5, scale);
  ctx.fillStyle = '#d0d0d0';
  const firstX = (Math.ceil(cropX / 20) * 20 - cropX) * scale;
  const firstY = (Math.ceil(cropY / 20) * 20 - cropY) * scale;
  for (let x = firstX; x < canvasW; x += spacing) {
    for (let y = firstY; y < canvasH; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

async function rasterize(container: HTMLElement, mimeType: 'image/png' | 'image/jpeg', scale: number, showGrid: boolean, bgColor: string): Promise<Blob> {
  const svgEl = container.querySelector('svg');
  if (!svgEl) throw new Error('No SVG element found');

  const svgString = new XMLSerializer().serializeToString(svgEl);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const naturalW = svgEl.clientWidth || 800;
      const naturalH = svgEl.clientHeight || 600;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(naturalW * scale);
      canvas.height = Math.round(naturalH * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('No canvas context')); return; }
      if (bgColor) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (showGrid) drawDotGrid(ctx, 0, 0, canvas.width, canvas.height, scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob failed'));
      }, mimeType, 0.95);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG load failed')); };
    img.src = url;
  });
}

async function rasterizeCropped(
  container: HTMLElement,
  mimeType: 'image/png' | 'image/jpeg',
  cropX: number, cropY: number, cropW: number, cropH: number,
  scale: number,
  showGrid: boolean,
  bgColor: string,
): Promise<Blob> {
  const svgEl = container.querySelector('svg');
  if (!svgEl) throw new Error('No SVG element found');

  const svgString = new XMLSerializer().serializeToString(svgEl);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const naturalW = svgEl.clientWidth || 800;
      const naturalH = svgEl.clientHeight || 600;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(cropW * scale);
      canvas.height = Math.round(cropH * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('No canvas context')); return; }
      if (bgColor) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (showGrid) drawDotGrid(ctx, cropX, cropY, canvas.width, canvas.height, scale);
      ctx.drawImage(img, -cropX * scale, -cropY * scale, naturalW * scale, naturalH * scale);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob failed'));
      }, mimeType, 0.95);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG load failed')); };
    img.src = url;
  });
}

export function exportJSON(doc: DiagramDocument): Blob {
  const json = JSON.stringify(doc, null, 2);
  return new Blob([json], { type: 'application/json' });
}

export function exportMermaid(page: DiagramPage): string {
  const lines: string[] = ['flowchart TD'];
  const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, '_');

  for (const shape of page.shapes) {
    const id = safeId(shape.id);
    const label = shape.label.replace(/"/g, "'") || shape.id;
    let node: string;
    switch (shape.type) {
      case 'diamond':
      case 'flowchart-decision':
        node = `  ${id}{${label}}`;
        break;
      case 'ellipse':
      case 'circle':
        node = `  ${id}((${label}))`;
        break;
      case 'flowchart-terminator':
        node = `  ${id}([${label}])`;
        break;
      default:
        node = `  ${id}[${label}]`;
    }
    lines.push(node);
  }

  for (const conn of page.connectors) {
    if (!conn.sourceId || !conn.targetId) continue;
    const src = safeId(conn.sourceId);
    const tgt = safeId(conn.targetId);
    if (conn.label) {
      lines.push(`  ${src} -- ${conn.label} --> ${tgt}`);
    } else {
      lines.push(`  ${src} --> ${tgt}`);
    }
  }

  return lines.join('\n');
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
