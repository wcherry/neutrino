'use client';

import './remoteCursors.css';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSpellCheck } from '@/hooks/useSpellCheck';
import { useNspell } from '@/hooks/useNspell';
import { useAiSettings } from '@/hooks/useAiSettings';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { SheetEmbedExtension } from '@/lib/SheetEmbedExtension';
import { DiagramEmbedExtension } from '@/lib/extensions/DiagramEmbedExtension';
import { InsertDiagramDialog as InsertDiagramDocDialog } from './InsertDiagramDialog';
import { FootnoteExtension, getFootnoteItems, FootnoteRegistry } from '@/lib/extensions/FootnoteExtension';
import { CrossRefExtension } from '@/lib/extensions/CrossRefExtension';
import { TableOfContentsExtension } from '@/lib/extensions/TableOfContentsExtension';
import { SectionBreakExtension } from '@/lib/extensions/SectionBreakExtension';
import { ColumnLayoutExtension } from '@/lib/extensions/ColumnLayoutExtension';
// Advanced formatting extensions — only loaded when docsAdvancedFormatting flag is on
import { Superscript, Subscript } from '@/lib/extensions/SubSuperExtension';
import { IndentExtension } from '@/lib/extensions/IndentExtension';
import { ListStyleExtension } from '@/lib/extensions/ListStyleExtension';
import { AdvancedTableCell } from '@/lib/extensions/AdvancedTableCellExtension';
import { AdvancedImage } from '@/lib/extensions/AdvancedImageExtension';
import { useSheetPasteInterceptor, PasteChoiceDialog, type SheetEmbedAttrsShape, type CellValue } from '@neutrino/sheet-embed';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import TextAlign from '@tiptap/extension-text-align';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import Highlight from '@tiptap/extension-highlight';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ChevronLeft, ChevronRight, FileText, Minimize2,
} from 'lucide-react';
import { ShareButton, Spinner, useToast, ZoomSlider } from '@neutrino/ui';
import { ENCRYPTION_WARNING_MESSAGE } from '@/components/EncryptionWarningMessage';
import { docsApi, driveReadContent, driveCreateVersion, driveCreateEncryptedVersion, storageApi, type PageSetup, type FileItem } from '@/lib/api';
import { ShareDialog } from '@/app/(apps)/drive/ShareDialog';
import { decryptFile } from '@neutrino/e2e-crypto';
import { useUser } from '@neutrino/auth';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import { Toolbar } from './Toolbar';
import { HamburgerMenu } from './MenuBar';
import { DocOutline } from './DocOutline';
import { HeaderFooterModal } from './HeaderFooterModal';
import { WatermarkModal } from './WatermarkModal';
import { ThemeModal, type DocTheme } from './ThemeModal';
// Advanced formatting modals
import { ParagraphStylesModal } from './ParagraphStylesModal';
import { ImagePropertiesModal } from './ImagePropertiesModal';
import { TableCellModal } from './TableCellModal';
// Heavy side panels — loaded on demand so they stay out of the initial editor bundle
import dynamic from 'next/dynamic';
const VersionHistoryPanel = dynamic(
  () => import('@/components/VersionHistoryPanel').then((m) => ({ default: m.VersionHistoryPanel })),
  { ssr: false }
);
const CommentsPanel = dynamic(
  () => import('@/components/CommentsPanel').then((m) => ({ default: m.CommentsPanel })),
  { ssr: false }
);
import { EditorContextMenu } from './EditorContextMenu';
// Editing tools — find/replace, grammar check, AI writing (feature gap #3)
import { FindReplaceExtension } from '@/lib/extensions/FindReplaceExtension';
import { GrammarCheckExtension, getGrammarIssueAt } from '@/lib/extensions/GrammarCheckExtension';
import { SpellCheckExtension } from '@/lib/extensions/SpellCheckExtension';
import { FindReplaceBar } from './FindReplaceBar';
import { AiPanel, type AiOperation } from './AiPanel';
import { ChangeToneDialog, type ToneValues } from './ChangeToneDialog';
import { SaveAsDialog, type SaveAsOptions } from '@/components/SaveAsDialog';
import { Sparkles } from 'lucide-react';
import styles from './page.module.css';
// Feature gap #4 — Real-time presence / cursor awareness
import { usePresence } from '@/hooks/usePresence';
import { RemoteCursorsExtension } from '@/lib/extensions/RemoteCursorsExtension';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
// Feature gap #5 — Track changes / suggesting mode
import { TrackChangesExtension, isSuggestingMode } from '@/lib/extensions/TrackChangesExtension';
import { TrackChangesBar } from './TrackChangesBar';
// Feature gap #6 — Version compare
import { DocComparePanel } from './DocComparePanel';
import type { FileVersionItem } from '@neutrino/api-drive';
import { HorizontalRuler, VerticalRuler } from './Ruler';
import { useAccessRevocation } from '@/hooks/useAccessRevocation';

// ── Paper sizes ───────────────────────────────────────────────────────────
// Dimensions in inches; rendered at 96 dpi for screen display.

const PAPER_SIZES: Record<PageSetup['pageSize'], { w: number; h: number }> = {
  letter:    { w: 8.5,   h: 11 },
  a4:        { w: 8.27,  h: 11.69 },
  legal:     { w: 8.5,   h: 14 },
  a3:        { w: 11.69, h: 16.54 },
  a5:        { w: 5.83,  h: 8.27 },
  tabloid:   { w: 11,    h: 17 },
  executive: { w: 7.25,  h: 10.5 },
};

const SCREEN_DPI = 96;

function pageDimensions(ps: PageSetup): { widthPx: number; heightPx: number } {
  const size = PAPER_SIZES[ps.pageSize] ?? PAPER_SIZES.letter;
  const wPx = size.w * SCREEN_DPI;
  const hPx = size.h * SCREEN_DPI;
  return ps.orientation === 'landscape'
    ? { widthPx: hPx, heightPx: wPx }
    : { widthPx: wPx, heightPx: hPx };
}

// 0.5 in gap between pages (rendered via backgroundImage on the page div, behind text)
const PAGE_GAP_PX = 48;

// ── Print ──────────────────────────────────────────────────────────────────

function printDoc(title: string, html: string, ps: PageSetup) {
  const pw = window.open('', '_blank');
  if (!pw) return;

  const pageSizeMap: Record<string, string> = {
    letter: 'letter', a4: 'A4', legal: 'legal',
    a3: 'A3', a5: 'A5', tabloid: 'tabloid', executive: '7.25in 10.5in',
  };
  const cssSize = `${pageSizeMap[ps.pageSize] ?? 'letter'} ${ps.orientation}`;
  // Margins stored as pt; keep them in pt for @page
  const m = `${ps.marginTop}pt ${ps.marginRight}pt ${ps.marginBottom}pt ${ps.marginLeft}pt`;

  pw.document.write(`<!DOCTYPE html><html><head>
<meta charset="UTF-8"><title>${title}</title>
<style>
@page { size: ${cssSize}; margin: ${m}; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, sans-serif; font-size: 11pt; color: #000; }
h1 { font-size: 20pt; margin: 0 0 12pt; }
h2 { font-size: 16pt; margin: 0 0 10pt; }
h3 { font-size: 13pt; margin: 0 0 8pt; }
h4, h5, h6 { font-size: 11pt; margin: 0 0 8pt; }
p { margin: 0 0 8pt; line-height: 1.5; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
td, th { border: 1px solid #ccc; padding: 4pt 8pt; }
th { background: #f0f0f0; font-weight: bold; }
img { max-width: 100%; }
code { font-family: monospace; background: #f5f5f5; padding: 1pt 4pt; border-radius: 2pt; }
pre { background: #f5f5f5; padding: 8pt; margin: 8pt 0; font-family: monospace; white-space: pre-wrap; }
blockquote { margin: 8pt 0 8pt 24pt; border-left: 3px solid #ccc; padding-left: 12pt; color: #555; }
ul, ol { margin: 0 0 8pt; padding-left: 24pt; }
a { color: #1a73e8; }
strong { font-weight: bold; }
em { font-style: italic; }
u { text-decoration: underline; }
s { text-decoration: line-through; }
mark { background: #fff176; }
hr { border: none; border-top: 1px solid #ccc; margin: 12pt 0; }
</style></head><body>${html}</body></html>`);
  pw.document.close();
  pw.focus();
  setTimeout(() => { pw.print(); pw.close(); }, 300);
}

// ── DOCX / PDF export helpers ──────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  console.log('[downloadBlob] starting download', { filename, blobSize: blob.size, blobType: blob.type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay revoke so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 100);
  console.log('[downloadBlob] click dispatched');
}

// Strip block-level inline margin/padding/line-height so pdfmake's own
// default styles control spacing (inline values from the editor or pasted
// content can otherwise produce enormous inter-paragraph gaps).
function cleanBlockMargins(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, pre').forEach(el => {
    const e = el as HTMLElement;
    ['margin-top', 'margin-bottom', 'padding-top', 'padding-bottom', 'line-height']
      .forEach(p => e.style.removeProperty(p));
  });
  return div.innerHTML;
}

// html-to-pdfmake emits { font: 'Inherit' } for elements with font-family: inherit;
// strip those so pdfmake falls back to the defaultStyle font.
function stripInheritFont(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripInheritFont);
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj.font === 'Inherit') delete obj.font;
    for (const key of Object.keys(obj)) obj[key] = stripInheritFont(obj[key]);
  }
  return node;
}

async function buildPdfBlob(
  html: string,
  ps: PageSetup,
  opts?: Pick<SaveAsOptions, 'password' | 'allowPrinting' | 'allowCopying' | 'allowModifying'>,
): Promise<Blob> {
  console.log('[buildPdfBlob] start — html length:', html.length, 'pageSetup:', ps);
  const pdfMake = (await import('pdfmake/build/pdfmake')).default;
  const pdfFonts = (await import('pdfmake/build/vfs_fonts')).default;
  const { default: htmlToPdfmake } = await import('html-to-pdfmake');
  console.log('[buildPdfBlob] imports loaded');

  // pdfmake type stubs predate the vfs/fonts API shape — cast to reach runtime props.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pm = pdfMake as any;
  pm.vfs = pdfFonts;
  pm.fonts = {
    Roboto: {
      normal: 'Roboto-Regular.ttf',
      bold: 'Roboto-Medium.ttf',
      italics: 'Roboto-Italic.ttf',
      bolditalics: 'Roboto-MediumItalic.ttf',
    },
  };

  const pageSizeMap: Record<string, string | [number, number]> = {
    letter: 'LETTER', a4: 'A4', legal: 'LEGAL',
    a3: 'A3', a5: 'A5', tabloid: 'TABLOID', executive: [522, 756],
  };

  const rawContent = htmlToPdfmake(cleanBlockMargins(html), { window });
  const content = stripInheritFont(rawContent) as Parameters<typeof pdfMake.createPdf>[0]['content'];

  type DocDef = Parameters<typeof pdfMake.createPdf>[0];
  const docDef: DocDef = {
    content,
    defaultStyle: { font: 'Roboto' },
    pageSize: pageSizeMap[ps.pageSize] ?? 'LETTER',
    pageOrientation: ps.orientation as 'portrait' | 'landscape',
    pageMargins: [ps.marginLeft, ps.marginTop, ps.marginRight, ps.marginBottom],
  };

  if (opts?.password) {
    (docDef as Record<string, unknown>).userPassword = opts.password;
    (docDef as Record<string, unknown>).permissions = {
      printing: opts.allowPrinting ? 'highResolution' : false,
      copying: opts.allowCopying,
      modifying: opts.allowModifying,
      annotating: true,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: false,
    };
  }

  // pdfmake 0.3.x changed getBlob() from callback-based (0.2.x) to Promise-based.
  // The type stubs still declare the old callback signature, so cast through any.
  console.log('[buildPdfBlob] calling pdfMake.createPdf');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob: Blob = await (pdfMake as any).createPdf(docDef).getBlob();
  console.log('[buildPdfBlob] getBlob resolved', { size: blob?.size });
  if (!blob) throw new Error('pdfmake returned no data.');
  return blob;
}

async function buildDocxBlob(html: string): Promise<Blob> {
  const {
    Document, Packer, Paragraph, TextRun, ExternalHyperlink,
    HeadingLevel, AlignmentType, LevelFormat,
  } = await import('docx');

  type DocxChild = InstanceType<typeof Paragraph>;
  type RunChild = InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>;

  // Parse inline nodes into TextRun / ExternalHyperlink children
  function parseInlineNodes(el: Element, inherited: {
    bold?: boolean; italics?: boolean; underline?: boolean; strike?: boolean;
    color?: string; size?: number;
  } = {}): RunChild[] {
    const runs: RunChild[] = [];
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? '';
        if (text) {
          runs.push(new TextRun({
            text,
            bold: inherited.bold,
            italics: inherited.italics,
            underline: inherited.underline ? {} : undefined,
            strike: inherited.strike,
            color: inherited.color,
            size: inherited.size,
          }));
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const child = node as Element;
        const tag = child.tagName.toLowerCase();
        const style = (child as HTMLElement).style;

        const next = { ...inherited };
        if (tag === 'strong' || tag === 'b') next.bold = true;
        if (tag === 'em' || tag === 'i') next.italics = true;
        if (tag === 'u') next.underline = true;
        if (tag === 's' || tag === 'del' || tag === 'strike') next.strike = true;
        if (tag === 'br') { runs.push(new TextRun({ text: '', break: 1 })); continue; }
        if (style?.fontWeight === 'bold' || style?.fontWeight === '700') next.bold = true;
        if (style?.fontStyle === 'italic') next.italics = true;
        if (style?.textDecoration?.includes('underline')) next.underline = true;
        if (style?.color) next.color = style.color.replace('#', '');
        if (style?.fontSize) {
          const pt = parseFloat(style.fontSize);
          if (!isNaN(pt)) next.size = Math.round(pt * 2); // half-points
        }

        if (tag === 'a') {
          const href = child.getAttribute('href') ?? '';
          const innerRuns = parseInlineNodes(child, { ...next, color: '1155CC', underline: true });
          if (href && innerRuns.length) {
            runs.push(new ExternalHyperlink({ link: href, children: innerRuns as InstanceType<typeof TextRun>[] }));
          } else {
            runs.push(...innerRuns);
          }
        } else {
          runs.push(...parseInlineNodes(child, next));
        }
      }
    }
    return runs;
  }

  // Convert a block element to one or more Paragraph instances
  function parseBlock(el: Element, numbering?: {
    reference: string; level: number;
  }): DocxChild[] {
    const tag = el.tagName.toLowerCase();
    const style = (el as HTMLElement).style;

    const headingMap: Record<string, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
      h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2,
      h3: HeadingLevel.HEADING_3, h4: HeadingLevel.HEADING_4,
      h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6,
    };

    const alignMap: Record<string, typeof AlignmentType[keyof typeof AlignmentType]> = {
      left: AlignmentType.LEFT, center: AlignmentType.CENTER,
      right: AlignmentType.RIGHT, justify: AlignmentType.BOTH,
    };

    // Lists — recurse into li items
    if (tag === 'ul' || tag === 'ol') {
      const refId = tag === 'ol' ? 'ol-numbering' : 'ul-numbering';
      const paras: DocxChild[] = [];
      for (const child of Array.from(el.children)) {
        if (child.tagName.toLowerCase() === 'li') {
          paras.push(...parseBlock(child, { reference: refId, level: 0 }));
        }
      }
      return paras;
    }

    // Blockquote — indent
    if (tag === 'blockquote') {
      const paras: DocxChild[] = [];
      for (const child of Array.from(el.children)) {
        const inner = parseBlock(child);
        inner.forEach(p => paras.push(p));
      }
      if (paras.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const P = Paragraph as any;
        paras.push(new P({ children: parseInlineNodes(el), indent: { left: 720 } }));
      }
      return paras;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inlineChildren = parseInlineNodes(el) as any[];
    const alignment = alignMap[style?.textAlign ?? ''];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const P = Paragraph as any;
    return [new P({
      children: inlineChildren,
      ...(headingMap[tag] ? { heading: headingMap[tag] } : {}),
      ...(alignment ? { alignment } : {}),
      ...(numbering ? { numbering } : {}),
    })];
  }

  const container = document.createElement('div');
  container.innerHTML = html;

  const children: DocxChild[] = [];
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').trim();
      if (text) children.push(new Paragraph({ children: [new TextRun(text)] }));
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      children.push(...parseBlock(node as Element));
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'ul-numbering',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
        },
        {
          reference: 'ol-numbering',
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
        },
      ],
    },
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
}

function buildHtmlBlob(title: string, html: string): Blob {
  const full = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title></head><body>${html}</body></html>`;
  return new Blob([full], { type: 'text/html' });
}

// ── Page setup modal ────────────────────────────────────────────────────────

interface PageSetupModalProps {
  pageSetup: PageSetup;
  onSave: (ps: PageSetup) => void;
  onClose: () => void;
}

function PageSetupModal({ pageSetup, onSave, onClose }: PageSetupModalProps) {
  const [ps, setPs] = useState<PageSetup>(pageSetup);
  // Margin inputs are in inches (3 decimal places); stored as pt in PageSetup.
  const [topIn, setTopIn]       = useState((pageSetup.marginTop    / 72).toFixed(3));
  const [bottomIn, setBottomIn] = useState((pageSetup.marginBottom / 72).toFixed(3));
  const [leftIn, setLeftIn]     = useState((pageSetup.marginLeft   / 72).toFixed(3));
  const [rightIn, setRightIn]   = useState((pageSetup.marginRight  / 72).toFixed(3));

  function inchToPt(s: string): number {
    const n = parseFloat(s);
    return isNaN(n) || n < 0 ? 0 : n * 72;
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalTitle}>Page setup</div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Page size</label>
          <select className={styles.formSelect} value={ps.pageSize}
            onChange={e => setPs(p => ({ ...p, pageSize: e.target.value as PageSetup['pageSize'] }))}>
            <option value="letter">{'Letter (8.5" × 11")'}</option>
            <option value="a4">{'A4 (8.27" × 11.69")'}</option>
            <option value="legal">{'Legal (8.5" × 14")'}</option>
            <option value="a3">{'A3 (11.69" × 16.54")'}</option>
            <option value="a5">{'A5 (5.83" × 8.27")'}</option>
            <option value="tabloid">{'Tabloid (11" × 17")'}</option>
            <option value="executive">{'Executive (7.25" × 10.5")'}</option>
          </select>
        </div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Orientation</label>
          <select className={styles.formSelect} value={ps.orientation}
            onChange={e => setPs(p => ({ ...p, orientation: e.target.value as PageSetup['orientation'] }))}>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Top margin (in)</label>
          <input className={styles.formInput} type="number" step="0.001" min="0"
            value={topIn} onChange={e => setTopIn(e.target.value)} />
        </div>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Bottom margin (in)</label>
          <input className={styles.formInput} type="number" step="0.001" min="0"
            value={bottomIn} onChange={e => setBottomIn(e.target.value)} />
        </div>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Left margin (in)</label>
          <input className={styles.formInput} type="number" step="0.001" min="0"
            value={leftIn} onChange={e => setLeftIn(e.target.value)} />
        </div>
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Right margin (in)</label>
          <input className={styles.formInput} type="number" step="0.001" min="0"
            value={rightIn} onChange={e => setRightIn(e.target.value)} />
        </div>

        <div className={styles.modalActions}>
          <button className={styles.exportBtn} onClick={onClose}>Cancel</button>
          <button className={styles.exportBtn}
            style={{ background: '#1a73e8', color: 'white', border: 'none' }}
            onClick={() => {
              onSave({
                ...ps,
                marginTop:    inchToPt(topIn),
                marginBottom: inchToPt(bottomIn),
                marginLeft:   inchToPt(leftIn),
                marginRight:  inchToPt(rightIn),
              });
              onClose();
            }}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Content serialisation helpers ────────────────────────────────────────────
// When the layout feature flag is on, content is stored as a wrapper object
// { doc: TiptapJSON, _meta: LayoutMeta } so metadata survives save/load.
// When the flag is off (or the document was created without the flag), we fall
// back to plain Tiptap JSON for backward compatibility.

interface LayoutMeta {
  headerText: string;
  footerText: string;
  showPageNumbers: boolean;
  watermarkText: string;
  bgColor: string;
  docTheme: DocTheme;
}

function serializeContent(
  docJson: object,
  meta: LayoutMeta,
  layoutStructure: boolean,
): string {
  if (layoutStructure) {
    return JSON.stringify({ doc: docJson, _meta: meta });
  }
  return JSON.stringify(docJson);
}

// ── Custom paragraph with line-height / paragraph-spacing support ────────────

const LineParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      lineHeight: {
        default: null,
        renderHTML: (attrs: Record<string, unknown>) => attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {},
        parseHTML: (el: HTMLElement) => el.style.lineHeight || null,
      },
      spaceBefore: {
        default: null,
        renderHTML: (attrs: Record<string, unknown>) => attrs.spaceBefore ? { style: `margin-top: ${attrs.spaceBefore}pt` } : {},
        parseHTML: (el: HTMLElement) => el.style.marginTop ? parseFloat(el.style.marginTop) : null,
      },
      spaceAfter: {
        default: null,
        renderHTML: (attrs: Record<string, unknown>) => attrs.spaceAfter ? { style: `margin-bottom: ${attrs.spaceAfter}pt` } : {},
        parseHTML: (el: HTMLElement) => el.style.marginBottom ? parseFloat(el.style.marginBottom) : null,
      },
    };
  },
});

// ── Main editor ──────────────────────────────────────────────────────────────

const AUTO_SAVE_DELAY_MS = 2000;

export function DocEditor() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const flags = useFeatureFlags();
  const currentUser = useUser();
  const docId = searchParams.get('id') ?? '';
  useAccessRevocation(docId);

  // Stable Y.Doc for this editing session — shared between Collaboration extension and usePresence
  const [ydoc] = useState(() => new Y.Doc());
  const queryClient = useQueryClient();
  const { spellCheck } = useSpellCheck();
  const nspell = useNspell();
  const { getProviderOptions } = useAiSettings();

  const { dekRef, dekResolved } =
    useEncryptedDocumentContent({ id: docId, filename: 'doc.json' });
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [pageSetup, setPageSetup] = useState<PageSetup>({
    marginTop: 72, marginBottom: 72, marginLeft: 72, marginRight: 72,
    orientation: 'portrait', pageSize: 'letter',
  });
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [showPageSetup, setShowPageSetup] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsFormat, setSaveAsFormat] = useState('pdf');
  const pendingExportHtmlRef = useRef('');
  const [showOutline, setShowOutline] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentInitialText, setCommentInitialText] = useState('');

  // ── Layout & structure state (gated by flags.docsLayoutStructure) ──
  const [headerText, setHeaderText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [showPageNumbers, setShowPageNumbers] = useState(false);
  const [watermarkText, setWatermarkText] = useState('');
  const [bgColor, setBgColor] = useState('');
  const [docTheme, setDocTheme] = useState<DocTheme>('default');
  const [showHeaderFooterModal, setShowHeaderFooterModal] = useState(false);
  const [showWatermarkModal, setShowWatermarkModal] = useState(false);
  const [showThemeModal, setShowThemeModal] = useState(false);
  // Track editor state version to force footnote list re-render on each transaction
  const [editorVersion, setEditorVersion] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; wordFrom?: number; wordTo?: number; isOnImage?: boolean } | null>(null);
  const [spellWord, setSpellWord] = useState<string | undefined>(undefined);
  const [spellWordRange, setSpellWordRange] = useState<{ from: number; to: number } | null>(null);
  const [spellSuggestions, setSpellSuggestions] = useState<string[] | undefined>(undefined);
  // ── Advanced formatting state (gated by flags.docsAdvancedFormatting) ──
  const [showStylesPalette, setShowStylesPalette] = useState(false);
  const [showImageProps, setShowImageProps] = useState(false);
  const [showTableCellModal, setShowTableCellModal] = useState(false);
  const localImageInputRef = useRef<HTMLInputElement>(null);

  // ── Editing tools state (gated by flags.docsEditingTools) ──
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [grammarEnabled, setGrammarEnabled] = useState(false);
  const [grammarIssue, setGrammarIssue] = useState<{
    message: string; suggestion?: string; category?: string; from: number; to: number;
  } | null>(null);
  // AI writing panel state
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiOperation, setAiOperation] = useState<AiOperation>('suggestions');
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showChangeTone, setShowChangeTone] = useState(false);
  const aiInsertTextRef = useRef('');
  // Whether the current grammar-fix AI result has an auto-applicable replacement.
  // Advisory-only results (passive voice, long sentences) set this to false.
  const grammarAiCanInsertRef = useRef(true);
  // Stores the document range of the grammar issue being fixed by AI so
  // handleAiInsert knows exactly where to replace when the user accepts.
  const grammarAiRangeRef = useRef<{ from: number; to: number } | null>(null);

  // ── Presence state (gated by flags.docsPresence) ──
  const [authToken, setAuthToken] = useState<string | null>(null);
  useEffect(() => {
    const stored = localStorage.getItem('access_token');
    console.log('[presence] authToken from localStorage:', stored ? 'found' : 'missing');
    setAuthToken(stored);
  }, []);

  // ── Track changes state (gated by flags.docsTrackChanges) ──
  const [suggestingMode, setSuggestingMode] = useState(false);

  // ── Compare state (gated by flags.docsCompare) ──
  const [compareVersion, setCompareVersion] = useState<FileVersionItem | null>(null);

  // ── Distraction-free / focus mode ──────────────────────────────────────────
  const [distractionFree, setDistractionFree] = useState(false);

  // ── Diagram embed ──────────────────────────────────────────────────────────
  const [showInsertDiagram, setShowInsertDiagram] = useState(false);

  // ── Rulers, zoom & single page mode ───────────────────────────────────────
  const [showRulers, setShowRulers] = useState(true);
  const [singlePageMode, setSinglePageMode] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageScrollHeight, setPageScrollHeight] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(100);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const sideRulerColRef = useRef<HTMLDivElement>(null);

  const importInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContent = useRef<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const initialSaveDoneRef = useRef(false);
  // Stable ref to latest layout metadata — read inside the useEditor onUpdate
  // closure so we always serialise the most recent values without needing to
  // re-create the editor.
  const layoutMetaRef = useRef<LayoutMeta>({
    headerText: '', footerText: '', showPageNumbers: false,
    watermarkText: '', bgColor: '', docTheme: 'default',
  });
  // Stable refs for title and pageSetup so the onUpdate closure can include
  // current metadata in each autosave without re-creating the editor.
  const titleRef = useRef<string>('');
  const pageSetupRef = useRef<PageSetup>({
    marginTop: 72, marginBottom: 72, marginLeft: 72, marginRight: 72,
    orientation: 'portrait', pageSize: 'letter',
  });

  const { data: doc, isLoading: metaLoading } = useQuery({
    queryKey: ['doc', docId],
    queryFn: () => docsApi.getDoc(docId),
    staleTime: 0,
    enabled: !!docId,
  });

  const { data: docContent, isLoading: contentLoading, isError: contentError } = useQuery({
    // Include contentUrl in the key so the queryFn closure is always consistent
    // with the key and the query re-fires if the URL changes (e.g. after restore).
    queryKey: ['doc-content', docId, dekResolved, doc?.contentUrl ?? ''],
    queryFn: async () => {
      if (!doc?.contentUrl) return null;
      if (dekRef.current) {
        const blob = await storageApi.downloadFile(docId);
        const cipherBytes = new Uint8Array(await blob.arrayBuffer());
        const plainBytes = decryptFile(cipherBytes, dekRef.current);
        return new TextDecoder().decode(plainBytes);
      }
      return driveReadContent(doc.contentUrl);
    },
    enabled: !!doc?.contentUrl && dekResolved,
    staleTime: 0,
    // Omit retry:0 — use the global retry policy so transient failures
    // (e.g. a race on first load or a brief network hiccup) are retried,
    // matching the try/catch fallback in sheets' usePersistence.load().
  });

  const isLoading = metaLoading || contentLoading;

  const contentMutation = useMutation({
    mutationFn: async ({ content, metadata }: { content: string; metadata?: { title?: string; pageSetup?: PageSetup } }) => {
      if (!dekRef.current) throw new Error('no-dek');
      return docsApi.autosaveEncryptedContent(docId, content, 'doc.json', dekRef.current, metadata);
    },
    onMutate: () => setSaveStatus('saving'),
    onSuccess: () => {
      setSaveStatus('saved');
      queryClient.invalidateQueries({ queryKey: ['folder-contents'] });
    },
    onError: (err) => {
      setSaveStatus('unsaved');
      if (err instanceof Error && err.message === 'no-dek') {
        toast.warning(ENCRYPTION_WARNING_MESSAGE);
      }
    },
  });

  const versionMutation = useMutation({
    mutationFn: (content: string) =>
      dekRef.current
        ? driveCreateEncryptedVersion(docId, content, 'doc.json', dekRef.current)
        : driveCreateVersion(docId, content, 'doc.json'),
    onMutate: () => setSaveStatus('saving'),
    onSuccess: () => {
      setSaveStatus('saved');
      queryClient.invalidateQueries({ queryKey: ['versions', docId] });
      queryClient.invalidateQueries({ queryKey: ['folder-contents'] });
    },
    onError: () => setSaveStatus('unsaved'),
  });

  const metaMutation = useMutation({
    mutationFn: (body: Parameters<typeof docsApi.saveDoc>[1]) =>
      docsApi.saveDoc(docId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docs'] });
    },
  });

  const triggerSave = useCallback(
    (content: string, metadata?: { title?: string; pageSetup?: PageSetup }) => {
      if (!isLocalWriterRef.current) return;
      contentMutation.mutate({ content, metadata });
    },
    [contentMutation]
  );

  // Sheet-embed paste interceptor — only active when the feature flag is on.
  // We keep a ref to the latest editor instance so the stable onEmbed callback
  // can always access the current editor without being re-created.
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const { handlePaste: handleSheetPaste, dialogState: sheetPasteDialogState } = useSheetPasteInterceptor({
    onEmbed: useCallback(
      (attrs: SheetEmbedAttrsShape) => {
        const ed = editorRef.current;
        if (!ed) return;
        ed
          .chain()
          .focus()
          .insertContent({
            type: 'sheetEmbed',
            attrs: {
              spreadsheetId: attrs.spreadsheetId,
              sheetId: attrs.sheetId,
              namedRangeId: attrs.namedRangeId,
              cachedData: attrs.cachedData ? JSON.stringify(attrs.cachedData) : null,
              cachedAt: attrs.cachedAt,
              title: attrs.title ?? null,
            },
          })
          .run();
      },
      [],
    ),
    onPasteAsTable: useCallback(
      (_previewData: CellValue[][], html: string) => {
        const ed = editorRef.current;
        if (!ed) return;
        ed.chain().focus().insertContent(html).run();
      },
      [],
    ),
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // Collaboration uses Y.Doc for undo/redo, so StarterKit's History must be off
      StarterKit.configure({ paragraph: false, history: false }),
      Collaboration.configure({ document: ydoc }),
      LineParagraph,
      Underline,
      TextStyle,
      Color,
      FontFamily,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Table.configure({ resizable: true }),
      TableRow,
      // When advanced formatting is on, use the extended TableCell with extra attrs;
      // otherwise fall back to the standard TableCell for backward compatibility.
      flags.docsAdvancedFormatting ? AdvancedTableCell : TableCell,
      TableHeader,
      // When advanced formatting is on, use the extended Image node (adds width,
      // alignment, caption attrs); otherwise use the standard Image extension.
      flags.docsAdvancedFormatting
        ? AdvancedImage.configure({ inline: true, allowBase64: true })
        : Image.configure({ inline: true, allowBase64: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Start typing…' }),
      CharacterCount,
      SheetEmbedExtension,
      DiagramEmbedExtension,
      // Layout & structure extensions — only loaded when feature flag is on
      ...(flags.docsLayoutStructure ? [
        FootnoteExtension,
        CrossRefExtension,
        TableOfContentsExtension,
        SectionBreakExtension,
        ColumnLayoutExtension,
      ] : []),
      // Advanced formatting extensions — only loaded when feature flag is on
      ...(flags.docsAdvancedFormatting ? [
        Superscript,
        Subscript,
        IndentExtension,
        ListStyleExtension,
      ] : []),
      // Client-side spell checking via nspell (replaces browser spellcheck attribute)
      SpellCheckExtension,
      // Editing tools — find/replace and grammar check (feature gap #3)
      ...(flags.docsEditingTools ? [
        FindReplaceExtension,
        GrammarCheckExtension,
      ] : []),
      RemoteCursorsExtension,
      // Track changes / suggesting mode (feature gap #5)
      ...(flags.docsTrackChanges ? [TrackChangesExtension] : []),
    ],
    editorProps: {
      attributes: { class: 'ProseMirror', spellcheck: 'false' },
    },
    onUpdate: ({ editor }) => {
      // Bump editorVersion so layout-dependent components (e.g. footnote list) re-render
      if (flags.docsLayoutStructure) {
        setEditorVersion(v => v + 1);
      }
      // Use the stable ref so we always get fresh metadata values without
      // needing to re-create the editor when metadata changes.
      const content = serializeContent(editor.getJSON(), layoutMetaRef.current, flags.docsLayoutStructure);
      pendingContent.current = content;
      setSaveStatus('unsaved');
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        triggerSave(content, { title: titleRef.current, pageSetup: pageSetupRef.current });
      }, AUTO_SAVE_DELAY_MS);
    },
  });

  // Keep editorRef in sync so the stable onEmbed callback can access the editor.
  (editorRef as React.MutableRefObject<typeof editor>).current = editor;

  // ── Presence / cursor awareness + Yjs doc sync (feature gap #4) ─────────────
  const { remoteUsers, syncReady, isLocalWriter } = usePresence({
    docId,
    userName: currentUser?.name ?? 'Anonymous',
    authToken,
    editor,
    enabled: !!docId,
    ydoc,
  });

  // Stable ref so save callbacks always read the latest writer status without
  // needing to re-create them (avoids stale closure issues with debounce timers).
  const isLocalWriterRef = useRef(true);
  isLocalWriterRef.current = isLocalWriter;

  // When we're not the writer, find which remote user holds the write lock so
  // we can highlight their avatar with a ring.
  const remoteWriterClientId = !isLocalWriter && remoteUsers.length > 0
    ? remoteUsers.reduce((min, u) => {
        const minJoin = min.joinedAt ?? 0;
        const uJoin = u.joinedAt ?? 0;
        if (uJoin === minJoin) return u.clientId < min.clientId ? u : min;
        return uJoin < minJoin ? u : min;
      }).clientId
    : null;

  // Push remote cursor positions into the RemoteCursorsExtension plugin
  useEffect(() => {
    if (!editor) return;
    editor.commands.updateRemoteCursors(remoteUsers);
  }, [editor, remoteUsers]);

  // ── Track changes — keep React state in sync with plugin state ────────────
  useEffect(() => {
    if (!flags.docsTrackChanges || !editor) return;
    const update = () => {
      setSuggestingMode(isSuggestingMode(editor.state));
    };
    editor.on('transaction', update);
    return () => { editor.off('transaction', update); };
  }, [flags.docsTrackChanges, editor]);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const listener = (e: Event) => {
      handleSheetPaste(e as ClipboardEvent).then((consumed) => {
        if (consumed) e.preventDefault();
      });
    };
    dom.addEventListener('paste', listener);
    return () => dom.removeEventListener('paste', listener);
  }, [editor, handleSheetPaste]);

  // Sync spell-check state into the SpellCheckExtension plugin. This runs
  // whenever the user preference or the nspell handle changes (nspell loads lazily).
  useEffect(() => {
    if (!editor) return;
    editor.commands.updateSpellCheck({ enabled: spellCheck, nspell });
  }, [editor, spellCheck, nspell]);

  // Keep layoutMetaRef in sync with state so the stable onUpdate closure has
  // fresh values without re-creating the editor.
  useEffect(() => {
    layoutMetaRef.current = { headerText, footerText, showPageNumbers, watermarkText, bgColor, docTheme };
  }, [headerText, footerText, showPageNumbers, watermarkText, bgColor, docTheme]);

  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { pageSetupRef.current = pageSetup; }, [pageSetup]);

  useEffect(() => {
    if (!doc || !editor) return;
    setTitle(doc.title);
    setPageSetup(doc.pageSetup);
  }, [doc, editor]);

  useEffect(() => {
    if (!docContent || !editor || !syncReady) return;
    // Skip if the user has unsaved edits — a stale refetch (e.g. triggered by
    // window.focus after a prompt dialog) must not clobber in-progress work.
    if (pendingContent.current !== null) return;

    // If the Y.Doc already has content from an active collab session (other
    // users were already editing), don't overwrite with the (older) REST snapshot.
    const fragment = ydoc.getXmlFragment('default');
    if (fragment.length > 0) {
      console.log('[collab] Y.Doc has content from server — skipping REST content load');
      return;
    }

    console.log('[collab] Y.Doc is empty after sync — loading content from REST');
    try {
      const parsed = JSON.parse(docContent);
      // Detect wrapper format { doc, _meta } written when the layout flag was on
      if (flags.docsLayoutStructure && parsed._meta) {
        editor.commands.setContent(parsed.doc, false);
        setHeaderText(parsed._meta.headerText ?? '');
        setFooterText(parsed._meta.footerText ?? '');
        setShowPageNumbers(parsed._meta.showPageNumbers ?? false);
        setWatermarkText(parsed._meta.watermarkText ?? '');
        setBgColor(parsed._meta.bgColor ?? '');
        setDocTheme(parsed._meta.docTheme ?? 'default');
      } else {
        editor.commands.setContent(parsed, false);
      }
    } catch {
      editor.commands.setContent(docContent, false);
    }
  }, [docContent, editor, syncReady, ydoc]);

  // After the DEK is resolved and the content query has settled, do a one-time
  // encrypted autosave when no valid content was loaded (new file or failed
  // decryption of server-stored plaintext).  This overwrites the server's
  // plaintext initial content so the stored bytes are always ciphertext.
  // Guard on contentError: a failed download leaves docContent undefined, which
  // is indistinguishable from "no content yet" — never write an empty file over
  // content we simply failed to fetch.
  useEffect(() => {
    if (!dekRef.current || !editor || !doc || contentLoading || contentError) return;
    if (initialSaveDoneRef.current) return;
    if (docContent !== null && docContent !== undefined) return;
    if (!isLocalWriterRef.current) return;
    initialSaveDoneRef.current = true;
    const content = JSON.stringify(editor.getJSON());
    docsApi.autosaveEncryptedContent(docId, content, 'doc.json', dekRef.current).catch(() => {});
  // dekRef is a stable ref; use dekResolved (state) as the reactive signal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dekResolved, editor, doc, contentLoading, contentError, docContent, docId]);

  useEffect(() => {
    const flush = () => {
      if (pendingContent.current === null) return;
      if (!isLocalWriterRef.current) return;
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
      const content = pendingContent.current;
      pendingContent.current = null;
      if (!dekRef.current) {
        console.warn('[neutrino] Autosave skipped on flush: encryption key unavailable');
        return;
      }
      const metadata = { title: titleRef.current, pageSetup: pageSetupRef.current };
      docsApi.autosaveEncryptedContent(docId, content, 'doc.json', dekRef.current, metadata);
    };
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  // docId is stable for the component lifetime; all others are refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When nspell finishes loading while the context menu is open, compute suggestions.
  useEffect(() => {
    if (!nspell || !spellWord || spellSuggestions !== undefined) return;
    setSpellSuggestions(nspell.check(spellWord) ? [] : nspell.suggest(spellWord).slice(0, 5));
  }, [nspell, spellWord, spellSuggestions]);

  const handleTitleBlur = () => {
    if (!title.trim() || title === doc?.title) return;
    // Save title together with current content in one combined call.
    if (editor) {
      const content = serializeContent(editor.getJSON(), layoutMetaRef.current, flags.docsLayoutStructure);
      triggerSave(content, { title, pageSetup });
    } else {
      metaMutation.mutate({ title });
    }
  };

  const handleBack = useCallback(async () => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    if (pendingContent.current !== null && isLocalWriterRef.current) {
      await contentMutation.mutateAsync({ content: pendingContent.current, metadata: { title: titleRef.current, pageSetup: pageSetupRef.current } });
      pendingContent.current = null;
    }
    queryClient.invalidateQueries({ queryKey: ['docs'] });
    router.push('/drive');
  }, [contentMutation, queryClient, router]);

  const handleManualSave = useCallback(() => {
    if (!editor || !isLocalWriterRef.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    const content = serializeContent(editor.getJSON(), {
      headerText, footerText, showPageNumbers, watermarkText, bgColor, docTheme,
    }, flags.docsLayoutStructure);
    versionMutation.mutate(content);
  }, [editor, versionMutation, headerText, footerText, showPageNumbers, watermarkText, bgColor, docTheme]);

  // Sync grammar-enabled state into the GrammarCheckExtension plugin
  useEffect(() => {
    if (!flags.docsEditingTools || !editor) return;
    editor.commands.setGrammarEnabled(grammarEnabled);
  }, [grammarEnabled, editor]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && distractionFree) {
        setDistractionFree(false);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f' && flags.docsDistractionFree) {
        e.preventDefault();
        setDistractionFree(v => !v);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && flags.docsEditingTools) {
        e.preventDefault();
        setShowFindReplace(true);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleManualSave();
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        // Use stopPropagation to prevent Ctrl+K from reaching the contenteditable
        // element, where macOS Chrome would treat it as "delete to end of line".
        e.preventDefault();
        e.stopPropagation();
        if (!editor) return;
        const { anchor, head } = editor.state.selection;
        const selFrom = Math.min(anchor, head);
        const selTo = Math.max(anchor, head);
        const existing = editor.getAttributes('link').href as string | undefined;
        const url = window.prompt('Enter URL:', existing ?? 'https://');
        if (url === null) return;
        if (url === '') {
          editor.chain().focus().setTextSelection({ from: selFrom, to: selTo }).extendMarkRange('link').unsetLink().run();
        } else {
          editor.chain().focus().setTextSelection({ from: selFrom, to: selTo }).setLink({ href: url }).run();
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        editor?.chain().focus().clearNodes().unsetAllMarks().run();
      }
    };
    // Use capture phase so this handler fires before the event reaches the
    // contenteditable, preventing macOS Chrome from processing Ctrl+K as
    // "delete to end of line" before our stopPropagation can take effect.
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [handleManualSave, editor, distractionFree, setDistractionFree, flags.docsDistractionFree]);

  const handleNewDoc = useCallback(async () => {
    const newDoc = await docsApi.createDoc({ title: 'Untitled document' });
    router.push(`/docs/editor?id=${newDoc.id}`);
  }, [router]);

  const handleDuplicate = useCallback(async () => {
    if (!editor || !doc) return;
    const newDoc = await docsApi.createDoc({ title: `${title} (copy)` });
    const content = JSON.stringify(editor.getJSON());
    await driveCreateVersion(newDoc.id, content, 'doc.json');
    router.push(`/docs/editor?id=${newDoc.id}`);
  }, [editor, doc, title, router]);

  const handlePageSetupSave = (ps: PageSetup) => {
    setPageSetup(ps);
    // Save page setup together with current content in one combined call.
    if (editor) {
      const content = serializeContent(editor.getJSON(), layoutMetaRef.current, flags.docsLayoutStructure);
      triggerSave(content, { title, pageSetup: ps });
    } else {
      metaMutation.mutate({ pageSetup: ps });
    }
  };

  const handleInsertImage = () => {
    const url = window.prompt('Enter image URL:');
    if (url && editor) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  };

  // ── Advanced formatting handlers ───────────────────────────────────────────

  const handleInsertLocalImage = useCallback(() => {
    localImageInputRef.current?.click();
  }, []);

  const handleLocalImageFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !editor) return;
      // Read as data URL for inline base64 storage.
      // TODO: Replace with a backend file upload API for large images to avoid
      //       bloating the document JSON. For now, base64 inline is used since
      //       the editor already supports allowBase64: true on the image extension.
      const reader = new FileReader();
      reader.onload = (ev) => {
        const src = ev.target?.result as string;
        if (src) {
          editor.chain().focus().setImage({ src }).run();
        }
      };
      reader.readAsDataURL(file);
      // Reset the input so the same file can be uploaded again if needed.
      e.target.value = '';
    },
    [editor],
  );

  const handleInsertLink = () => {
    const url = window.prompt('Enter URL:');
    if (url && editor) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  // ── Layout & structure handlers ────────────────────────────────────────────

  const handleInsertFootnote = useCallback(() => {
    if (!editor) return;
    // Generate a unique ID for this footnote
    const id = `fn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // TODO: Replace with inline editor for richer UX
    const text = window.prompt('Enter footnote text:');
    if (text === null) return; // cancelled
    FootnoteRegistry.set(id, text ?? '');
    editor.chain().focus().insertContent({ type: 'footnote', attrs: { id } }).run();
  }, [editor]);

  const handleInsertCrossRef = useCallback(() => {
    if (!editor) return;
    const headingText = window.prompt('Enter the heading text to link to:');
    if (!headingText) return;
    // Find the heading node and apply the cross-ref mark to the current selection
    editor.chain().focus().setMark('crossRef', { headingText }).run();
  }, [editor]);

  // Click handler for cross-reference links — scrolls to the referenced heading
  const handleCrossRefClick = useCallback((e: React.MouseEvent) => {
    if (!editor) return;
    const target = (e.target as HTMLElement).closest('[data-cross-ref]') as HTMLElement | null;
    if (!target) return;
    e.preventDefault();
    const headingText = target.getAttribute('data-cross-ref');
    if (!headingText) return;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading' && node.textContent === headingText) {
        const domNode = editor.view.nodeDOM(pos);
        if (domNode instanceof HTMLElement) {
          domNode.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return false;
      }
    });
  }, [editor]);

  const handleHeaderFooterSave = useCallback((h: string, f: string, spn: boolean) => {
    setHeaderText(h);
    setFooterText(f);
    setShowPageNumbers(spn);
    if (editor) {
      const content = serializeContent(editor.getJSON(), {
        ...layoutMetaRef.current, headerText: h, footerText: f, showPageNumbers: spn,
      }, flags.docsLayoutStructure);
      pendingContent.current = content;
      setSaveStatus('unsaved');
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => triggerSave(content, { title: titleRef.current, pageSetup: pageSetupRef.current }), AUTO_SAVE_DELAY_MS);
    }
  }, [editor, triggerSave]);

  const handleWatermarkSave = useCallback((wt: string, bg: string) => {
    setWatermarkText(wt);
    setBgColor(bg);
    if (editor) {
      const content = serializeContent(editor.getJSON(), {
        ...layoutMetaRef.current, watermarkText: wt, bgColor: bg,
      }, flags.docsLayoutStructure);
      pendingContent.current = content;
      setSaveStatus('unsaved');
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => triggerSave(content, { title: titleRef.current, pageSetup: pageSetupRef.current }), AUTO_SAVE_DELAY_MS);
    }
  }, [editor, triggerSave]);

  const handleThemeSave = useCallback((theme: DocTheme) => {
    setDocTheme(theme);
    if (editor) {
      const content = serializeContent(editor.getJSON(), {
        ...layoutMetaRef.current, docTheme: theme,
      }, flags.docsLayoutStructure);
      pendingContent.current = content;
      setSaveStatus('unsaved');
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => triggerSave(content, { title: titleRef.current, pageSetup: pageSetupRef.current }), AUTO_SAVE_DELAY_MS);
    }
  }, [editor, triggerSave]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();

    // Reset spell state for every new right-click.
    setSpellWord(undefined);
    setSpellWordRange(null);
    setSpellSuggestions(undefined);
    setGrammarIssue(null);

    if (
      spellCheck &&
      editor?.state.selection.empty
    ) {
      const view = editor.view;
      const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });

      if (pos) {
        const docPos = pos.pos;
        const { doc: pmDoc } = editor.state;
        const resolvedPos = pmDoc.resolve(docPos);
        const textNode = resolvedPos.parent;

        if (textNode.isTextblock) {
          // Build the full text of the block and find the word boundary.
          let blockText = '';
          let offsetInBlock = 0;
          let accum = 0;
          // resolvedPos.parentOffset is the offset within the parent text block.
          const cursorOffset = resolvedPos.parentOffset;

          textNode.forEach((node) => {
            if (node.isText && node.text) {
              if (accum <= cursorOffset && cursorOffset <= accum + node.text.length) {
                offsetInBlock = accum;
              }
              blockText += node.text;
              accum += node.text.length;
            }
          });

          // Find word boundaries around the cursor position.
          const posInText = cursorOffset;
          // Walk backwards to find word start.
          let wordStart = posInText;
          while (wordStart > 0 && /\w/.test(blockText[wordStart - 1])) {
            wordStart--;
          }
          // Walk forwards to find word end.
          let wordEnd = posInText;
          while (wordEnd < blockText.length && /\w/.test(blockText[wordEnd])) {
            wordEnd++;
          }

          const word = blockText.slice(wordStart, wordEnd);

          if (word.length > 0) {
            // Calculate ProseMirror document positions for the word.
            // resolvedPos.start() gives the position before the first child of the block.
            const blockStart = resolvedPos.start();
            const pmWordFrom = blockStart + wordStart;
            const pmWordTo = blockStart + wordEnd;

            setSpellWord(word);
            setSpellWordRange({ from: pmWordFrom, to: pmWordTo });

            if (nspell) {
              // Dictionary already loaded — check immediately.
              if (!nspell.check(word)) {
                setSpellSuggestions(nspell.suggest(word));
              } else {
                setSpellSuggestions([]); // correctly spelled, no suggestions
              }
            }
            // If nspell is null (still loading), spellSuggestions stays undefined
            // and the "Checking…" placeholder will be shown.
          }
        }
      }
    }

    // Detect grammar issue at cursor position when grammar check is enabled
    if (flags.docsEditingTools && grammarEnabled && editor) {
      const view = editor.view;
      const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (pos) {
        const issue = getGrammarIssueAt(editor.state.doc, pos.pos);
        if (issue) {
          setGrammarIssue({
            message: issue.message,
            suggestion: issue.suggestion,
            category: issue.category,
            from: issue.from,
            to: issue.to,
          });
        }
      }
    }

    // Detect if the right-click landed on an image node.
    let isOnImage = false;
    if (flags.docsAdvancedFormatting && editor) {
      const coordPos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (coordPos) {
        const nodeAt = editor.state.doc.nodeAt(coordPos.pos);
        if (nodeAt?.type.name === 'image') {
          isOnImage = true;
        } else if (coordPos.pos > 0) {
          const nodeBefore = editor.state.doc.nodeAt(coordPos.pos - 1);
          isOnImage = nodeBefore?.type.name === 'image';
        }
      }
    }

    setContextMenu({ x: e.clientX, y: e.clientY, isOnImage });
  };

  // When nspell finishes loading while the context menu is open (spellWord is
  // set but spellSuggestions is still undefined), update the suggestions.
  useEffect(() => {
    if (!nspell || !spellWord || spellSuggestions !== undefined) return;
    if (!nspell.check(spellWord)) {
      setSpellSuggestions(nspell.suggest(spellWord));
    } else {
      setSpellSuggestions([]);
    }
  }, [nspell, spellWord, spellSuggestions]);

  const handleApplySuggestion = useCallback((replacement: string) => {
    if (!editor || !spellWordRange) return;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: spellWordRange.from, to: spellWordRange.to })
      .insertContent(replacement)
      .run();
  }, [editor, spellWordRange]);

  const handleAddComment = (selectedText: string) => {
    setCommentInitialText(selectedText ? `"${selectedText}"\n\n` : '');
    setShowComments(true);
  };

  // ── AI writing handlers ────────────────────────────────────────────────────

  const runAiOperation = useCallback(async (
    op: AiOperation,
    toneValues?: ToneValues,
    grammarContext?: { message: string; issueText: string; suggestion?: string; category?: string },
  ) => {
    if (!editor) return;
    setAiOperation(op);
    setShowAiPanel(true);
    setAiLoading(true);
    setAiError(null);
    setAiResult('');

    const { from, to, empty } = editor.state.selection;
    const selectedText = empty ? '' : editor.state.doc.textBetween(from, to, ' ');
    const fullText = editor.state.doc.textContent;

    try {
      let result = '';
      let customInsertText: string | null = null;

      if (op === 'grammar-fix' && grammarContext) {
        const { message, issueText, suggestion, category } = grammarContext;
        const { provider, apiKey } = getProviderOptions();

        try {
          const res = await fetch('/api/ai/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider,
              apiKey,
              systemPrompt:
                'You are a precise grammar editor. When given a grammar issue and the problematic text, return ONLY the corrected version of that text. No explanation. No quotation marks. No extra words. Just the corrected text itself.',
              userMessage: `Grammar issue: ${message}\nText to fix: "${issueText}"`,
            }),
          });
          const data = await res.json() as { text?: string; error?: string };
          if (data.error) throw new Error(data.error);
          const aiFixed = data.text?.trim() ?? '';
          if (!aiFixed) throw new Error('Empty response from AI');

          result = `Issue: ${message}\n\nOriginal: "${issueText}"\nAI fix: "${aiFixed}"`;
          customInsertText = aiFixed;
          grammarAiCanInsertRef.current = true;
        } catch (aiErr) {
          // AI call failed — fall back to rule-based hint so the user still gets something.
          const errMsg = aiErr instanceof Error ? aiErr.message : 'AI unavailable';
          if (suggestion) {
            result = `Issue: ${message}\n\nOriginal: "${issueText}"\nRule-based fix: "${suggestion}"\n\n(AI error: ${errMsg})`;
            customInsertText = suggestion;
            grammarAiCanInsertRef.current = true;
          } else if (category === 'readability') {
            result = `Issue: ${message}\n\nThis sentence is too long to rewrite automatically. Consider:\n• Breaking at a conjunction (and, but, or, so)\n• Splitting into two complete sentences\n• Removing parenthetical clauses\n\n(AI error: ${errMsg})`;
            customInsertText = '';
            grammarAiCanInsertRef.current = false;
          } else {
            result = `Issue: ${message}\n\n"${issueText}"\n\nAI error: ${errMsg}. Please review and correct manually.`;
            customInsertText = '';
            grammarAiCanInsertRef.current = false;
          }
        }

      } else {
        // Simulated responses for non-grammar-fix operations.
        await new Promise<void>(r => setTimeout(r, 800));

        if (op === 'suggestions') {
          const context = selectedText || fullText.slice(-200);
          result = context
            ? `Here is a suggested continuation:\n\n"${context.trim()}… and this idea can be expanded further by considering the broader implications and exploring related perspectives that enrich the original thought."`
            : 'Start writing to get AI suggestions.';
        } else if (op === 'summarize') {
          const text = selectedText || fullText;
          const wordCount = text.trim().split(/\s+/).length;
          result = text.trim()
            ? `Summary (${wordCount} words → ~${Math.max(1, Math.round(wordCount * 0.15))} words):\n\nThis document covers key topics with relevant details. The main ideas are presented clearly and the content addresses the core subject matter effectively.`
            : 'No text to summarize.';
        } else if (op === 'change-tone' && toneValues) {
          const text = selectedText || fullText.slice(0, 300);
          const formalLabel = toneValues.formal > 66 ? 'formal' : toneValues.formal < 33 ? 'informal' : 'neutral';
          const moodLabel = toneValues.cheerful > 66 ? 'cheerful' : toneValues.cheerful < 33 ? 'reserved' : 'balanced';
          const lengthLabel = toneValues.verbose > 66 ? 'expanded' : toneValues.verbose < 33 ? 'condensed' : 'similar length';
          result = `Rewritten text (${formalLabel}, ${moodLabel}, ${lengthLabel}):\n\n${text.trim() || '(No text selected)'}`;
        }
      }

      aiInsertTextRef.current = customInsertText !== null
        ? customInsertText
        : result.split('\n\n').slice(1).join('\n\n') || result;
      setAiResult(result);
    } catch {
      setAiError('AI writing is unavailable. Please try again.');
    } finally {
      setAiLoading(false);
    }
  }, [editor, getProviderOptions]);

  const handleAiInsert = useCallback(() => {
    if (!editor || !aiInsertTextRef.current) return;
    const text = aiInsertTextRef.current;
    const { from, to, empty } = editor.state.selection;
    if (aiOperation === 'grammar-fix') {
      const range = grammarAiRangeRef.current;
      if (range) {
        editor.chain().focus().setTextSelection({ from: range.from, to: range.to }).insertContent(text).run();
        grammarAiRangeRef.current = null;
      }
    } else if (aiOperation === 'change-tone' && !empty) {
      editor.chain().focus().setTextSelection({ from, to }).insertContent(text).run();
    } else if (aiOperation === 'summarize' && !empty) {
      editor.chain().focus().setTextSelection({ from, to }).insertContent(text).run();
    } else {
      editor.chain().focus().insertContentAt(editor.state.selection.to, ' ' + text).run();
    }
    setShowAiPanel(false);
  }, [editor, aiOperation]);

  const handleApplyGrammarFix = useCallback((from: number, to: number, replacement: string) => {
    editor?.chain().focus().setTextSelection({ from, to }).insertContent(replacement).run();
  }, [editor]);

  const handleAiGrammarFix = useCallback(() => {
    if (!editor || !grammarIssue) return;
    const issueText = editor.state.doc.textBetween(grammarIssue.from, grammarIssue.to);
    grammarAiRangeRef.current = { from: grammarIssue.from, to: grammarIssue.to };
    runAiOperation('grammar-fix', undefined, {
      message: grammarIssue.message,
      issueText,
      suggestion: grammarIssue.suggestion,
      category: grammarIssue.category,
    });
  }, [editor, grammarIssue, runAiOperation]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    const { convertToHtml } = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await convertToHtml({ arrayBuffer });
    editor.commands.setContent(result.value, true);
  };

  const handlePrint = useCallback(() => {
    if (!editor) return;
    printDoc(title, editor.getHTML(), pageSetup);
  }, [editor, title, pageSetup]);

  const handleExport = (format: string) => {
    if (!editor) return;
    pendingExportHtmlRef.current = editor.getHTML();
    setSaveAsFormat(format);
    setShowSaveAs(true);
  };

  const handleSaveAs = async (opts: SaveAsOptions) => {
    console.log('[handleSaveAs] called', { opts, saveAsFormat });
    const html = pendingExportHtmlRef.current;
    console.log('[handleSaveAs] html length:', html.length);
    const ext: Record<string, string> = { pdf: '.pdf', docx: '.docx', html: '.html', txt: '.txt' };
    const filename = opts.filename.includes('.') ? opts.filename : opts.filename + (ext[saveAsFormat] ?? '');
    let blob: Blob;

    if (saveAsFormat === 'pdf') {
      console.log('[handleSaveAs] building PDF blob');
      blob = await buildPdfBlob(html, pageSetup, opts);
      console.log('[handleSaveAs] PDF blob built, size:', blob.size);
    } else if (saveAsFormat === 'docx') {
      blob = await buildDocxBlob(html);
    } else if (saveAsFormat === 'html') {
      blob = buildHtmlBlob(title, html);
    } else {
      const result = await docsApi.exportText(docId);
      blob = new Blob([result.text], { type: 'text/plain' });
    }

    if (opts.location === 'drive') {
      console.log('[handleSaveAs] uploading to Drive, folderId:', opts.folderId);
      const file = new File([blob], filename, { type: blob.type });
      await storageApi.uploadFile(file, undefined, opts.folderId);
      console.log('[handleSaveAs] Drive upload complete');
    } else {
      console.log('[handleSaveAs] downloading locally');
      downloadBlob(blob, filename);
    }
    console.log('[handleSaveAs] closing dialog');
    setShowSaveAs(false);
  };

  const wordCount = editor ? editor.storage.characterCount.words() : 0;
  const charCount = editor ? editor.storage.characterCount.characters() : 0;

  const { widthPx, heightPx } = useMemo(() => pageDimensions(pageSetup), [pageSetup]);
  const contentHeightPx = heightPx - pageSetup.marginTop - pageSetup.marginBottom;

  const pageStyle: React.CSSProperties = {
    width: widthPx,
    paddingTop: pageSetup.marginTop,
    paddingBottom: pageSetup.marginBottom,
    paddingLeft: pageSetup.marginLeft,
    paddingRight: pageSetup.marginRight,
    ...(flags.docsLayoutStructure && bgColor ? { backgroundColor: bgColor } : {}),
  };

  const totalPages = Math.max(1, Math.ceil(pageScrollHeight / heightPx));

  // Gradient that renders 0.5-in gray gaps between pages as backgroundImage on
  // the page div, so text always renders on top and is never obscured.
  const pageGapBackground = useMemo(() => {
    if (totalPages <= 1) return undefined;
    const gapColor = 'var(--color-bg-secondary, #f1f3f4)';
    const stops: string[] = [];
    for (let i = 0; i < totalPages - 1; i++) {
      const g0 = (i + 1) * heightPx - PAGE_GAP_PX / 2;
      const g1 = (i + 1) * heightPx + PAGE_GAP_PX / 2;
      stops.push(
        `transparent ${g0}px`,
        `${gapColor} ${g0}px`,
        `${gapColor} ${g1}px`,
        `transparent ${g1}px`,
      );
    }
    return `linear-gradient(to bottom, transparent 0px, ${stops.join(', ')}, transparent 100%)`;
  }, [totalPages, heightPx]);

  // Track page div scroll height for total page count
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setPageScrollHeight(el.scrollHeight));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Snap scroll position when single page mode, current page, or zoom changes
  useEffect(() => {
    if (!singlePageMode || !editorScrollRef.current) return;
    editorScrollRef.current.scrollTop = (currentPage - 1) * heightPx * zoomLevel / 100;
  }, [singlePageMode, currentPage, heightPx, zoomLevel]);

  const handleEditorScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (sideRulerColRef.current) {
      sideRulerColRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }, []);

  const handleZoomFitPage = useCallback(() => {
    if (!editorScrollRef.current) return;
    const avail = editorScrollRef.current.clientHeight - 64;
    setZoomLevel(Math.max(10, Math.min(200, Math.floor(avail / heightPx * 100))));
  }, [heightPx]);

  const handleZoomFitWidth = useCallback(() => {
    if (!editorScrollRef.current) return;
    const rulerW = showRulers && !distractionFree ? 20 : 0;
    const avail = editorScrollRef.current.clientWidth - 48 - rulerW;
    setZoomLevel(Math.max(10, Math.min(200, Math.floor(avail / widthPx * 100))));
  }, [widthPx, showRulers, distractionFree]);

  if (isLoading || !docId) {
    return <Spinner size="lg" overlay />;
  }

  return (
    <div className={distractionFree ? `${styles.shell} ${styles.distractionFreeShell}` : styles.shell}>
      {/* ── Top bar ── */}
      {!distractionFree && (<div className={styles.topbar}>
        <HamburgerMenu
          editor={editor}
          titleInputRef={titleInputRef}
          onSave={handleManualSave}
          onNewDoc={handleNewDoc}
          onDuplicate={handleDuplicate}
          onImport={() => importInputRef.current?.click()}
          onExport={handleExport}
          onPageSetup={() => setShowPageSetup(true)}
          onPrint={handlePrint}
          showOutline={showOutline}
          onToggleOutline={() => setShowOutline(v => !v)}
          showHistory={showHistory}
          onToggleHistory={() => setShowHistory(v => !v)}
          showComments={showComments}
          onToggleComments={() => setShowComments(v => !v)}
          distractionFree={distractionFree}
          onToggleFocus={() => setDistractionFree(v => !v)}
          showRulers={showRulers}
          onToggleRulers={() => setShowRulers(v => !v)}
          singlePageMode={singlePageMode}
          onToggleSinglePage={() => { setSinglePageMode(v => !v); setCurrentPage(1); }}
          {...(flags.docsLayoutStructure ? {
            onInsertFootnote: handleInsertFootnote,
            onInsertCrossRef: handleInsertCrossRef,
            onHeaderFooter: () => setShowHeaderFooterModal(true),
            onWatermark: () => setShowWatermarkModal(true),
            onTheme: () => setShowThemeModal(true),
          } : {})}
          {...(flags.docsAdvancedFormatting ? {
            onStylesPalette: () => setShowStylesPalette(true),
            onInsertLocalImage: handleInsertLocalImage,
          } : {})}
          {...(flags.docsEditingTools ? {
            onOpenFindReplace: () => setShowFindReplace(true),
            grammarEnabled,
            onToggleGrammar: () => setGrammarEnabled(v => !v),
            onAiSuggestions: () => runAiOperation('suggestions'),
            onAiSummarize: () => runAiOperation('summarize'),
            onAiChangeTone: () => setShowChangeTone(true),
          } : {})}
        />

        <button className={styles.backBtn} onClick={handleBack}>
          <ArrowLeft size={16} />
          Docs
        </button>

        <div className={styles.docIcon}>
          <FileText size={18} />
        </div>

        <input
          ref={titleInputRef}
          className={styles.titleInput}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          placeholder="Untitled document"
          spellCheck={false}
        />

        <div className={styles.topbarActions}>
          <span className={styles.saveStatus}>
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'unsaved' ? 'Unsaved changes' : 'All changes saved'}
          </span>

          <button
            className={styles.exportBtn}
            onClick={handleManualSave}
            disabled={versionMutation.isPending || !isLocalWriter}
            title={isLocalWriter ? 'Save version (Ctrl+S)' : 'Another collaborator is the active writer'}
            style={{ background: '#1a73e8', color: 'white', border: 'none' }}
          >
            Save
          </button>

          <ShareButton
            users={remoteUsers.map(u => ({
              name: u.name,
              isWriter: u.clientId === remoteWriterClientId,
            }))}
            onShare={() => setShowShareDialog(true)}
          />

          <input
            ref={importInputRef}
            type="file"
            accept=".docx"
            className={styles.hiddenInput}
            onChange={handleImport}
          />

          {/* Local image upload input — only needed when advanced formatting flag is on */}
          {flags.docsAdvancedFormatting && (
            <input
              ref={localImageInputRef}
              type="file"
              accept="image/*"
              className={styles.hiddenInput}
              onChange={handleLocalImageFileChange}
            />
          )}

        </div>

      </div>)}

      {/* ── Toolbar ── */}
      {!distractionFree && (<Toolbar
        editor={editor}
        onInsertImage={handleInsertImage}
        onInsertDiagram={() => setShowInsertDiagram(true)}
        {...(flags.docsAdvancedFormatting ? {
          onInsertLocalImage: handleInsertLocalImage,
          onOpenStylesPalette: () => setShowStylesPalette(true),
          onOpenImageProps: () => setShowImageProps(true),
          onOpenTableCellModal: () => setShowTableCellModal(true),
        } : {})}
        {...(flags.docsEditingTools ? {
          grammarEnabled,
          onToggleGrammar: () => setGrammarEnabled(v => !v),
          onAiSuggestions: () => runAiOperation('suggestions'),
          onAiSummarize: () => runAiOperation('summarize'),
          onAiChangeTone: () => setShowChangeTone(true),
          onOpenFindReplace: () => setShowFindReplace(true),
        } : {})}
      />)}

      {/* ── Find & replace bar (editing tools flag) ── */}
      {!distractionFree && flags.docsEditingTools && showFindReplace && editor && (
        <FindReplaceBar editor={editor} onClose={() => setShowFindReplace(false)} />
      )}

      {/* ── Track changes bar (docsTrackChanges flag) ── */}
      {!distractionFree && flags.docsTrackChanges && editor && (
        <TrackChangesBar
          editor={editor}
          suggestingMode={suggestingMode}
          onToggle={() => editor.commands.toggleSuggestingMode()}
        />
      )}

      {/* ── Main area ── */}
      <div className={styles.mainArea}>
        {!distractionFree && showOutline && <DocOutline editor={editor} />}

        {/* Editor area: rulers + scroll */}
        <div className={styles.editorArea}>
          {/* ── Top ruler row ── */}
          {showRulers && !distractionFree && (
            <div className={styles.rulerRow}>
              <div className={styles.rulerCorner} />
              <div className={styles.topRulerOuter}>
                <HorizontalRuler
                  pageWidthPx={widthPx}
                  marginLeftPx={pageSetup.marginLeft}
                  marginRightPx={pageSetup.marginRight}
                />
              </div>
            </div>
          )}

          {/* ── Content row: side ruler + editor scroll ── */}
          <div className={styles.editorWithRuler}>
            {showRulers && !distractionFree && (
              <div ref={sideRulerColRef} className={styles.sideRulerCol}>
                {/* 32px spacer matches editorScroll paddingTop so ruler y=0 aligns with page top */}
                <div style={{ height: 32, flexShrink: 0 }} />
                <VerticalRuler
                  pageHeightPx={heightPx}
                  marginTopPx={pageSetup.marginTop}
                  marginBottomPx={pageSetup.marginBottom}
                  totalPages={totalPages}
                />
              </div>
            )}
            <div
              ref={editorScrollRef}
              className={`${styles.editorScroll}${singlePageMode ? ` ${styles.singlePageScroll}` : ''}`}
              style={singlePageMode ? { height: heightPx * zoomLevel / 100 + 64 } : undefined}
              onContextMenu={handleContextMenu}
              onScroll={handleEditorScroll}
            >
              <div
                className={styles.pageZoomWrap}
                style={{
                  width: widthPx * zoomLevel / 100,
                  height: (pageScrollHeight || heightPx) * zoomLevel / 100,
                }}
              >
              <div
                ref={pageRef}
                className={styles.page}
                style={{
                  ...pageStyle,
                  margin: 0,
                  ...(pageGapBackground ? { backgroundImage: pageGapBackground } : {}),
                  ...(zoomLevel !== 100 ? { transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top left' } : {}),
                }}
                {...(flags.docsLayoutStructure && docTheme !== 'default'
                  ? { 'data-doc-theme': docTheme }
                  : {})}
              >
                {/* ── Header ── */}
                {flags.docsLayoutStructure && headerText && (
                  <div className={styles.pageHeader}>
                    {showPageNumbers ? headerText.replace('{{page}}', '1') : headerText}
                  </div>
                )}
                {/* ── Watermark ── */}
                {flags.docsLayoutStructure && watermarkText && (
                  <div className={styles.watermark} aria-hidden="true">{watermarkText}</div>
                )}
                <div className={styles.editorContent} onClick={flags.docsLayoutStructure ? handleCrossRefClick : undefined}>
                  <EditorContent editor={editor} />
                </div>
                {/* ── Footer ── */}
                {flags.docsLayoutStructure && footerText && (
                  <div className={styles.pageFooter}>
                    {showPageNumbers ? footerText.replace('{{page}}', '1') : footerText}
                  </div>
                )}
                {/* ── Footnote list ── */}
                {flags.docsLayoutStructure && editor && (() => {
                  void editorVersion;
                  const notes = getFootnoteItems(editor);
                  if (notes.length === 0) return null;
                  return (
                    <div className={styles.footnoteList}>
                      <div className={styles.footnoteDivider} />
                      {notes.map(n => (
                        <div key={n.id} id={`footnote-${n.id}`} className={styles.footnoteItem}>
                          <sup>{n.number}</sup> {n.text || '(empty footnote)'}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              </div>{/* end pageZoomWrap */}
            </div>
          </div>

          {/* ── Single page navigation ── */}
          {singlePageMode && !distractionFree && (
            <div className={styles.pageNav}>
              <button
                className={styles.pageNavBtn}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button
                className={styles.pageNavBtn}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        {!distractionFree && showHistory && (
          <VersionHistoryPanel
            fileId={docId}
            onRestore={() => {
              queryClient.invalidateQueries({ queryKey: ['doc-content', docId] });
            }}
            onClose={() => setShowHistory(false)}
            compareEnabled={flags.docsCompare}
            onCompare={(v) => setCompareVersion(v)}
          />
        )}
        {!distractionFree && flags.docsCompare && compareVersion && editor && (
          (() => {
            const currentVersionPlaceholder: FileVersionItem = {
              id: '__current__',
              fileId: docId,
              versionNumber: 999,
              sizeBytes: 0,
              label: 'Current',
              createdAt: new Date().toISOString(),
            };
            const currentContent = serializeContent(editor.getJSON(), layoutMetaRef.current, flags.docsLayoutStructure);
            return (
              <DocComparePanel
                fileId={docId}
                baseVersion={compareVersion}
                compareVersion={currentVersionPlaceholder}
                currentContent={currentContent}
                onClose={() => setCompareVersion(null)}
              />
            );
          })()
        )}
        {!distractionFree && showComments && (
          <CommentsPanel
            fileId={docId}
            onClose={() => { setShowComments(false); setCommentInitialText(''); }}
            initialText={commentInitialText}
          />
        )}
      </div>

      {/* ── Status bar ── */}
      {!distractionFree && (
        <div className={styles.statusBar}>
          <span>{wordCount.toLocaleString()} words</span>
          <span>{charCount.toLocaleString()} characters</span>
          {charCount > 1_020_000 && (
            <span style={{ color: '#d93025' }}>
              ⚠ Approaching 1M character limit ({charCount.toLocaleString()} / 1,020,000)
            </span>
          )}
          <div className={styles.zoomControls}>
            <button className={styles.zoomBtn} onClick={handleZoomFitPage} title="Zoom to fit entire page">Fit page</button>
            <button className={styles.zoomBtn} onClick={handleZoomFitWidth} title="Zoom to fit page width">Fit width</button>
            <ZoomSlider value={zoomLevel} onChange={setZoomLevel} min={10} max={200} step={10} />
          </div>
        </div>
      )}

      {distractionFree && (
        <button className={styles.dfmExitBtn} onClick={() => setDistractionFree(false)}>
          <Minimize2 size={14} /> Exit focus
        </button>
      )}

      {showPageSetup && (
        <PageSetupModal pageSetup={pageSetup} onSave={handlePageSetupSave} onClose={() => setShowPageSetup(false)} />
      )}

      {contextMenu && editor && (
        <EditorContextMenu
          editor={editor}
          x={contextMenu.x}
          y={contextMenu.y}
          hasSelection={!editor.state.selection.empty}
          onClose={() => {
            setContextMenu(null);
            setSpellWord(undefined);
            setSpellWordRange(null);
            setSpellSuggestions(undefined);
            setGrammarIssue(null);
          }}
          onAddComment={handleAddComment}
          onInsertLink={handleInsertLink}
          spellWord={spellWord}
          spellSuggestions={spellSuggestions}
          onApplySuggestion={handleApplySuggestion}
          {...(flags.docsEditingTools && grammarIssue ? {
            grammarMessage: grammarIssue.message,
            grammarSuggestion: grammarIssue.suggestion,
            grammarRange: { from: grammarIssue.from, to: grammarIssue.to },
            onApplyGrammarFix: handleApplyGrammarFix,
            onAiGrammarFix: handleAiGrammarFix,
          } : {})}
          isImageActive={!!(flags.docsAdvancedFormatting && contextMenu?.isOnImage)}
          onImageProperties={() => {
            setContextMenu(null);
            setSpellWord(undefined);
            setSpellWordRange(null);
            setSpellSuggestions(undefined);
            setGrammarIssue(null);
            setShowImageProps(true);
          }}
        />
      )}

      {sheetPasteDialogState && (
        <PasteChoiceDialog
          previewData={sheetPasteDialogState.previewData}
          onPasteAsTable={sheetPasteDialogState.onPasteAsTable}
          onPasteAsEmbed={sheetPasteDialogState.onPasteAsEmbed}
          onClose={sheetPasteDialogState.onClose}
        />
      )}

      {/* ── Layout & structure modals ── */}
      {flags.docsLayoutStructure && showHeaderFooterModal && (
        <HeaderFooterModal
          headerText={headerText}
          footerText={footerText}
          showPageNumbers={showPageNumbers}
          onSave={handleHeaderFooterSave}
          onClose={() => setShowHeaderFooterModal(false)}
        />
      )}
      {flags.docsLayoutStructure && showWatermarkModal && (
        <WatermarkModal
          watermarkText={watermarkText}
          bgColor={bgColor}
          onSave={handleWatermarkSave}
          onClose={() => setShowWatermarkModal(false)}
        />
      )}
      {flags.docsLayoutStructure && showThemeModal && (
        <ThemeModal
          currentTheme={docTheme}
          onSave={handleThemeSave}
          onClose={() => setShowThemeModal(false)}
        />
      )}

      {/* ── Advanced formatting modals ── */}
      {flags.docsAdvancedFormatting && showStylesPalette && editor && (
        <ParagraphStylesModal
          editor={editor}
          onClose={() => setShowStylesPalette(false)}
        />
      )}
      {flags.docsAdvancedFormatting && showImageProps && editor && (
        <ImagePropertiesModal
          editor={editor}
          initialAttrs={{
            src:         editor.getAttributes('image').src as string | undefined,
            width:       editor.getAttributes('image').width as string | null | undefined,
            alignment:   editor.getAttributes('image').alignment as string | undefined,
            alt:         editor.getAttributes('image').alt as string | undefined,
            title:       editor.getAttributes('image').title as string | undefined,
            caption:     editor.getAttributes('image').caption as string | undefined,
            border:      editor.getAttributes('image').border as string | null | undefined,
            shadow:      editor.getAttributes('image').shadow as string | undefined,
            imageFilter: editor.getAttributes('image').imageFilter as string | null | undefined,
          }}
          onClose={() => setShowImageProps(false)}
        />
      )}
      {flags.docsAdvancedFormatting && showTableCellModal && editor && (
        <TableCellModal
          editor={editor}
          onClose={() => setShowTableCellModal(false)}
        />
      )}

      {/* ── Editing tools modals (feature gap #3) ── */}
      {showSaveAs && (
        <SaveAsDialog
          defaultFilename={`${title || 'Untitled document'}.${saveAsFormat}`}
          format={saveAsFormat}
          onSave={handleSaveAs}
          onClose={() => setShowSaveAs(false)}
        />
      )}

      {flags.docsEditingTools && showChangeTone && (
        <ChangeToneDialog
          hasSelection={editor ? !editor.state.selection.empty : false}
          onApply={(values) => {
            setShowChangeTone(false);
            runAiOperation('change-tone', values);
          }}
          onClose={() => setShowChangeTone(false)}
        />
      )}

      {flags.docsEditingTools && showAiPanel && (
        <div className={styles.aiPanelOverlay}>
          <AiPanel
            operation={aiOperation}
            result={aiResult}
            isLoading={aiLoading}
            error={aiError}
            hasSelection={editor ? !editor.state.selection.empty : false}
            onInsert={handleAiInsert}
            onClose={() => setShowAiPanel(false)}
            canInsert={aiOperation !== 'grammar-fix' || grammarAiCanInsertRef.current}
          />
        </div>
      )}

      {showShareDialog && doc && (
        <ShareDialog
          resource={{ ...doc, name: doc.title } as unknown as FileItem}
          resourceType="file"
          onClose={() => setShowShareDialog(false)}
        />
      )}

      {showInsertDiagram && (
        <InsertDiagramDocDialog
          onInsert={(diagramId, title: string) => {
            editor?.chain().focus().insertContent({
              type: 'diagramEmbed',
              attrs: { diagramId, pageIndex: '0', title },
            }).run();
            setShowInsertDiagram(false);
          }}
          onClose={() => setShowInsertDiagram(false)}
        />
      )}
    </div>
  );
}
