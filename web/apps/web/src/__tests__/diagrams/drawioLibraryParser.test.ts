import { describe, it, expect } from 'vitest';
import { parseDrawioXml } from '@/app/(apps)/diagrams/editor/shapes/useShapeLibraries';

describe('parseDrawioXml', () => {
  it('returns empty array for empty string', () => {
    expect(parseDrawioXml('')).toEqual([]);
  });

  it('returns empty array when mxlibrary tag is missing', () => {
    expect(parseDrawioXml('<root><item/></root>')).toEqual([]);
  });

  it('returns empty array for invalid JSON inside mxlibrary', () => {
    expect(parseDrawioXml('<mxlibrary>not json</mxlibrary>')).toEqual([]);
  });

  it('parses data field (flat-color-icons / kubernetes format)', () => {
    const dataUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0i';
    const xml = `<mxlibrary>[{"data":"${dataUrl}","w":48,"h":48,"aspect":"fixed"}]</mxlibrary>`;
    const shapes = parseDrawioXml(xml);

    expect(shapes).toHaveLength(1);
    expect(shapes[0].previewUrl).toBe(dataUrl);
    expect(shapes[0].title).toBe('Shape 1');
    expect(shapes[0].w).toBe(48);
    expect(shapes[0].h).toBe(48);
    expect(shapes[0].xml).toBe('');
  });

  it('parses multiple data-field items and assigns sequential fallback titles', () => {
    const xml = `<mxlibrary>[
      {"data":"data:image/svg+xml;base64,AAA","w":48,"h":48},
      {"data":"data:image/svg+xml;base64,BBB","w":24,"h":24},
      {"data":"data:image/svg+xml;base64,CCC","w":32,"h":32}
    ]</mxlibrary>`;
    const shapes = parseDrawioXml(xml);

    expect(shapes).toHaveLength(3);
    expect(shapes[0].title).toBe('Shape 1');
    expect(shapes[1].title).toBe('Shape 2');
    expect(shapes[2].title).toBe('Shape 3');
    expect(shapes[0].previewUrl).toBe('data:image/svg+xml;base64,AAA');
    expect(shapes[1].previewUrl).toBe('data:image/svg+xml;base64,BBB');
    expect(shapes[2].previewUrl).toBe('data:image/svg+xml;base64,CCC');
  });

  it('parses xml field items (arista format) and uses title', () => {
    const compressed = 'jVJBbsMgEHwNR1sEV2m...';
    const xml = `<mxlibrary>[{"xml":"${compressed}","w":162,"h":16,"title":"DCS-7010T-48"}]</mxlibrary>`;
    const shapes = parseDrawioXml(xml);

    expect(shapes).toHaveLength(1);
    expect(shapes[0].title).toBe('DCS-7010T-48');
    expect(shapes[0].xml).toBe(compressed);
    expect(shapes[0].previewUrl).toBeUndefined();
    expect(shapes[0].w).toBe(162);
    expect(shapes[0].h).toBe(16);
  });

  it('parses style field items and uses label as title fallback', () => {
    const xml = `<mxlibrary>[{"style":"shape=mxgraph.cisco.routers.router;","w":50,"h":50,"label":"Router"}]</mxlibrary>`;
    const shapes = parseDrawioXml(xml);

    expect(shapes).toHaveLength(1);
    expect(shapes[0].title).toBe('Router');
    expect(shapes[0].xml).toBe('shape=mxgraph.cisco.routers.router;');
    expect(shapes[0].previewUrl).toBeUndefined();
  });

  it('handles mxlibrary tag with title attribute (kubernetes format)', () => {
    const dataUrl = 'data:image/svg+xml;base64,XYZ';
    const xml = `<mxlibrary title="Kubernetes">[{"data":"${dataUrl}","w":48,"h":48}]</mxlibrary>`;
    const shapes = parseDrawioXml(xml);

    expect(shapes).toHaveLength(1);
    expect(shapes[0].previewUrl).toBe(dataUrl);
  });

  it('prefers title over label when both present', () => {
    const xml = `<mxlibrary>[{"title":"Preferred","label":"Fallback","data":"data:image/png;base64,A","w":32,"h":32}]</mxlibrary>`;
    const shapes = parseDrawioXml(xml);

    expect(shapes[0].title).toBe('Preferred');
  });

  it('assigns unique IDs based on array index', () => {
    const xml = `<mxlibrary>[
      {"data":"data:image/svg+xml;base64,A","w":48,"h":48},
      {"data":"data:image/svg+xml;base64,B","w":48,"h":48}
    ]</mxlibrary>`;
    const shapes = parseDrawioXml(xml);

    expect(shapes[0].id).toBe('tp-shape-0');
    expect(shapes[1].id).toBe('tp-shape-1');
  });

  it('applies default dimensions when w/h are missing', () => {
    const xml = `<mxlibrary>[{"data":"data:image/svg+xml;base64,A"}]</mxlibrary>`;
    const shapes = parseDrawioXml(xml);

    expect(shapes[0].w).toBe(100);
    expect(shapes[0].h).toBe(100);
  });

  it('parses a realistic flat-color-icons excerpt with 312-item count', () => {
    // Build a minimal mxlibrary with 312 items mirroring the real format
    const items = Array.from({ length: 312 }, (_, i) => ({
      data: `data:image/svg+xml;base64,${btoa(`<svg>${i}</svg>`)}`,
      w: 48,
      h: 48,
      aspect: 'fixed',
    }));
    const xml = `<mxlibrary>${JSON.stringify(items)}</mxlibrary>`;
    const shapes = parseDrawioXml(xml);

    expect(shapes).toHaveLength(312);
    expect(shapes.every((s) => s.previewUrl?.startsWith('data:image/svg+xml;base64,'))).toBe(true);
    expect(shapes.every((s) => s.w === 48 && s.h === 48)).toBe(true);
    expect(shapes.every((s, i) => s.title === `Shape ${i + 1}`)).toBe(true);
  });
});
