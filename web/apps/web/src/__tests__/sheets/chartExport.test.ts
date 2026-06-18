import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    sanitiseFilename,
    exportChartAsPng,
    exportChartAsSvg,
    exportChartAsPdf,
    copyChartToClipboard,
} from '../../app/(apps)/sheets/editor/charts/chartExport';

// ── SVG fixtures (representative markup for each chart family) ────────────────

const BAR_SVG =
    '<g><rect x="10" y="50" width="30" height="100" fill="#4285f4"/>' +
    '<rect x="50" y="20" width="30" height="130" fill="#34a853"/></g>';

const PIE_SVG =
    '<g><path d="M100,100 L100,10 A90,90 0 0,1 172,145 Z" fill="#4285f4"/>' +
    '<path d="M100,100 L172,145 A90,90 1,1 0 100,10 Z" fill="#ea4335"/></g>';

const LINE_SVG =
    '<g><path d="M10,140 L60,90 L110,120" stroke="#4285f4" fill="none"/>' +
    '<circle cx="10" cy="140" r="4" fill="#4285f4"/></g>';

// A second SVG layer that simulates a Phase-5 annotation overlay.
const ANNOTATION_SVG =
    '<g><rect x="50" y="30" width="80" height="30" fill="rgba(255,255,0,0.4)"/>' +
    '<text x="60" y="50">Peak</text></g>';

// ── Test helpers ──────────────────────────────────────────────────────────────

// jsdom's Blob may not have .text(); FileReader is universally available.
function blobText(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsText(blob);
    });
}

function makeRect(x: number, y: number, w: number, h: number): DOMRect {
    return {
        x, y, left: x, top: y, right: x + w, bottom: y + h, width: w, height: h,
        toJSON: () => ({}),
    } as DOMRect;
}

interface SvgSpec { x?: number; y?: number; w: number; h: number; content?: string }

function makeFrame({
    id = 'chart-1',
    width = 400,
    height = 300,
    svgSpecs = [{ w: 400, h: 300, content: BAR_SVG }] as SvgSpec[],
}: { id?: string; width?: number; height?: number; svgSpecs?: SvgSpec[] } = {}): HTMLElement {
    const frame = document.createElement('div');
    frame.setAttribute('data-chart-id', id);
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, width, height));
    for (const spec of svgSpecs) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', String(spec.w));
        svg.setAttribute('height', String(spec.h));
        svg.setAttribute('viewBox', `0 0 ${spec.w} ${spec.h}`);
        if (spec.content) svg.innerHTML = spec.content;
        vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(
            makeRect(spec.x ?? 0, spec.y ?? 0, spec.w, spec.h),
        );
        frame.appendChild(svg);
    }
    return frame;
}

// ── Shared mock state ─────────────────────────────────────────────────────────

// Filename recorded when a download anchor is clicked.
let lastDownloadFilename = '';
// afterprint handler registered by exportChartAsPdf.
let capturedAfterprint: (() => void) | null = null;

const mockCtx = {
    scale: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: '#ffffff',
};

// ── Test lifecycle ────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    lastDownloadFilename = '';
    capturedAfterprint = null;

    // jsdom doesn't implement these — define fresh vi.fn() instances each run.
    Object.defineProperty(URL, 'createObjectURL', {
        value: vi.fn().mockReturnValue('blob:mock'),
        configurable: true,
        writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
        value: vi.fn(),
        configurable: true,
        writable: true,
    });

    // Capture the download filename when the trigger anchor is clicked.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(
        this: HTMLAnchorElement,
    ) {
        lastDownloadFilename = this.download;
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        mockCtx as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function(
        this: HTMLCanvasElement,
        cb: BlobCallback,
    ) {
        cb(new Blob(['png'], { type: 'image/png' }));
    });

    // Image: fire onload on the next microtask so async awaits resolve properly.
    class MockImage {
        onload: (() => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        set src(_: string) { Promise.resolve().then(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', MockImage);

    // ClipboardItem: jsdom may not provide it; stub a minimal version.
    vi.stubGlobal('ClipboardItem', class MockClipboardItem {
        constructor(public readonly data: Record<string, Blob>) {}
    });

    // Intercept afterprint registration without breaking other event listeners.
    const origAdd = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((
        type: string,
        handler: unknown,
        opts?: unknown,
    ) => {
        if (type === 'afterprint') {
            capturedAfterprint = handler as () => void;
        } else {
            origAdd(
                type as keyof WindowEventMap,
                handler as EventListenerOrEventListenerObject,
                opts as AddEventListenerOptions,
            );
        }
    });
    vi.spyOn(window, 'print').mockImplementation(() => {});

    Object.defineProperty(navigator, 'clipboard', {
        value: { write: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
        writable: true,
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.getElementById('__chart-print-container__')?.remove();
    document.getElementById('__chart-print-style__')?.remove();
});

// ── sanitiseFilename ──────────────────────────────────────────────────────────

describe('sanitiseFilename', () => {
    it('lowercases alphanumeric characters', () => {
        expect(sanitiseFilename('SalesReport')).toBe('salesreport');
    });

    it('replaces spaces and special characters with hyphens', () => {
        expect(sanitiseFilename('Q4 Revenue!')).toBe('q4-revenue');
    });

    it('collapses consecutive hyphens into one', () => {
        expect(sanitiseFilename('A  B  C')).toBe('a-b-c');
    });

    it('trims leading and trailing hyphens', () => {
        expect(sanitiseFilename('  chart  ')).toBe('chart');
    });

    it('falls back to "chart" for empty input', () => {
        expect(sanitiseFilename('')).toBe('chart');
    });

    it('preserves underscores and dots', () => {
        expect(sanitiseFilename('my_chart.v2')).toBe('my_chart.v2');
    });
});

// ── exportChartAsPng ──────────────────────────────────────────────────────────

describe('exportChartAsPng', () => {
    it('triggers a download for a column / bar chart', async () => {
        await exportChartAsPng(
            makeFrame({ svgSpecs: [{ w: 400, h: 300, content: BAR_SVG }] }),
            'Column Chart',
        );
        expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    });

    it('triggers a download for a pie chart', async () => {
        await exportChartAsPng(
            makeFrame({ width: 300, height: 300, svgSpecs: [{ w: 300, h: 300, content: PIE_SVG }] }),
            'Pie Chart',
        );
        expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    });

    it('triggers a download for a line chart', async () => {
        await exportChartAsPng(
            makeFrame({ svgSpecs: [{ w: 400, h: 200, content: LINE_SVG }] }),
            'Line Chart',
        );
        expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    });

    it('download filename uses the sanitised title with .png extension', async () => {
        await exportChartAsPng(makeFrame(), 'My Bar Chart 2024');
        expect(lastDownloadFilename).toBe('my-bar-chart-2024.png');
    });

    it('scales the canvas by 2× for high-DPI output', async () => {
        await exportChartAsPng(makeFrame({ width: 400, height: 300 }), 'Chart');
        expect(mockCtx.scale).toHaveBeenCalledWith(2, 2);
    });

    it('fills a white background before drawing the SVG', async () => {
        await exportChartAsPng(makeFrame(), 'Chart');
        expect(mockCtx.fillRect).toHaveBeenCalled();
    });

    it('draws the SVG image onto the canvas', async () => {
        await exportChartAsPng(makeFrame(), 'Chart');
        expect(mockCtx.drawImage).toHaveBeenCalled();
    });

    it('composites chart SVG + annotation overlay into a single root SVG', async () => {
        const frame = makeFrame({
            svgSpecs: [
                { x: 0, y: 0, w: 400, h: 300, content: LINE_SVG },
                { x: 10, y: 10, w: 200, h: 100, content: ANNOTATION_SVG },
            ],
        });
        await exportChartAsPng(frame, 'Annotated Line');
        // First createObjectURL call receives the SVG blob fed to the Image.
        const svgBlob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
        const text = await blobText(svgBlob);
        // Root <svg> + two nested <svg> elements = at least 3 occurrences.
        expect((text.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(3);
    });

    it('throws when the frame contains no SVG element', async () => {
        const frame = document.createElement('div');
        vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 400, 300));
        await expect(exportChartAsPng(frame, 'Empty')).rejects.toThrow();
    });
});

// ── exportChartAsSvg ──────────────────────────────────────────────────────────

describe('exportChartAsSvg', () => {
    it('triggers a download for a bar chart', () => {
        exportChartAsSvg(makeFrame({ svgSpecs: [{ w: 400, h: 300, content: BAR_SVG }] }), 'Bar');
        expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    });

    it('triggers a download for a pie chart', () => {
        exportChartAsSvg(
            makeFrame({ width: 300, height: 300, svgSpecs: [{ w: 300, h: 300, content: PIE_SVG }] }),
            'Pie',
        );
        expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    });

    it('download filename uses the sanitised title with .svg extension', () => {
        exportChartAsSvg(makeFrame(), 'My Line Chart');
        expect(lastDownloadFilename).toBe('my-line-chart.svg');
    });

    it('blob MIME type is image/svg+xml', () => {
        exportChartAsSvg(makeFrame(), 'Test');
        const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
        expect(blob.type).toBe('image/svg+xml');
    });

    it('blob text begins with the XML declaration', async () => {
        exportChartAsSvg(makeFrame(), 'Test');
        const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
        const text = await blobText(blob);
        expect(text).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    });

    it('blob contains the chart SVG markup', async () => {
        exportChartAsSvg(makeFrame({ svgSpecs: [{ w: 400, h: 300, content: BAR_SVG }] }), 'Bar');
        const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
        const text = await blobText(blob);
        expect(text).toContain('<svg');
        expect(text).toContain('rect');
    });

    it('composites multiple SVGs into a single root SVG element', async () => {
        exportChartAsSvg(
            makeFrame({
                svgSpecs: [
                    { x: 0, y: 0, w: 400, h: 300, content: LINE_SVG },
                    { x: 5, y: 5, w: 150, h: 80, content: ANNOTATION_SVG },
                ],
            }),
            'Annotated',
        );
        const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
        const text = await blobText(blob);
        expect((text.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(3);
    });

    it('throws when the frame contains no SVG element', () => {
        expect(() => exportChartAsSvg(document.createElement('div'), 'Empty')).toThrow();
    });
});

// ── exportChartAsPdf ──────────────────────────────────────────────────────────

describe('exportChartAsPdf', () => {
    it('calls window.print', () => {
        exportChartAsPdf(makeFrame(), 'Chart');
        expect(window.print).toHaveBeenCalledOnce();
    });

    it('injects a print container and style into the document before printing', () => {
        exportChartAsPdf(makeFrame(), 'Chart');
        expect(document.getElementById('__chart-print-container__')).not.toBeNull();
        expect(document.getElementById('__chart-print-style__')).not.toBeNull();
    });

    it('injects SVG via DOMParser (not innerHTML), preserving XML namespaces', () => {
        const parseSpy = vi.spyOn(DOMParser.prototype, 'parseFromString');
        exportChartAsPdf(
            makeFrame({ svgSpecs: [{ w: 400, h: 300, content: BAR_SVG }] }),
            'Chart',
        );
        // Bug #2 fix: must use DOMParser with SVG MIME type, not innerHTML.
        expect(parseSpy).toHaveBeenCalledWith(expect.any(String), 'image/svg+xml');
        // The adopted element must have been appended.
        const container = document.getElementById('__chart-print-container__')!;
        expect(container.childElementCount).toBeGreaterThan(0);
    });

    it('appends a title caption when a title is provided', () => {
        exportChartAsPdf(makeFrame(), 'Revenue Q4');
        const container = document.getElementById('__chart-print-container__')!;
        expect(container.textContent).toContain('Revenue Q4');
    });

    it('does not append a caption when title is empty', () => {
        exportChartAsPdf(makeFrame(), '');
        const container = document.getElementById('__chart-print-container__')!;
        // Only SVG content; no extra text node from a caption.
        const captionDivs = Array.from(container.querySelectorAll('div'));
        expect(captionDivs).toHaveLength(0);
    });

    it('removes the container and style after the afterprint event fires', () => {
        exportChartAsPdf(makeFrame(), 'Chart');
        expect(document.getElementById('__chart-print-container__')).not.toBeNull();
        capturedAfterprint?.();
        expect(document.getElementById('__chart-print-container__')).toBeNull();
        expect(document.getElementById('__chart-print-style__')).toBeNull();
    });

    it('does NOT remove the container before afterprint fires', () => {
        exportChartAsPdf(makeFrame(), 'Chart');
        // afterprint has not been triggered yet
        expect(document.getElementById('__chart-print-container__')).not.toBeNull();
    });

    it('cleans up a stale container from an abandoned prior print', () => {
        exportChartAsPdf(makeFrame({ id: 'c1' }), 'First');
        // Deliberately skip afterprint to simulate dialog abandonment.
        exportChartAsPdf(makeFrame({ id: 'c2' }), 'Second');
        expect(document.querySelectorAll('#__chart-print-container__').length).toBe(1);
    });

    it('works for a pie chart', () => {
        exportChartAsPdf(
            makeFrame({ svgSpecs: [{ w: 300, h: 300, content: PIE_SVG }] }),
            'Pie',
        );
        expect(window.print).toHaveBeenCalledOnce();
        expect(document.getElementById('__chart-print-container__')!.childElementCount).toBeGreaterThan(0);
    });

    it('throws when the frame contains no SVG element', () => {
        expect(() => exportChartAsPdf(document.createElement('div'), 'Empty')).toThrow();
    });
});

// ── copyChartToClipboard ──────────────────────────────────────────────────────

describe('copyChartToClipboard', () => {
    it('returns true and writes to the clipboard for a bar chart', async () => {
        const ok = await copyChartToClipboard(
            makeFrame({ svgSpecs: [{ w: 400, h: 300, content: BAR_SVG }] }),
        );
        expect(ok).toBe(true);
        expect(navigator.clipboard.write).toHaveBeenCalledOnce();
    });

    it('returns true for a line chart', async () => {
        expect(
            await copyChartToClipboard(makeFrame({ svgSpecs: [{ w: 400, h: 200, content: LINE_SVG }] })),
        ).toBe(true);
    });

    it('returns true for a chart with an annotation overlay (multiple SVGs)', async () => {
        const frame = makeFrame({
            svgSpecs: [
                { x: 0, y: 0, w: 400, h: 300, content: LINE_SVG },
                { x: 10, y: 10, w: 200, h: 80, content: ANNOTATION_SVG },
            ],
        });
        expect(await copyChartToClipboard(frame)).toBe(true);
    });

    it('writes a ClipboardItem to the clipboard', async () => {
        await copyChartToClipboard(makeFrame());
        const [item] = (navigator.clipboard.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(item).toBeInstanceOf(ClipboardItem);
    });

    it('returns false when the Clipboard API is unavailable', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            value: undefined, configurable: true, writable: true,
        });
        expect(await copyChartToClipboard(makeFrame())).toBe(false);
    });

    it('returns false when the frame contains no SVG element', async () => {
        const frame = document.createElement('div');
        vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(makeRect(0, 0, 400, 300));
        expect(await copyChartToClipboard(frame)).toBe(false);
    });

    it('returns false without throwing when the canvas is tainted by cross-origin content', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function() {
            throw new DOMException('Tainted canvases may not be exported.', 'SecurityError');
        });
        expect(await copyChartToClipboard(makeFrame())).toBe(false);
    });

    it('returns false when clipboard.write is rejected (permission denied)', async () => {
        (navigator.clipboard.write as ReturnType<typeof vi.fn>).mockRejectedValue(
            new DOMException('Permission denied', 'NotAllowedError'),
        );
        expect(await copyChartToClipboard(makeFrame())).toBe(false);
    });
});
