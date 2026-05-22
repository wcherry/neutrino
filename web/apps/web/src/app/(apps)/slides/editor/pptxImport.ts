import type { Slide, SlidePresentation, TextStyle } from './slideEditorTypes';
import { makeDefaultPresentation, makeDefaultMaster, uid, DEFAULT_THEME } from './slideEditorConstants';

const PPTX_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
// Standard 16:9 slide dimensions in EMU
const SLIDE_W_EMU = 9144000;
const SLIDE_H_EMU = 5143500;

export async function importFromPptx(file: File): Promise<SlidePresentation> {
  if (file.size > PPTX_MAX_BYTES) {
    throw new Error('File size exceeds 100 MB limit');
  }

  // @ts-ignore – jszip is installed at runtime; types resolve after pnpm install
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);

  // Find and sort slide files
  const slideFiles = Object.keys(zip.files)
    .filter((name: string) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a: string, b: string) => {
      const numA = parseInt(a.match(/(\d+)\.xml$/)![1]);
      const numB = parseInt(b.match(/(\d+)\.xml$/)![1]);
      return numA - numB;
    });

  if (slideFiles.length === 0) {
    return makeDefaultPresentation();
  }

  const parser = new DOMParser();
  const slides: Slide[] = [];

  for (const slidePath of slideFiles) {
    const xml = await zip.files[slidePath].async('text');
    const doc = parser.parseFromString(xml, 'application/xml');

    // Background color
    let bgColor = '#ffffff';
    const bgNode = doc.getElementsByTagNameNS(NS_P, 'bg')[0];
    if (bgNode) {
      const bgSolid = bgNode.getElementsByTagNameNS(NS_A, 'solidFill')[0];
      if (bgSolid) {
        const srgb = bgSolid.getElementsByTagNameNS(NS_A, 'srgbClr')[0];
        if (srgb) bgColor = `#${srgb.getAttribute('val') ?? 'ffffff'}`;
      }
    }

    // Parse shapes from spTree
    const spTree = doc.getElementsByTagNameNS(NS_P, 'spTree')[0];
    const elements = [];

    if (spTree) {
      const spNodes = Array.from(spTree.getElementsByTagNameNS(NS_P, 'sp'));
      for (const sp of spNodes) {
        const spPr = sp.getElementsByTagNameNS(NS_P, 'spPr')[0];
        const xfrm = spPr?.getElementsByTagNameNS(NS_A, 'xfrm')[0];
        if (!xfrm) continue;

        const off = xfrm.getElementsByTagNameNS(NS_A, 'off')[0];
        const ext = xfrm.getElementsByTagNameNS(NS_A, 'ext')[0];
        if (!off || !ext) continue;

        const x = parseInt(off.getAttribute('x') ?? '0');
        const y = parseInt(off.getAttribute('y') ?? '0');
        const cx = parseInt(ext.getAttribute('cx') ?? '0');
        const cy = parseInt(ext.getAttribute('cy') ?? '0');

        const txBody = sp.getElementsByTagNameNS(NS_P, 'txBody')[0];
        if (!txBody) continue;

        const textNodes = txBody.getElementsByTagNameNS(NS_A, 't');
        const content = Array.from(textNodes).map((t) => t.textContent ?? '').join('');
        if (!content.trim()) continue;

        // Text formatting from first run
        const firstRPr = txBody.getElementsByTagNameNS(NS_A, 'rPr')[0];
        const szStr = firstRPr?.getAttribute('sz');
        // sz is hundredths of a pt; convert to px (1pt ≈ 1.333px)
        const fontSize = szStr ? Math.round(parseInt(szStr) / 100 * 1.333) : 24;
        const bold = firstRPr?.getAttribute('b') === '1';
        const italic = firstRPr?.getAttribute('i') === '1';
        const underline = firstRPr?.getAttribute('u') === 'sng';

        let color = '#1f2937';
        const solidFill = firstRPr?.getElementsByTagNameNS(NS_A, 'solidFill')[0];
        const srgbClr = solidFill?.getElementsByTagNameNS(NS_A, 'srgbClr')[0];
        if (srgbClr) color = `#${srgbClr.getAttribute('val') ?? '1f2937'}`;

        const firstPPr = txBody.getElementsByTagNameNS(NS_A, 'pPr')[0];
        const algn = firstPPr?.getAttribute('algn');
        const align: TextStyle['align'] = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : 'left';

        const xPct = (x / SLIDE_W_EMU) * 100;
        const yPct = (y / SLIDE_H_EMU) * 100;
        const wPct = (cx / SLIDE_W_EMU) * 100;
        const hPct = (cy / SLIDE_H_EMU) * 100;

        if (wPct <= 0 || hPct <= 0) continue;

        elements.push({
          id: uid(),
          type: 'text' as const,
          x: Math.max(0, xPct),
          y: Math.max(0, yPct),
          w: Math.min(100, wPct),
          h: Math.min(100, hPct),
          content: content.trim(),
          style: {
            fontSize: Math.max(8, Math.min(120, fontSize)),
            bold,
            italic,
            underline,
            color,
            align,
            fontFamily: 'Inter',
          },
        });
      }
    }

    // Parse notes
    let notes = '';
    const slideNum = slidePath.match(/(\d+)\.xml$/)?.[1];
    if (slideNum) {
      const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
      if (zip.files[notesPath]) {
        const notesXml = await zip.files[notesPath].async('text');
        const notesDoc = parser.parseFromString(notesXml, 'application/xml');
        const noteSpNodes = Array.from(notesDoc.getElementsByTagNameNS(NS_P, 'sp'));
        for (const noteSp of noteSpNodes.slice(1)) {
          const txBody = noteSp.getElementsByTagNameNS(NS_P, 'txBody')[0];
          if (!txBody) continue;
          const tNodes = txBody.getElementsByTagNameNS(NS_A, 't');
          const text = Array.from(tNodes).map((t) => t.textContent ?? '').join('');
          if (text.trim()) { notes = text.trim(); break; }
        }
      }
    }

    slides.push({
      id: uid(),
      background: { type: 'color', value: bgColor },
      elements,
      notes,
      transition: 'fade',
    });
  }

  return {
    slides: slides.length > 0 ? slides : makeDefaultPresentation().slides,
    theme: DEFAULT_THEME,
    master: makeDefaultMaster(),
  };
}
