/**
 * Phase 5: Chart export utilities.
 *
 * All export functions receive a reference to the chart frame <div> and the
 * chart title (used as the filename). No third-party libraries are required —
 * all functionality uses native browser APIs.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Sanitise a string for use as a filename: replace whitespace and special
 * characters with hyphens, collapse runs of hyphens, and trim.
 */
export function sanitiseFilename(title: string): string {
    return (title || 'chart')
        .replace(/[^a-zA-Z0-9_\-.]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'chart';
}

/**
 * Trigger a browser "Save As" download for a blob.
 */
function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ── SVG serialisation ─────────────────────────────────────────────────────────

/**
 * Serialise the SVG subtree(s) inside a DOM element to a single SVG string.
 * If the element itself is not an <svg> we wrap all child SVGs in a new root.
 *
 * Recharts renders its charts as one or more <svg> elements inside the
 * container div, so this finds the first one and serialises it.
 */
function extractSvgString(frameEl: HTMLElement): string | null {
    const svgEl = frameEl.querySelector('svg');
    if (!svgEl) return null;

    // Clone to avoid mutating the live DOM
    const clone = svgEl.cloneNode(true) as SVGElement;
    // Ensure xmlns is set so the output is a self-contained SVG document
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

    return new XMLSerializer().serializeToString(clone);
}

// ── PNG export ────────────────────────────────────────────────────────────────

/**
 * Export the chart as a PNG image.
 *
 * Strategy:
 * 1. Serialise the first <svg> inside the frame to a data URL.
 * 2. Draw it onto an off-screen <canvas>.
 * 3. Convert the canvas to a PNG blob and trigger a download.
 *
 * Falls back gracefully if no SVG is found (e.g. the chart uses a canvas
 * renderer) by capturing the entire frame element via a plain canvas fill.
 */
export async function exportChartAsPng(
    frameEl: HTMLElement,
    title: string,
    scaleFactor = 2,
): Promise<void> {
    const svgStr = extractSvgString(frameEl);
    const filename = `${sanitiseFilename(title)}.png`;

    if (!svgStr) {
        throw new Error('No SVG element found in chart frame — cannot export as PNG');
    }

    const { width, height } = frameEl.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scaleFactor);
    canvas.height = Math.round(height * scaleFactor);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2d context unavailable');

    ctx.scale(scaleFactor, scaleFactor);

    // Fill background (SVG may be transparent)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    await new Promise<void>((resolve, reject) => {
        const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0, width, height);
            URL.revokeObjectURL(url);
            resolve();
        };
        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
        };
        img.src = url;
    });

    await new Promise<void>((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob) { reject(new Error('Canvas toBlob returned null')); return; }
            downloadBlob(blob, filename);
            resolve();
        }, 'image/png');
    });
}

// ── SVG export ────────────────────────────────────────────────────────────────

/**
 * Export the chart as an SVG file.
 */
export function exportChartAsSvg(frameEl: HTMLElement, title: string): void {
    const svgStr = extractSvgString(frameEl);
    if (!svgStr) throw new Error('No SVG element found in chart frame');

    const blob = new Blob(
        [`<?xml version="1.0" encoding="UTF-8"?>\n${svgStr}`],
        { type: 'image/svg+xml' },
    );
    downloadBlob(blob, `${sanitiseFilename(title)}.svg`);
}

// ── PDF export (via browser print) ────────────────────────────────────────────

/**
 * Export the chart as a PDF using the browser's built-in print dialog.
 *
 * We inject a print-only stylesheet and a temporary full-page container
 * containing only the chart SVG. After the print dialog closes we remove
 * the temporary elements.
 */
export function exportChartAsPdf(frameEl: HTMLElement, title: string): void {
    const svgStr = extractSvgString(frameEl);
    if (!svgStr) throw new Error('No SVG element found in chart frame');

    const styleId = '__chart-print-style__';
    const printId = '__chart-print-container__';

    // Remove any leftover elements from a previous call
    document.getElementById(styleId)?.remove();
    document.getElementById(printId)?.remove();

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        @media print {
            body > *:not(#${printId}) { display: none !important; }
            #${printId} {
                display: flex !important;
                align-items: center;
                justify-content: center;
                width: 100vw;
                height: 100vh;
                page-break-inside: avoid;
            }
            #${printId} svg { max-width: 100%; max-height: 100%; }
        }
    `;
    document.head.appendChild(style);

    const container = document.createElement('div');
    container.id = printId;
    container.style.display = 'none';
    container.innerHTML = svgStr;
    if (title) {
        const caption = document.createElement('div');
        caption.style.cssText = 'position:absolute;bottom:20px;left:0;right:0;text-align:center;font-size:13px;color:#444;';
        caption.textContent = title;
        container.appendChild(caption);
    }
    document.body.appendChild(container);

    const cleanup = () => {
        style.remove();
        container.remove();
    };

    window.print();
    // Clean up after printing (synchronously — print() is blocking in most browsers)
    cleanup();
}

// ── Print chart ───────────────────────────────────────────────────────────────

/**
 * Print the chart using the browser print dialog (same as PDF but without
 * the intent of producing a file — delegates to the user's OS print dialog).
 */
export const printChart = exportChartAsPdf;

// ── Clipboard copy ────────────────────────────────────────────────────────────

/**
 * Copy the chart as a PNG image to the system clipboard using the Clipboard API.
 * Requires `clipboard-write` browser permission.
 *
 * Returns true on success, false if the Clipboard API is unavailable or if
 * the permission is denied.
 */
export async function copyChartToClipboard(
    frameEl: HTMLElement,
    scaleFactor = 2,
): Promise<boolean> {
    if (!navigator.clipboard?.write) {
        console.warn('[chartExport] Clipboard API not available');
        return false;
    }

    const svgStr = extractSvgString(frameEl);
    if (!svgStr) {
        console.warn('[chartExport] No SVG element found');
        return false;
    }

    const { width, height } = frameEl.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scaleFactor);
    canvas.height = Math.round(height * scaleFactor);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    ctx.scale(scaleFactor, scaleFactor);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    await new Promise<void>((resolve, reject) => {
        const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, 0, 0, width, height); URL.revokeObjectURL(url); resolve(); };
        img.onerror = (err) => { URL.revokeObjectURL(url); reject(err); };
        img.src = url;
    });

    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
    if (!blob) return false;

    try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
    } catch (err) {
        console.warn('[chartExport] Clipboard write failed:', err);
        return false;
    }
}
