'use client';

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Download,
  Plus,
  Trash2,
  Type,
  Square,
  Circle,
  ChevronDown,
  Play,
  Presentation,
  Copy,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  ChevronUp,
  LayoutTemplate,
  Zap,
  Upload,
  ArrowRight,
  ZoomIn,
  Layers,
  Sun,
  RotateCcw,
  Box,
  Images,
  Grid,
  ChevronsRight,
  Eraser,
} from 'lucide-react';
import { Button } from '@neutrino/ui';
import { slidesApi, driveReadContent, driveWriteContent, driveWriteEncryptedContent, storageApi } from '@/lib/api';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { decryptFile } from '@neutrino/e2e-crypto';
import type { SlideTheme } from '@neutrino/api-slides';
import { FONT_FAMILY_NAMES as FONT_FAMILIES } from '@/constants/editor';
import { useSpellCheck } from '@/hooks/useSpellCheck';
import { useSheetPasteInterceptor, PasteChoiceDialog } from '@neutrino/sheet-embed';
import type { SheetEmbedAttrsShape, CellValue } from '@neutrino/sheet-embed';

// ── Domain modules ────────────────────────────────────────────────────────────
import type {
  TextStyle,
  ElementAnimation,
  TextElement,
  ShapeElement,
  SlideElement,
  SlideBackground,
  Slide,
  Theme,
  SlideMaster,
  SlidePresentation,
} from './slideEditorTypes';
import {
  DEFAULT_THEME,
  SHAPE_CATALOG,
  SHAPE_GROUPS,
  SLIDE_LAYOUTS,
  makeDefaultPresentation,
  makeDefaultMaster,
  uid,
} from './slideEditorConstants';
import { slideBackgroundStyle, dbThemeToTheme } from './slideEditorHelpers';
import { exportAsPptx } from './pptxExport';
import BackgroundPicker from './BackgroundPicker';
import SlideCanvas from './SlideCanvas';
import SlideThumbnail from './SlideThumbnail';
import PresenterView from './PresenterView';
import { LayoutPreview, ThemePreview } from './slideEditorPreviews';
import styles from './page.module.css';

// ── Re-exports ────────────────────────────────────────────────────────────────
export type { TextStyle, ElementAnimation, TextElement, ShapeElement, SheetEmbedElement, SlideElement, SlideBackground, Slide, Theme, SlideMaster, SlidePresentation } from './slideEditorTypes';
// importFromPptx is intentionally NOT re-exported here so that pptxImport (and
// its jszip dependency) stays out of the initial bundle. Callers that need it
// should use: const { importFromPptx } = await import('./pptxImport')

// ── Save status ──────────────────────────────────────────────────────────────

type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

// ── Main component ───────────────────────────────────────────────────────────

export function SlideEditor() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const slideId = searchParams.get('id') ?? '';
  const { spellCheck } = useSpellCheck();

  const { dekRef, dekResolved } =
    useEncryptedDocumentContent({ id: slideId, filename: 'slide.json' });

  const [title, setTitle] = useState('');
  const [presentation, setPresentation] = useState<SlidePresentation>(makeDefaultPresentation);
  const [selectedSlideIdx, setSelectedSlideIdx] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [presenterMode, setPresenterMode] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [masterMode, setMasterMode] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'layout' | 'notes' | 'theme' | 'shapes'>('notes');
  const [zoom, setZoom] = useState(100);

  const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200];
  function zoomIn()  { setZoom((z) => ZOOM_STEPS.find((s) => s > z) ?? z); }
  function zoomOut() { setZoom((z) => [...ZOOM_STEPS].reverse().find((s) => s < z) ?? z); }
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef('');
  const exportRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const dragSrcIdx = useRef<number | null>(null);

  const { isLoading: metaLoading, data: slideData } = useQuery({
    queryKey: ['slide', slideId],
    queryFn: () => slidesApi.getSlide(slideId),
    enabled: !!slideId,
    staleTime: 30_000,
  });

  const { isLoading: contentLoading, data: slideContent } = useQuery({
    queryKey: ['slide-content', slideId, dekResolved],
    queryFn: async () => {
      if (!slideData?.contentUrl) return null;
      if (dekRef.current) {
        const blob = await storageApi.downloadFile(slideId);
        const cipherBytes = new Uint8Array(await blob.arrayBuffer());
        const plainBytes = decryptFile(cipherBytes, dekRef.current);
        return new TextDecoder().decode(plainBytes);
      }
      return driveReadContent(slideData.contentUrl);
    },
    enabled: !!slideData?.contentUrl && dekResolved,
    staleTime: 30_000,
  });

  const { data: dbThemesData } = useQuery({
    queryKey: ['slide-themes'],
    queryFn: () => slidesApi.listThemes(),
    staleTime: 60_000,
  });

  const isLoading = metaLoading || contentLoading;

  useEffect(() => {
    if (!slideData) return;
    setTitle(slideData.title);
  }, [slideData]);

  useEffect(() => {
    if (!slideContent) return;
    try {
      const parsed: SlidePresentation = JSON.parse(slideContent);
      if (parsed?.slides?.length > 0) {
        setPresentation(parsed);
        lastSavedRef.current = slideContent;
      }
    } catch {
      // keep default
    }
  }, [slideContent]);

  const contentMutation = useMutation({
    mutationFn: (content: string) =>
      dekRef.current
        ? driveWriteEncryptedContent(slideData!.id, content, 'slide.json', dekRef.current)
        : driveWriteContent(slideData!.contentWriteUrl, content, 'slide.json'),
    onMutate: () => setSaveStatus('saving'),
    onSuccess: (_, content) => {
      setSaveStatus('saved');
      lastSavedRef.current = content;
      queryClient.invalidateQueries({ queryKey: ['slides'] });
    },
    onError: () => setSaveStatus('error'),
  });

  const metaMutation = useMutation({
    mutationFn: (newTitle: string) =>
      slidesApi.saveSlide(slideId, { title: newTitle }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['slides'] }),
  });

  const scheduleAutoSave = useCallback((pres: SlidePresentation) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('unsaved');
    saveTimerRef.current = setTimeout(() => {
      const content = JSON.stringify(pres);
      contentMutation.mutate(content);
    }, 2000);
  }, [contentMutation]);

  function updatePresentation(updater: (p: SlidePresentation) => SlidePresentation) {
    setPresentation((prev) => {
      const next = updater(prev);
      scheduleAutoSave(next);
      return next;
    });
  }

  function handleTitleBlur() {
    const trimmed = title.trim();
    if (!trimmed) return;
    metaMutation.mutate(trimmed);
  }

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  // ── Slide operations ─────────────────────────────────────────────────────

  const currentSlide = presentation.slides[selectedSlideIdx] ?? presentation.slides[0];

  function applyTheme(theme: Theme) {
    updatePresentation((p) => ({
      ...p,
      theme,
      slides: p.slides.map((s) => ({
        ...s,
        background: theme.backgroundImage
          ? { type: 'image', value: theme.backgroundImage, objectFit: 'cover' as const }
          : { type: 'color', value: theme.gradient ?? theme.backgroundColor },
        transition: theme.defaultTransition,
        elements: s.elements.map((el) => {
          if (el.type === 'text') return { ...el, style: { ...el.style, color: theme.textColor, fontFamily: theme.fontFamily } };
          if (el.type === 'shape') return { ...el, fill: theme.primaryColor };
          return el;
        }),
      })),
    }));
  }

  function applyLayout(layout: (typeof SLIDE_LAYOUTS)[number]) {
    const master = presentation.master ?? makeDefaultMaster();
    const elements = layout.makeElements(presentation.theme, master);
    updateCurrentSlide((s) => ({ ...s, elements }));
    setSelectedElementId(null);
    setRightPanelTab('notes');
  }

  function addSlide() {
    const theme = presentation.theme;
    const newSlide: Slide = {
      id: uid(),
      background: theme.backgroundImage
        ? { type: 'image', value: theme.backgroundImage, objectFit: 'cover' as const }
        : { type: 'color', value: theme.gradient ?? theme.backgroundColor },
      elements: [],
      notes: '',
      transition: theme.defaultTransition,
    };
    updatePresentation((p) => {
      const slides = [...p.slides];
      slides.splice(selectedSlideIdx + 1, 0, newSlide);
      return { ...p, slides };
    });
    setSelectedSlideIdx(selectedSlideIdx + 1);
    setSelectedElementId(null);
  }

  function duplicateSlide() {
    const copy: Slide = {
      ...currentSlide,
      id: uid(),
      elements: currentSlide.elements.map((el) => ({ ...el, id: uid() })),
    };
    updatePresentation((p) => {
      const slides = [...p.slides];
      slides.splice(selectedSlideIdx + 1, 0, copy);
      return { ...p, slides };
    });
    setSelectedSlideIdx(selectedSlideIdx + 1);
  }

  function deleteSlide() {
    if (presentation.slides.length <= 1) return;
    updatePresentation((p) => {
      const slides = p.slides.filter((_, i) => i !== selectedSlideIdx);
      return { ...p, slides };
    });
    setSelectedSlideIdx(Math.max(0, selectedSlideIdx - 1));
    setSelectedElementId(null);
  }

  function moveSlide(dir: -1 | 1) {
    const newIdx = selectedSlideIdx + dir;
    if (newIdx < 0 || newIdx >= presentation.slides.length) return;
    updatePresentation((p) => {
      const slides = [...p.slides];
      [slides[selectedSlideIdx], slides[newIdx]] = [slides[newIdx], slides[selectedSlideIdx]];
      return { ...p, slides };
    });
    setSelectedSlideIdx(newIdx);
  }

  // ── Drag-to-reorder ──────────────────────────────────────────────────────

  function handleSlideDragStart(e: React.DragEvent, idx: number) {
    dragSrcIdx.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleSlideDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  }

  function handleSlideDrop(e: React.DragEvent, dropIdx: number) {
    e.preventDefault();
    const srcIdx = dragSrcIdx.current;
    if (srcIdx === null || srcIdx === dropIdx) {
      setDragOverIdx(null);
      return;
    }
    updatePresentation((p) => {
      const slides = [...p.slides];
      const [removed] = slides.splice(srcIdx, 1);
      slides.splice(dropIdx, 0, removed);
      return { ...p, slides };
    });
    setSelectedSlideIdx(dropIdx);
    setSelectedElementId(null);
    dragSrcIdx.current = null;
    setDragOverIdx(null);
  }

  function handleSlideDragEnd() {
    dragSrcIdx.current = null;
    setDragOverIdx(null);
  }

  function updateCurrentSlide(updater: (s: Slide) => Slide) {
    updatePresentation((p) => {
      const slides = p.slides.map((s, i) => i === selectedSlideIdx ? updater(s) : s);
      return { ...p, slides };
    });
  }

  // ── Element operations ───────────────────────────────────────────────────

  function addTextBox() {
    const el: TextElement = {
      id: uid(),
      type: 'text',
      x: 20, y: 40, w: 60, h: 15,
      content: 'New text box',
      style: { fontSize: 24, bold: false, italic: false, underline: false, color: presentation.theme.textColor, align: 'left', fontFamily: 'Inter' },
    };
    updateCurrentSlide((s) => ({ ...s, elements: [...s.elements, el] }));
    setSelectedElementId(el.id);
  }

  function addShape(shape: string) {
    const el: ShapeElement = {
      id: uid(),
      type: 'shape',
      shape,
      x: 30, y: 35, w: 40, h: 25,
      fill: presentation.theme.primaryColor,
      stroke: 'transparent',
      strokeWidth: 0,
    };
    updateCurrentSlide((s) => ({ ...s, elements: [...s.elements, el] }));
    setSelectedElementId(el.id);
  }

  // ── Sheet embed operations ────────────────────────────────────────────────

  function addSheetEmbed(attrs: SheetEmbedAttrsShape) {
    const el: import('./slideEditorTypes').SheetEmbedElement = {
      id: uid(),
      type: 'sheetEmbed',
      x: 10, y: 20, w: 80, h: 50,
      spreadsheetId: attrs.spreadsheetId,
      sheetId: attrs.sheetId,
      namedRangeId: attrs.namedRangeId,
      cachedData: attrs.cachedData ? JSON.stringify(attrs.cachedData) : null,
      cachedAt: attrs.cachedAt,
      title: attrs.title ?? null,
    };
    updateCurrentSlide((s) => ({ ...s, elements: [...s.elements, el] }));
    setSelectedElementId(el.id);
  }

  function handleEmbedCacheUpdate(elementId: string, rows: CellValue[][], fetchedAt: string) {
    updateElement(elementId, (el) => {
      if (el.type !== 'sheetEmbed') return el;
      return {
        ...el,
        cachedData: JSON.stringify(rows),
        cachedAt: fetchedAt,
      };
    });
  }

  function handleEmbedConvertToStatic(elementId: string, data: CellValue[][]) {
    // Build a plain text element summarising the table data, then remove the embed.
    const lines = data.map((row) => row.map((c) => c ?? '').join('\t')).join('\n');
    const textEl: TextElement = {
      id: uid(),
      type: 'text',
      x: 10, y: 20, w: 80, h: 50,
      content: lines,
      style: {
        fontSize: 14,
        bold: false,
        italic: false,
        underline: false,
        color: presentation.theme.textColor,
        align: 'left',
        fontFamily: 'Inter',
      },
    };
    updateCurrentSlide((s) => ({
      ...s,
      elements: [
        ...s.elements.filter((e) => e.id !== elementId),
        textEl,
      ],
    }));
    setSelectedElementId(textEl.id);
  }

  // ── Sheet-embed paste interceptor ─────────────────────────────────────────

  const { handlePaste: handleSheetPaste, dialogState: sheetPasteDialogState } = useSheetPasteInterceptor({
    onEmbed: useCallback((attrs: SheetEmbedAttrsShape) => {
      addSheetEmbed(attrs);
    // addSheetEmbed captures updateCurrentSlide which is stable per render cycle;
    // we accept the closure over the latest version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  });

  useEffect(() => {
    const listener = (e: ClipboardEvent) => {
      handleSheetPaste(e).then((consumed) => {
        if (consumed) e.preventDefault();
      });
    };
    document.addEventListener('paste', listener);
    return () => document.removeEventListener('paste', listener);
  }, [handleSheetPaste]);

  function deleteElement(elementId: string) {
    updateCurrentSlide((s) => ({ ...s, elements: s.elements.filter((e) => e.id !== elementId) }));
    setSelectedElementId(null);
  }

  function updateElement(elementId: string, updater: (el: SlideElement) => SlideElement) {
    updateCurrentSlide((s) => ({
      ...s,
      elements: s.elements.map((e) => e.id === elementId ? updater(e) : e),
    }));
  }

  function updateTextStyle(elementId: string, style: Partial<TextStyle>) {
    updateElement(elementId, (el) => {
      if (el.type !== 'text') return el;
      return { ...el, style: { ...el.style, ...style } };
    });
  }

  function updateElementAnimation(elementId: string, anim: Partial<ElementAnimation>) {
    updateElement(elementId, (el) => {
      const current: ElementAnimation = el.animation ?? { type: 'none', duration: 500, delay: 0 };
      return { ...el, animation: { ...current, ...anim } };
    });
  }

  // ── Slide master operations ──────────────────────────────────────────────

  function updateMaster(updater: (m: SlideMaster) => SlideMaster) {
    updatePresentation((p) => ({
      ...p,
      master: updater(p.master ?? makeDefaultMaster()),
    }));
  }

  function applyMasterToAllSlides() {
    const master = presentation.master ?? makeDefaultMaster();
    updatePresentation((p) => ({
      ...p,
      slides: p.slides.map((s) => ({
        ...s,
        background: { type: 'color', value: master.background },
        elements: s.elements.map((el, idx) => {
          if (el.type !== 'text') return el;
          if (idx === 0) {
            return {
              ...el,
              style: {
                ...el.style,
                fontSize: master.titleFontSize,
                bold: master.titleBold,
                color: master.titleColor,
              },
            };
          }
          return {
            ...el,
            style: {
              ...el.style,
              fontSize: master.bodyFontSize,
              bold: master.bodyBold,
              color: master.bodyColor,
            },
          };
        }),
      })),
    }));
  }

  // ── PPTX import handler ───────────────────────────────────────────────────

  async function handleImportPptx(file: File) {
    setImportError(null);
    try {
      const { importFromPptx } = await import('./pptxImport');
      const imported = await importFromPptx(file);
      setPresentation(imported);
      scheduleAutoSave(imported);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import file');
    }
  }

  // ── Selected element ─────────────────────────────────────────────────────

  const selectedElement = currentSlide?.elements.find((e) => e.id === selectedElementId) ?? null;

  const saveStatusText =
    saveStatus === 'saving' ? 'Saving…' :
    saveStatus === 'unsaved' ? 'Unsaved changes' :
    saveStatus === 'error' ? 'Save failed' :
    'All changes saved';

  const saveStatusClass =
    saveStatus === 'saving' ? styles.saveStatusSaving :
    saveStatus === 'error' ? styles.saveStatusError :
    '';

  if (isLoading) return <div style={{ padding: '2rem' }}>Loading presentation…</div>;

  // ── Presenter mode ───────────────────────────────────────────────────────

  if (presenterMode) {
    return (
      <PresenterView
        presentation={presentation}
        onExit={() => setPresenterMode(false)}
      />
    );
  }

  const master = presentation.master ?? makeDefaultMaster();

  return (
    <div className={styles.editorWrapper}>
      {/* Hidden PPTX file input */}
      <input
        ref={importInputRef}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportPptx(file);
          e.target.value = '';
        }}
      />

      {/* Top bar */}
      <div className={styles.topBar}>
        <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => { queryClient.invalidateQueries({ queryKey: ['slides'] }); router.push('/slides'); }} className={styles.backBtn}>
          Slides
        </Button>

        <div className={styles.titleArea}>
          <Presentation size={18} color="var(--color-rose, #e11d48)" />
          <input
            className={styles.titleInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            placeholder="Untitled presentation"
          />
        </div>

        <span className={`${styles.saveStatus} ${saveStatusClass}`}>{saveStatusText}</span>

        <div className={styles.actions}>
          {/* Master toggle */}
          <Button
            variant={masterMode ? 'primary' : 'secondary'}
            icon={<LayoutTemplate size={16} />}
            onClick={() => { setMasterMode((v) => !v); setSelectedElementId(null); }}
            title="Slide Master"
          >
            Master
          </Button>


          {/* Export + Import */}
          <div className={styles.dropdownTrigger} ref={exportRef}>
            <Button variant="secondary" icon={<Download size={16} />} onClick={() => setExportOpen((v) => !v)}>
              Export <ChevronDown size={14} />
            </Button>
            {exportOpen && (
              <div className={styles.dropdownMenu}>
                <button
                  className={styles.dropdownItem}
                  onClick={async () => {
                    setExportOpen(false);
                    await exportAsPptx(title || 'presentation', presentation);
                  }}
                >
                  PowerPoint (.pptx)
                </button>
              </div>
            )}
          </div>

          <Button
            variant="secondary"
            icon={<Upload size={16} />}
            onClick={() => importInputRef.current?.click()}
            title="Import PPTX"
          >
            Import
          </Button>

          <Button icon={<Play size={16} />} onClick={() => setPresenterMode(true)}>
            Present
          </Button>
        </div>
      </div>

      {/* Import error banner */}
      {importError && (
        <div className={styles.errorBanner}>
          {importError}
          <button onClick={() => setImportError(null)} className={styles.errorBannerClose}>✕</button>
        </div>
      )}

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <button className={styles.toolbarBtn} onClick={addTextBox} title="Add text box">
          <Type size={16} /> Text
        </button>
        <button className={styles.toolbarBtn} onClick={() => addShape('rect')} title="Add rectangle">
          <Square size={16} /> Rectangle
        </button>
        <button className={styles.toolbarBtn} onClick={() => addShape('circle')} title="Add circle">
          <Circle size={16} /> Circle
        </button>

        {selectedElement?.type === 'text' && (
          <>
            <div className={styles.toolbarDivider} />
            <button
              className={`${styles.toolbarBtn} ${(selectedElement as TextElement).style.bold ? styles.toolbarBtnActive : ''}`}
              onClick={() => updateTextStyle(selectedElement.id, { bold: !(selectedElement as TextElement).style.bold })}
              title="Bold"
            >
              <Bold size={16} />
            </button>
            <button
              className={`${styles.toolbarBtn} ${(selectedElement as TextElement).style.italic ? styles.toolbarBtnActive : ''}`}
              onClick={() => updateTextStyle(selectedElement.id, { italic: !(selectedElement as TextElement).style.italic })}
              title="Italic"
            >
              <Italic size={16} />
            </button>
            <button
              className={`${styles.toolbarBtn} ${(selectedElement as TextElement).style.underline ? styles.toolbarBtnActive : ''}`}
              onClick={() => updateTextStyle(selectedElement.id, { underline: !(selectedElement as TextElement).style.underline })}
              title="Underline"
            >
              <Underline size={16} />
            </button>
            <select
              className={styles.toolbarSelect}
              value={(selectedElement as TextElement).style.fontFamily}
              onChange={(e) => updateTextStyle(selectedElement.id, { fontFamily: e.target.value })}
              title="Font family"
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <div className={styles.toolbarDivider} />
            <button className={styles.toolbarBtn} onClick={() => updateTextStyle(selectedElement.id, { fontSize: Math.max(8, (selectedElement as TextElement).style.fontSize - 2) })} title="Decrease font size">
              <Minus size={14} />
            </button>
            <span className={styles.toolbarFontSize}>{(selectedElement as TextElement).style.fontSize}px</span>
            <button className={styles.toolbarBtn} onClick={() => updateTextStyle(selectedElement.id, { fontSize: Math.min(120, (selectedElement as TextElement).style.fontSize + 2) })} title="Increase font size">
              <Plus size={14} />
            </button>
            <div className={styles.toolbarDivider} />
            <button
              className={`${styles.toolbarBtn} ${(selectedElement as TextElement).style.align === 'left' ? styles.toolbarBtnActive : ''}`}
              onClick={() => updateTextStyle(selectedElement.id, { align: 'left' })}
              title="Align left"
            >
              <AlignLeft size={16} />
            </button>
            <button
              className={`${styles.toolbarBtn} ${(selectedElement as TextElement).style.align === 'center' ? styles.toolbarBtnActive : ''}`}
              onClick={() => updateTextStyle(selectedElement.id, { align: 'center' })}
              title="Align center"
            >
              <AlignCenter size={16} />
            </button>
            <button
              className={`${styles.toolbarBtn} ${(selectedElement as TextElement).style.align === 'right' ? styles.toolbarBtnActive : ''}`}
              onClick={() => updateTextStyle(selectedElement.id, { align: 'right' })}
              title="Align right"
            >
              <AlignRight size={16} />
            </button>
            <div className={styles.toolbarDivider} />
            <input
              type="color"
              className={styles.colorPicker}
              value={(selectedElement as TextElement).style.color}
              onChange={(e) => updateTextStyle(selectedElement.id, { color: e.target.value })}
              title="Text color"
            />
            <button
              className={styles.toolbarBtn}
              onClick={() => deleteElement(selectedElement.id)}
              title="Delete element"
            >
              <Trash2 size={16} />
            </button>
          </>
        )}

        {selectedElement?.type === 'shape' && (
          <>
            <div className={styles.toolbarDivider} />
            <input
              type="color"
              className={styles.colorPicker}
              value={(selectedElement as ShapeElement).fill}
              onChange={(e) => updateElement(selectedElement.id, (el) => ({ ...el, fill: e.target.value } as ShapeElement))}
              title="Fill color"
            />
            <button
              className={styles.toolbarBtn}
              onClick={() => deleteElement(selectedElement.id)}
              title="Delete element"
            >
              <Trash2 size={16} />
            </button>
          </>
        )}

        {/* Animation controls for selected element */}
        {selectedElement && (
          <>
            <div className={styles.toolbarDivider} />
            <Zap size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <select
              className={styles.toolbarSelect}
              value={selectedElement.animation?.type ?? 'none'}
              onChange={(e) =>
                updateElementAnimation(selectedElement.id, { type: e.target.value as ElementAnimation['type'] })
              }
              title="Entry animation"
            >
              <option value="none">No animation</option>
              <option value="fade">Fade in</option>
              <option value="fly-in">Fly in</option>
              <option value="zoom">Zoom in</option>
            </select>
            {selectedElement.animation?.type === 'fly-in' && (
              <select
                className={styles.toolbarSelect}
                value={selectedElement.animation.direction ?? 'left'}
                onChange={(e) =>
                  updateElementAnimation(selectedElement.id, { direction: e.target.value as ElementAnimation['direction'] })
                }
                title="Direction"
              >
                <option value="left">From left</option>
                <option value="right">From right</option>
                <option value="top">From top</option>
                <option value="bottom">From bottom</option>
              </select>
            )}
            {selectedElement.animation && selectedElement.animation.type !== 'none' && (
              <>
                <span className={styles.toolbarLabel} title="Duration (ms)">
                  Duration
                  <input
                    type="number"
                    min={100}
                    max={2000}
                    step={100}
                    value={selectedElement.animation.duration}
                    onChange={(e) =>
                      updateElementAnimation(selectedElement.id, { duration: parseInt(e.target.value) || 500 })
                    }
                    className={styles.toolbarNumberInput}
                    title="Duration in milliseconds"
                  />
                  ms
                </span>
                <span className={styles.toolbarLabel} title="Delay (ms)">
                  Delay
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    step={100}
                    value={selectedElement.animation.delay}
                    onChange={(e) =>
                      updateElementAnimation(selectedElement.id, { delay: parseInt(e.target.value) || 0 })
                    }
                    className={styles.toolbarNumberInput}
                    title="Delay in milliseconds"
                  />
                  ms
                </span>
              </>
            )}
          </>
        )}

        {/* Background */}
        <div className={styles.toolbarDivider} />
        <BackgroundPicker
          background={currentSlide.background}
          onChange={(bg) => updateCurrentSlide((s) => ({ ...s, background: bg }))}
        />

        {/* Transition */}
        <div className={styles.toolbarDivider} />
        <select
          className={styles.toolbarSelect}
          value={currentSlide.transition}
          onChange={(e) => updateCurrentSlide((s) => ({ ...s, transition: e.target.value as Slide['transition'] }))}
          title="Slide transition"
        >
          <option value="none">No transition</option>
          <option value="fade">Fade</option>
          <option value="dissolve">Dissolve</option>
          <option value="slide">Slide Right</option>
          <option value="slide-left">Slide Left</option>
          <option value="flip">Flip</option>
          <option value="cube">Cube</option>
          <option value="gallery">Gallery</option>
          <option value="pixelate">Pixelate</option>
          <option value="cover">Cover</option>
          <option value="wipe">Wipe</option>
          <option value="zoom">Zoom</option>
        </select>

        {/* Zoom */}
        <div className={styles.toolbarSpacer} />
        <div className={styles.toolbarDivider} />
        <div className={styles.zoomControl}>
          <button className={styles.toolbarBtn} onClick={zoomOut} disabled={zoom <= ZOOM_STEPS[0]} title="Zoom out"><Minus size={12} /></button>
          <button className={styles.zoomLabel} onClick={() => setZoom(100)} title="Reset zoom">{zoom}%</button>
          <button className={styles.toolbarBtn} onClick={zoomIn} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} title="Zoom in"><Plus size={12} /></button>
        </div>
      </div>

      {/* Main area */}
      <div className={styles.mainArea}>
        {/* Slide panel */}
        <div className={styles.slidePanel}>
          <div className={styles.slidePanelHeader}>
            <span>Slides ({presentation.slides.length})</span>
            <button className={styles.slidePanelBtn} onClick={addSlide} title="Add slide"><Plus size={14} /></button>
          </div>
          <div className={styles.slidePanelList}>
            {presentation.slides.map((slide, idx) => (
              <div
                key={slide.id}
                draggable
                className={[
                  styles.slideThumbnail,
                  idx === selectedSlideIdx ? styles.slideThumbnailActive : '',
                  dragOverIdx === idx && dragSrcIdx.current !== idx ? styles.slideThumbnailDropTarget : '',
                ].join(' ')}
                onClick={() => { setSelectedSlideIdx(idx); setSelectedElementId(null); }}
                onDragStart={(e) => handleSlideDragStart(e, idx)}
                onDragOver={(e) => handleSlideDragOver(e, idx)}
                onDrop={(e) => handleSlideDrop(e, idx)}
                onDragEnd={handleSlideDragEnd}
              >
                <span className={styles.slideThumbnailNum}>{idx + 1}</span>
                <SlideThumbnail slide={slide} />
                {slide.transition !== 'none' && (
                  <span className={styles.slideTransitionBadge} title={slide.transition}>
                    {slide.transition === 'fade'      && <Layers size={8} />}
                    {slide.transition === 'dissolve'  && <Sun size={8} />}
                    {slide.transition === 'slide'     && <ArrowRight size={8} />}
                    {slide.transition === 'slide-left'&& <ArrowLeft size={8} />}
                    {slide.transition === 'flip'      && <RotateCcw size={8} />}
                    {slide.transition === 'cube'      && <Box size={8} />}
                    {slide.transition === 'gallery'   && <Images size={8} />}
                    {slide.transition === 'pixelate'  && <Grid size={8} />}
                    {slide.transition === 'cover'     && <ChevronsRight size={8} />}
                    {slide.transition === 'wipe'      && <Eraser size={8} />}
                    {slide.transition === 'zoom'      && <ZoomIn size={8} />}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className={styles.slidePanelFooter}>
            <button className={styles.slidePanelBtn} onClick={() => moveSlide(-1)} disabled={selectedSlideIdx === 0} title="Move up"><ChevronUp size={14} /></button>
            <button className={styles.slidePanelBtn} onClick={() => moveSlide(1)} disabled={selectedSlideIdx >= presentation.slides.length - 1} title="Move down"><ChevronDown size={14} /></button>
            <button className={styles.slidePanelBtn} onClick={duplicateSlide} title="Duplicate slide"><Copy size={14} /></button>
            <button className={styles.slidePanelBtn} onClick={deleteSlide} disabled={presentation.slides.length <= 1} title="Delete slide"><Trash2 size={14} /></button>
          </div>
        </div>

        {/* Canvas area */}
        <div className={`${styles.canvasArea} ${zoom !== 100 ? styles.canvasAreaZoomed : ''}`}>
          <div style={zoom !== 100 ? { width: `${900 * zoom / 100}px`, flexShrink: 0 } : { width: '100%' }}>
            {currentSlide && (
              <SlideCanvas
                slide={currentSlide}
                selectedElementId={selectedElementId}
                editingElementId={editingElementId}
                spellCheck={spellCheck}
                onSelectElement={setSelectedElementId}
                onStartEdit={setEditingElementId}
                onStopEdit={() => setEditingElementId(null)}
                onUpdateElement={updateElement}
                onClickBackground={() => { setSelectedElementId(null); setEditingElementId(null); }}
                onEmbedCacheUpdate={handleEmbedCacheUpdate}
                onEmbedConvertToStatic={handleEmbedConvertToStatic}
                onEmbedRemove={deleteElement}
              />
            )}
          </div>
        </div>

        {/* Right panel: notes or master settings */}
        <div className={styles.rightPanel}>
          {masterMode ? (
            <div className={styles.rightPanelContent}>
              <div className={styles.rightPanelHeader}>
                <span>Slide Master</span>
              </div>
              <div className={styles.masterPanel}>
                <div className={styles.masterSection}>
                  <label className={styles.masterLabel}>Background</label>
                  <div className={styles.masterRow}>
                    <input
                      type="color"
                      className={styles.colorPicker}
                      value={master.background}
                      onChange={(e) => updateMaster((m) => ({ ...m, background: e.target.value }))}
                    />
                    <span className={styles.masterColorVal}>{master.background}</span>
                  </div>
                </div>

                <div className={styles.masterSection}>
                  <label className={styles.masterLabel}>Title Style</label>
                  <div className={styles.masterRow}>
                    <span className={styles.masterFieldLabel}>Size</span>
                    <input
                      type="number"
                      min={10}
                      max={120}
                      value={master.titleFontSize}
                      onChange={(e) => updateMaster((m) => ({ ...m, titleFontSize: parseInt(e.target.value) || 40 }))}
                      className={styles.masterNumberInput}
                    />
                  </div>
                  <div className={styles.masterRow}>
                    <span className={styles.masterFieldLabel}>Bold</span>
                    <input
                      type="checkbox"
                      checked={master.titleBold}
                      onChange={(e) => updateMaster((m) => ({ ...m, titleBold: e.target.checked }))}
                    />
                  </div>
                  <div className={styles.masterRow}>
                    <span className={styles.masterFieldLabel}>Color</span>
                    <input
                      type="color"
                      className={styles.colorPicker}
                      value={master.titleColor}
                      onChange={(e) => updateMaster((m) => ({ ...m, titleColor: e.target.value }))}
                    />
                  </div>
                </div>

                <div className={styles.masterSection}>
                  <label className={styles.masterLabel}>Body Style</label>
                  <div className={styles.masterRow}>
                    <span className={styles.masterFieldLabel}>Size</span>
                    <input
                      type="number"
                      min={8}
                      max={80}
                      value={master.bodyFontSize}
                      onChange={(e) => updateMaster((m) => ({ ...m, bodyFontSize: parseInt(e.target.value) || 24 }))}
                      className={styles.masterNumberInput}
                    />
                  </div>
                  <div className={styles.masterRow}>
                    <span className={styles.masterFieldLabel}>Bold</span>
                    <input
                      type="checkbox"
                      checked={master.bodyBold}
                      onChange={(e) => updateMaster((m) => ({ ...m, bodyBold: e.target.checked }))}
                    />
                  </div>
                  <div className={styles.masterRow}>
                    <span className={styles.masterFieldLabel}>Color</span>
                    <input
                      type="color"
                      className={styles.colorPicker}
                      value={master.bodyColor}
                      onChange={(e) => updateMaster((m) => ({ ...m, bodyColor: e.target.value }))}
                    />
                  </div>
                </div>

                <button className={styles.masterApplyBtn} onClick={applyMasterToAllSlides}>
                  Apply to All Slides
                </button>
                <p className={styles.masterHint}>
                  New slides will use the master background. &quot;Apply to All&quot; updates backgrounds and text styles across all slides.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Tab content */}
              <div className={styles.rightPanelContent}>
                {rightPanelTab === 'layout' ? (
                  <div className={styles.layoutPanel}>
                    <div className={styles.layoutGrid}>
                      {SLIDE_LAYOUTS.map((layout) => (
                        <button
                          key={layout.id}
                          className={styles.layoutCard}
                          onClick={() => applyLayout(layout)}
                          title={layout.name}
                        >
                          <div className={styles.layoutCardPreview}>
                            <LayoutPreview shapes={layout.preview} />
                          </div>
                          <span className={styles.layoutCardName}>{layout.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : rightPanelTab === 'theme' ? (
                  <div className={styles.themePanel}>
                    <div className={styles.themeGrid}>
                      {(dbThemesData?.themes ?? []).map((t) => (
                        <button
                          key={t.id}
                          className={`${styles.themeCard} ${presentation.theme.name === t.name ? styles.themeCardActive : ''}`}
                          onClick={() => applyTheme(dbThemeToTheme(t))}
                          title={t.name}
                        >
                          <div className={styles.themeCardPreview}>
                            <ThemePreview theme={t} />
                          </div>
                          <span className={styles.themeCardName}>{t.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : rightPanelTab === 'shapes' ? (
                  <div className={styles.shapesPanel}>
                    {SHAPE_GROUPS.map((group) => (
                      <div key={group.key} className={styles.shapesGroup}>
                        <span className={styles.shapesGroupLabel}>{group.label}</span>
                        <div className={styles.shapesGrid}>
                          {Object.entries(SHAPE_CATALOG)
                            .filter(([, def]) => def.group === group.key)
                            .map(([id, def]) => (
                              <button
                                key={id}
                                className={styles.shapeBtn}
                                title={def.label}
                                onClick={() => addShape(id)}
                              >
                                <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="none">
                                  <path
                                    d={def.path}
                                    fill="var(--color-accent)"
                                    stroke="none"
                                  />
                                </svg>
                              </button>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <textarea
                    className={styles.notesArea}
                    placeholder="Add speaker notes for this slide…"
                    spellCheck={spellCheck}
                    value={currentSlide?.notes ?? ''}
                    onChange={(e) => updateCurrentSlide((s) => ({ ...s, notes: e.target.value }))}
                  />
                )}
              </div>

              {/* Vertical tab strip – right side */}
              <div className={styles.rightPanelTabStrip}>
                <button
                  className={`${styles.rightPanelTab} ${rightPanelTab === 'layout' ? styles.rightPanelTabActive : ''}`}
                  onClick={() => setRightPanelTab('layout')}
                  title="Layout"
                >
                  <span className={styles.rightPanelTabLabel}>Layout</span>
                </button>
                <button
                  className={`${styles.rightPanelTab} ${rightPanelTab === 'theme' ? styles.rightPanelTabActive : ''}`}
                  onClick={() => setRightPanelTab('theme')}
                  title="Theme"
                >
                  <span className={styles.rightPanelTabLabel}>Theme</span>
                </button>
                <button
                  className={`${styles.rightPanelTab} ${rightPanelTab === 'shapes' ? styles.rightPanelTabActive : ''}`}
                  onClick={() => setRightPanelTab('shapes')}
                  title="Shapes"
                >
                  <span className={styles.rightPanelTabLabel}>Shapes</span>
                </button>
                <button
                  className={`${styles.rightPanelTab} ${rightPanelTab === 'notes' ? styles.rightPanelTabActive : ''}`}
                  onClick={() => setRightPanelTab('notes')}
                  title="Notes"
                >
                  <span className={styles.rightPanelTabLabel}>Notes</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {sheetPasteDialogState && (
        <PasteChoiceDialog
          previewData={sheetPasteDialogState.previewData}
          onPasteAsTable={sheetPasteDialogState.onPasteAsTable}
          onPasteAsEmbed={sheetPasteDialogState.onPasteAsEmbed}
          onClose={sheetPasteDialogState.onClose}
        />
      )}
    </div>
  );
}
