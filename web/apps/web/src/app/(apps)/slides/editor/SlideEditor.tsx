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
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Minus,
  ChevronUp,
  LayoutTemplate,
  Zap,
  Upload,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ArrowUpToLine,
  ArrowDownToLine,
  ZoomIn,
  Layers,
  Sun,
  RotateCcw,
  Box,
  Images,
  Grid,
  ChevronsRight,
  Eraser,
  Video,
  Table2,
  ImageIcon,
  List,
  ListOrdered,
  ArrowUpDown,
  Network,
} from 'lucide-react';
import {
  Button,
  Toolbar as RichTextToolbar,
  ToolbarGroup,
  ToolbarDivider,
  ToolbarButton,
  ToolbarSelect,
  ColorPickerPopover,
  ZoomSlider,
  ShareButton,
  useToast,
} from '@neutrino/ui';
import { useUser } from '@neutrino/auth';
import {
  slidesApi, driveReadContent, driveAutosaveEncryptedContent,
  driveAutosaveBytes,
  storageApi, filesystemApi, ApiClientError, type FileItem,
} from '@/lib/api';
import { OFFICE_MIME, officeAppForFile } from '@/lib/officeFormats';
import { getOfficeFileMode, isOneShotPromoteRequested } from '@/hooks/useOfficeFileMode';
import { ShareDialog } from '@/app/(apps)/drive/ShareDialog';
import { useSlidePresence } from '@/hooks/useSlidePresence';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { decryptFile } from '@neutrino/e2e-crypto';
import { ENCRYPTION_WARNING_MESSAGE } from '@/components/EncryptionWarningMessage';
import type { SlideTheme } from '@neutrino/api-slides';
import { FONT_FAMILY_NAMES as FONT_FAMILIES } from '@/constants/editor';
import { useSpellCheck } from '@/hooks/useSpellCheck';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import { useSheetPasteInterceptor, PasteChoiceDialog } from '@neutrino/sheet-embed';
import type { SheetEmbedAttrsShape, CellValue } from '@neutrino/sheet-embed';
import { InsertSheetDialog } from './InsertSheetDialog';
import { InsertImageDialog } from './InsertImageDialog';
import { InsertDiagramDialog } from './InsertDiagramDialog';

// ── Domain modules ────────────────────────────────────────────────────────────
import type {
  TextStyle,
  ElementAnimation,
  TextElement,
  ShapeElement,
  LineElement,
  VideoElement,
  ImageElement,
  DiagramElement,
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
  LINE_CATALOG,
  SLIDE_LAYOUTS,
  makeDefaultPresentation,
  makeDefaultMaster,
  uid,
} from './slideEditorConstants';
import { slideBackgroundStyle, dbThemeToTheme, getVideoEmbedInfo } from './slideEditorHelpers';
import { exportAsPptx, exportAsPptxBytes } from './pptxExport';
import FillPicker from './FillPicker';
import SlideCanvas from './SlideCanvas';
import SlideThumbnail from './SlideThumbnail';
import PresenterView from './PresenterView';
import { LayoutPreview, ThemePreview } from './slideEditorPreviews';
import styles from './page.module.css';
import { useAccessRevocation } from '@/hooks/useAccessRevocation';

// ── Constants ─────────────────────────────────────────────────────────────────

const FONT_SIZES = ['8', '10', '12', '14', '16', '18', '20', '24', '28', '32', '36', '40', '48', '60', '72', '96'];

// ── Re-exports ────────────────────────────────────────────────────────────────
export type { TextStyle, ElementAnimation, TextElement, ShapeElement, VideoElement, ImageElement, SheetEmbedElement, DiagramElement, SlideElement, SlideBackground, Slide, Theme, SlideMaster, SlidePresentation } from './slideEditorTypes';
// importFromPptx is intentionally NOT re-exported here so that pptxImport (and
// its jszip dependency) stays out of the initial bundle. Callers that need it
// should use: const { importFromPptx } = await import('./pptxImport')

// ── Line spacing menu ─────────────────────────────────────────────────────────

const LINE_SPACING_PRESETS = [
  { value: 1, label: 'Single' },
  { value: 1.15, label: '1.15' },
  { value: 1.5, label: '1.5' },
  { value: 2, label: 'Double' },
];

function LineSpacingMenu({
  lineHeight,
  spaceBefore,
  spaceAfter,
  fontSize,
  onChangeLineHeight,
  onChangeSpaceBefore,
  onChangeSpaceAfter,
}: {
  lineHeight: number | undefined;
  spaceBefore: number | undefined;
  spaceAfter: number | undefined;
  fontSize: number;
  onChangeLineHeight: (lh: number) => void;
  onChangeSpaceBefore: (pt: number) => void;
  onChangeSpaceAfter: (pt: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const currentLH = lineHeight ?? 1.15;
  const spaceAmount = Math.round(fontSize);
  const hasSpaceBefore = (spaceBefore ?? 0) > 0;
  const hasSpaceAfter = (spaceAfter ?? 0) > 0;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <ToolbarButton active={open} onClick={() => setOpen((v) => !v)} title="Line & paragraph spacing">
        <ArrowUpDown size={15} />
      </ToolbarButton>
      {open && (
        <div className={styles.lineSpacingDropdown}>
          {LINE_SPACING_PRESETS.map((p) => (
            <button
              key={p.value}
              className={styles.lineSpacingItem}
              onClick={() => { onChangeLineHeight(p.value); setOpen(false); }}
            >
              <span className={styles.lineSpacingCheck}>
                {Math.abs(currentLH - p.value) < 0.01 ? '✓' : ''}
              </span>
              {p.label}
            </button>
          ))}
          <div className={styles.lineSpacingDivider} />
          <button
            className={styles.lineSpacingItem}
            onClick={() => { onChangeSpaceBefore(hasSpaceBefore ? 0 : spaceAmount); setOpen(false); }}
          >
            <span className={styles.lineSpacingCheck} />
            {hasSpaceBefore ? 'Remove space before paragraph' : 'Add space before paragraph'}
          </button>
          <button
            className={styles.lineSpacingItem}
            onClick={() => { onChangeSpaceAfter(hasSpaceAfter ? 0 : spaceAmount); setOpen(false); }}
          >
            <span className={styles.lineSpacingCheck} />
            {hasSpaceAfter ? 'Remove space after paragraph' : 'Add space after paragraph'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Save status ──────────────────────────────────────────────────────────────

type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

// ── Line SVG preview (insert panel) ──────────────────────────────────────────

function LineSvgPreview({ lineType }: { lineType: string }) {
  const color = 'currentColor';
  const sw = 1.5;
  switch (lineType) {
    case 'arrow-left':
      return (
        <svg viewBox="0 0 28 12" width="28" height="12" style={{ flexShrink: 0 }}>
          <line x1="8" y1="6" x2="26" y2="6" stroke={color} strokeWidth={sw} strokeLinecap="round" />
          <polygon points="11 2, 2 6, 11 10" fill={color} />
        </svg>
      );
    case 'arrow':
      return (
        <svg viewBox="0 0 28 12" width="28" height="12" style={{ flexShrink: 0 }}>
          <line x1="2" y1="6" x2="20" y2="6" stroke={color} strokeWidth={sw} strokeLinecap="round" />
          <polygon points="17 2, 26 6, 17 10" fill={color} />
        </svg>
      );
    case 'double-arrow':
      return (
        <svg viewBox="0 0 28 12" width="28" height="12" style={{ flexShrink: 0 }}>
          <line x1="8" y1="6" x2="20" y2="6" stroke={color} strokeWidth={sw} strokeLinecap="round" />
          <polygon points="11 2, 2 6, 11 10" fill={color} />
          <polygon points="17 2, 26 6, 17 10" fill={color} />
        </svg>
      );
    case 'dashed':
      return (
        <svg viewBox="0 0 28 12" width="28" height="12" style={{ flexShrink: 0 }}>
          <line x1="2" y1="6" x2="26" y2="6" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray="4 3" />
        </svg>
      );
    case 'dashed-arrow':
      return (
        <svg viewBox="0 0 28 12" width="28" height="12" style={{ flexShrink: 0 }}>
          <line x1="2" y1="6" x2="20" y2="6" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray="4 3" />
          <polygon points="17 2, 26 6, 17 10" fill={color} />
        </svg>
      );
    default: // straight
      return (
        <svg viewBox="0 0 28 12" width="28" height="12" style={{ flexShrink: 0 }}>
          <line x1="2" y1="6" x2="26" y2="6" stroke={color} strokeWidth={sw} strokeLinecap="round" />
        </svg>
      );
  }
}

// ── Lines toolbar dropdown ────────────────────────────────────────────────────

const TOOLBAR_LINE_TYPES = [
  { id: 'straight',     label: 'Line' },
  { id: 'arrow-left',   label: 'Left Arrow' },
  { id: 'arrow',        label: 'Right Arrow' },
  { id: 'double-arrow', label: 'Double Arrow' },
] as const;

function LinesToolbarDropdown({ onAdd }: { onAdd: (lineType: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <ToolbarButton active={open} onClick={() => setOpen((v) => !v)} title="Insert line">
        <Minus size={14} />
        <ChevronDown size={10} style={{ marginLeft: 1 }} />
      </ToolbarButton>
      {open && (
        <div className={styles.lineSpacingDropdown}>
          {TOOLBAR_LINE_TYPES.map((lt) => (
            <button
              key={lt.id}
              className={styles.lineSpacingItem}
              onClick={() => { onAdd(lt.id); setOpen(false); }}
            >
              <LineSvgPreview lineType={lt.id} />
              <span style={{ marginLeft: '0.5em' }}>{lt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function SlideEditor() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const flags = useFeatureFlags();
  const slideId = searchParams.get('id') ?? '';
  useAccessRevocation(slideId);
  const { spellCheck } = useSpellCheck();
  const currentUser = useUser();
  const [authToken, setAuthToken] = useState<string | null>(null);
  useEffect(() => {
    setAuthToken(localStorage.getItem('access_token'));
  }, []);

  const { dekRef, dekResolved, isNewEncryption } =
    useEncryptedDocumentContent({ id: slideId, filename: 'slide.json' });
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [presentation, setPresentation] = useState<SlidePresentation>(makeDefaultPresentation);
  const [selectedSlideIdx, setSelectedSlideIdx] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [editingInitialText, setEditingInitialText] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [presenterMode, setPresenterMode] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [masterMode, setMasterMode] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'layout' | 'theme' | 'insert'>('layout');
  const [zoom, setZoom] = useState(100);

  const [showShareDialog, setShowShareDialog] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [sheetDialogOpen, setSheetDialogOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [diagramDialogOpen, setDiagramDialogOpen] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef('');
  const exportRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const dragSrcIdx = useRef<number | null>(null);
  const initialSaveDoneRef = useRef(false);
  // Forward-ref to the promote mutation trigger (issue #43) — set once
  // promoteMutation is defined below; read from the office-mode load effect,
  // which runs before that definition point.
  const promoteMutationRef = useRef<() => void>(() => {});
  // Office mode (issue #43) — declared here (before useSlidePresence, which
  // needs it to skip presence for office-mode files) since `officeMode`
  // itself isn't known until the getSlide query settles, later in this
  // component. Synced by an effect below.
  const officeModeRef = useRef(false);

  const onRemotePresentationRef = useRef<((p: unknown) => void) | null>(null);
  onRemotePresentationRef.current = (incoming: unknown) => {
    try {
      const parsed = incoming as SlidePresentation;
      if (!parsed?.slides?.length) return;
      setPresentation(parsed);
    } catch {
      // ignore malformed remote presentation updates
    }
  };

  const { remoteUsers, broadcastPresentation } = useSlidePresence({
    slideId,
    userName: currentUser?.name ?? 'Anonymous',
    authToken,
    // Office-mode files have no `slides` row / collab room — presence is out
    // of scope for them (plan section 4). officeModeRef lags one render at
    // most (office mode isn't known until later in this component).
    enabled: !!slideId && !officeModeRef.current,
    selectedSlideIndex: selectedSlideIdx,
    onRemotePresentationRef,
  });

  const { isLoading: metaLoading, isError: metaIsError, error: metaError, data: slideData } = useQuery({
    queryKey: ['slide', slideId],
    queryFn: () => slidesApi.getSlide(slideId),
    enabled: !!slideId,
    staleTime: 30_000,
  });

  // ── Office mode (issue #43) ────────────────────────────────────────────────
  // A raw .pptx Drive file has no `slides` row, so slidesApi.getSlide 404s.
  // Fall back to the generic Drive file metadata to distinguish "raw pptx,
  // open it in place" from a genuinely deleted/missing presentation.
  const slide404 = flags.officeInPlaceEditing && metaIsError
    && metaError instanceof ApiClientError && metaError.statusCode === 404;

  const {
    data: officeFileMeta,
    isLoading: officeFallbackLoading,
    isError: officeFallbackIsError,
  } = useQuery({
    queryKey: ['slide-office-fallback', slideId],
    queryFn: () => storageApi.getFileMetadata(slideId),
    enabled: slide404,
    staleTime: 0,
    retry: false,
  });

  const officeApp = officeFileMeta ? officeAppForFile(officeFileMeta.mimeType, officeFileMeta.name) : null;
  const officeMode = slide404 && officeApp === 'slides';
  const slideNotFound = slide404 && (officeFallbackIsError || (!!officeFileMeta && officeApp !== 'slides'));

  useEffect(() => { officeModeRef.current = officeMode; }, [officeMode]);
  const officeFileMetaRef = useRef<FileItem | null>(null);
  useEffect(() => { officeFileMetaRef.current = officeFileMeta ?? null; }, [officeFileMeta]);
  const presentationRef = useRef<SlidePresentation>(presentation);
  presentationRef.current = presentation;

  const { isLoading: contentLoading, data: slideContent } = useQuery({
    queryKey: ['slide-content', slideId, dekResolved],
    queryFn: async () => {
      if (!slideData?.contentUrl) return null;
      if (dekRef.current) {
        const blob = await storageApi.downloadFile(slideId);
        const cipherBytes = new Uint8Array(await blob.arrayBuffer());
        try {
          const plainBytes = decryptFile(cipherBytes, dekRef.current);
          return new TextDecoder().decode(plainBytes);
        } catch {
          if (isNewEncryption) return null;
          return driveReadContent(slideData.contentUrl);
        }
      }
      return driveReadContent(slideData.contentUrl);
    },
    enabled: !!slideData?.contentUrl && dekResolved,
    staleTime: 30_000,
    retry: 0,
  });

  const { data: dbThemesData } = useQuery({
    queryKey: ['slide-themes'],
    queryFn: () => slidesApi.listThemes(),
    staleTime: 60_000,
  });

  const isLoading = metaLoading || contentLoading || (slide404 && officeFallbackLoading);

  useEffect(() => {
    if (!slideData) return;
    setTitle(slideData.title);
  }, [slideData]);

  // ── Office mode: title + content load (issue #43) ───────────────────────
  useEffect(() => {
    if (officeMode && officeFileMeta) setTitle(officeFileMeta.name);
  }, [officeMode, officeFileMeta]);

  const officeContentLoadStartedRef = useRef(false);
  useEffect(() => {
    if (!officeMode || !officeFileMeta || officeContentLoadStartedRef.current) return;
    officeContentLoadStartedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const blob = await storageApi.downloadFile(slideId);
        if (cancelled) return;
        const file = new File([blob], officeFileMeta.name, { type: officeFileMeta.mimeType });
        const { importFromPptx } = await import('./pptxImport');
        if (cancelled) return;
        const imported = await importFromPptx(file);
        if (cancelled) return;
        setPresentation(imported);
        lastSavedRef.current = JSON.stringify(imported);
        // Convert-on-open (global setting) or a one-shot promote request from
        // the Drive context menu's "Convert to Neutrino Slide" action:
        // silently promote right after the initial client-side import
        // renders. Non-blocking.
        if (getOfficeFileMode() === 'convert-on-open' || isOneShotPromoteRequested()) {
          promoteMutationRef.current();
        }
      } catch {
        if (!cancelled) toast.error('Failed to open this file for editing');
      }
    })();
    return () => { cancelled = true; };
  // toast is intentionally omitted — a fresh identity on every render would
  // otherwise cancel this one-shot load via the cleanup function above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeMode, officeFileMeta, slideId]);

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

  // After DEK resolves and the content query settles, do a one-time encrypted autosave
  // when this is a new encryption (no prior key on the server) and no content loaded.
  // Guard on isNewEncryption: never overwrite when the DEK came from the server,
  // because null/undefined content there means decryption failed on existing data.
  useEffect(() => {
    if (!dekRef.current || !slideData || contentLoading) return;
    if (!isNewEncryption) return;
    if (initialSaveDoneRef.current || lastSavedRef.current !== '') return;
    initialSaveDoneRef.current = true;
    const content = JSON.stringify(presentation);
    driveAutosaveEncryptedContent(slideData.id, content, 'slide.json', dekRef.current).catch(() => {});
  // dekRef is a stable ref; use dekResolved (state) as the reactive signal.
  // presentation intentionally omitted: we capture the default once, not on every change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dekResolved, isNewEncryption, slideData, contentLoading, slideContent]);

  const contentMutation = useMutation({
    mutationFn: async ({ content }: { content: string }) => {
      // Office mode (issue #43): re-serialize the current presentation into
      // real PPTX bytes and write them to the SAME Drive file id via the
      // binary-safe transport, instead of the native JSON autosave path.
      if (officeModeRef.current) {
        const meta = officeFileMetaRef.current;
        if (!meta) throw new Error('office-meta-missing');
        const bytes = await exportAsPptxBytes(presentationRef.current);
        // Office-mode files stay real, uncorrupted OOXML at rest (acceptance
        // criterion 3 — downloading the raw file must open in real
        // PowerPoint), so these never go through the E2EE-encrypted transport
        // even when a DEK is available for this file id.
        await driveAutosaveBytes(slideId, bytes, meta.name, OFFICE_MIME.pptx);
        return;
      }
      if (!dekRef.current) throw new Error('no-dek');
      return driveAutosaveEncryptedContent(slideData!.id, content, 'slide.json', dekRef.current);
    },
    onMutate: () => setSaveStatus('saving'),
    onSuccess: (_, { content }) => {
      setSaveStatus('saved');
      lastSavedRef.current = content;
      queryClient.invalidateQueries({ queryKey: ['slides'] });
    },
    onError: (err) => {
      setSaveStatus('error');
      if (err instanceof Error && err.message === 'no-dek') {
        toast.warning(ENCRYPTION_WARNING_MESSAGE);
      }
    },
  });

  const titleMutation = useMutation({
    mutationFn: async ({ title: t }: { title: string }): Promise<void> => {
      // Office mode: no `slides` row to PATCH — rename through the generic
      // Drive rename call (same one FileContextMenu's rename action uses).
      if (officeModeRef.current) {
        await filesystemApi.updateFile(slideId, { name: t });
        return;
      }
      await slidesApi.saveSlide(slideData!.id, { title: t });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['slides'] }),
  });

  // "Convert to Neutrino Slide" — one-shot promote of the raw office file
  // into a native slide deck, keeping the same Drive file id.
  const promoteMutation = useMutation({
    mutationFn: async () => {
      const content = JSON.stringify(presentationRef.current);
      return slidesApi.promoteSlide(slideId, content);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slide', slideId] });
      queryClient.invalidateQueries({ queryKey: ['slide-content', slideId] });
      queryClient.invalidateQueries({ queryKey: ['contents'] });
      queryClient.invalidateQueries({ queryKey: ['slides'] });
      toast.success('Converted to a native Neutrino slide deck');
    },
    onError: () => toast.error('Failed to convert to a native Neutrino slide deck'),
  });
  useEffect(() => {
    promoteMutationRef.current = () => { promoteMutation.mutate(); };
  }, [promoteMutation]);
  const handleConvertToNative = useCallback(() => {
    promoteMutation.mutate();
  }, [promoteMutation]);

  const scheduleAutoSave = useCallback((pres: SlidePresentation) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('unsaved');
    saveTimerRef.current = setTimeout(() => {
      const content = JSON.stringify(pres);
      contentMutation.mutate({ content });
    }, 2000);
  }, [contentMutation]);

  function updatePresentation(updater: (p: SlidePresentation) => SlidePresentation) {
    setPresentation((prev) => {
      const next = updater(prev);
      scheduleAutoSave(next);
      broadcastPresentation(next);
      return next;
    });
  }

  async function handleBack() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const content = JSON.stringify(presentation);
    if (content !== lastSavedRef.current) {
      await contentMutation.mutateAsync({ content });
    }
    queryClient.invalidateQueries({ queryKey: ['slides'] });
    router.push('/drive');
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setTitle(val);
    if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
    titleSaveTimerRef.current = setTimeout(() => {
      const trimmed = val.trim();
      if (!trimmed) return;
      titleMutation.mutate({ title: trimmed });
      const content = JSON.stringify(presentation);
      contentMutation.mutate({ content });
    }, 2000);
  }

  function handleTitleBlur() {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (titleSaveTimerRef.current) {
      clearTimeout(titleSaveTimerRef.current);
      titleSaveTimerRef.current = null;
    }
    titleMutation.mutate({ title: trimmed });
    const content = JSON.stringify(presentation);
    contentMutation.mutate({ content });
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
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (titleSaveTimerRef.current) clearTimeout(titleSaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!selectedElementId || editingElementId) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteElement(selectedElementId);
        return;
      }

      const slide = presentation.slides[selectedSlideIdx] ?? presentation.slides[0];
      const selectedEl = slide?.elements.find((el) => el.id === selectedElementId);
      if (selectedEl?.type === 'text' && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setEditingInitialText(e.key);
        setEditingElementId(selectedElementId);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedElementId, editingElementId, presentation, selectedSlideIdx]);

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
    setRightPanelTab('layout');
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
      stroke: '#000000',
      strokeWidth: 1,
      strokeDash: '',
    };
    updateCurrentSlide((s) => ({ ...s, elements: [...s.elements, el] }));
    setSelectedElementId(el.id);
  }

  function addLine(lineType: string) {
    const def = LINE_CATALOG[lineType];
    if (!def) return;
    const el: LineElement = {
      id: uid(), type: 'line',
      x1: 20, y1: 50, x2: 80, y2: 50,
      stroke: '#1f2937', strokeWidth: 2,
      ...(def.strokeDash   ? { strokeDash:  def.strokeDash  } : {}),
      ...(def.startArrow   ? { startArrow:  def.startArrow  } : {}),
      ...(def.endArrow     ? { endArrow:    def.endArrow    } : {}),
    };
    updateCurrentSlide((s) => ({ ...s, elements: [...s.elements, el] }));
    setSelectedElementId(el.id);
  }

  function handleInsertDrop(kind: string, shape: string | null, pctX: number, pctY: number) {
    if (kind === 'text') {
      const w = 60, h = 15;
      const el: TextElement = {
        id: uid(),
        type: 'text',
        x: Math.max(0, Math.min(100 - w, pctX - w / 2)),
        y: Math.max(0, Math.min(100 - h, pctY - h / 2)),
        w, h,
        content: 'New text box',
        style: { fontSize: 24, bold: false, italic: false, underline: false, color: presentation.theme.textColor, align: 'left', fontFamily: 'Inter' },
      };
      updateCurrentSlide((s) => ({ ...s, elements: [...s.elements, el] }));
      setSelectedElementId(el.id);
    } else if (kind === 'shape' && shape) {
      const w = 40, h = 25;
      const el: ShapeElement = {
        id: uid(),
        type: 'shape',
        shape,
        x: Math.max(0, Math.min(100 - w, pctX - w / 2)),
        y: Math.max(0, Math.min(100 - h, pctY - h / 2)),
        w, h,
        fill: presentation.theme.primaryColor,
        stroke: '#000000',
        strokeWidth: 1,
        strokeDash: '',
      };
      updateCurrentSlide((s) => ({ ...s, elements: [...s.elements, el] }));
      setSelectedElementId(el.id);
    } else if (kind === 'line' && shape) {
      const def = LINE_CATALOG[shape];
      if (!def) return;
      const halfLen = 15;
      const el: LineElement = {
        id: uid(), type: 'line',
        x1: Math.max(0, pctX - halfLen), y1: pctY,
        x2: Math.min(100, pctX + halfLen), y2: pctY,
        stroke: '#1f2937', strokeWidth: 2,
        ...(def.strokeDash ? { strokeDash: def.strokeDash } : {}),
        ...(def.startArrow ? { startArrow: def.startArrow } : {}),
        ...(def.endArrow   ? { endArrow:   def.endArrow   } : {}),
      };
      updateCurrentSlide((s) => ({ ...s, elements: [...s.elements, el] }));
      setSelectedElementId(el.id);
    }
  }

  // ── Video embed operations ────────────────────────────────────────────────

  function addVideo(url: string) {
    const { isPortrait } = getVideoEmbedInfo(url);
    // On a 16:9 slide: landscape (16:9) → h% = w%; portrait (9:16) → h% = w% × 256/81.
    // Shorts default: w=25 → h≈79, centered horizontally.
    const defaults = isPortrait
      ? { x: 37.5, y: 10, w: 25, h: Math.round(25 * 256 / 81) }
      : { x: 10, y: 10, w: 80, h: 80 };
    const el: VideoElement = {
      id: uid(),
      type: 'video',
      ...defaults,
      url,
      autoplay: false,
      loop: false,
      muted: false,
    };
    updateCurrentSlide((s) => ({ ...s, elements: [...s.elements, el] }));
    setSelectedElementId(el.id);
  }

  // ── Image operations ──────────────────────────────────────────────────────

  function addImage(src: string, driveFileId?: string) {
    const el: ImageElement = {
      id: uid(),
      type: 'image',
      x: 10, y: 10, w: 80, h: 70,
      src,
      driveFileId,
      opacity: 1,
      tintStrength: 0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      warmth: 0,
      objectFit: 'cover',
    };
    updateCurrentSlide((s) => ({ ...s, elements: [...s.elements, el] }));
    setSelectedElementId(el.id);
  }

  // ── Diagram embed operations ──────────────────────────────────────────────

  function addDiagram(diagramId: string) {
    const el: DiagramElement = {
      id: uid(),
      type: 'diagram',
      x: 10, y: 10, w: 80, h: 60,
      diagramId,
      pageIndex: 0,
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
    if (!flags.sheetLiveEmbed) return;
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

  function bringElementToFront() {
    if (!selectedElementId) return;
    updateCurrentSlide((s) => {
      const idx = s.elements.findIndex((e) => e.id === selectedElementId);
      if (idx < 0 || idx === s.elements.length - 1) return s;
      const els = [...s.elements];
      const [el] = els.splice(idx, 1);
      els.push(el);
      return { ...s, elements: els };
    });
  }

  function sendElementToBack() {
    if (!selectedElementId) return;
    updateCurrentSlide((s) => {
      const idx = s.elements.findIndex((e) => e.id === selectedElementId);
      if (idx <= 0) return s;
      const els = [...s.elements];
      const [el] = els.splice(idx, 1);
      els.unshift(el);
      return { ...s, elements: els };
    });
  }

  function moveElementForward() {
    if (!selectedElementId) return;
    updateCurrentSlide((s) => {
      const idx = s.elements.findIndex((e) => e.id === selectedElementId);
      if (idx < 0 || idx >= s.elements.length - 1) return s;
      const els = [...s.elements];
      [els[idx], els[idx + 1]] = [els[idx + 1], els[idx]];
      return { ...s, elements: els };
    });
  }

  function moveElementBackward() {
    if (!selectedElementId) return;
    updateCurrentSlide((s) => {
      const idx = s.elements.findIndex((e) => e.id === selectedElementId);
      if (idx <= 0) return s;
      const els = [...s.elements];
      [els[idx], els[idx - 1]] = [els[idx - 1], els[idx]];
      return { ...s, elements: els };
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
  const selectedElementIndex = selectedElement
    ? (currentSlide?.elements.findIndex((e) => e.id === selectedElementId) ?? -1)
    : -1;
  const elementCount = currentSlide?.elements.length ?? 0;

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

  if (slideNotFound) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Presentation not found</p>
        <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => router.push('/drive')}>
          Back to Drive
        </Button>
      </div>
    );
  }

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
        <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={handleBack} className={styles.backBtn}>
          Slides
        </Button>

        <div className={styles.titleArea}>
          <Presentation size={18} color="var(--color-rose, #e11d48)" />
          <input
            className={styles.titleInput}
            value={title}
            onChange={handleTitleChange}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            placeholder="Untitled presentation"
          />
        </div>

        <span className={`${styles.saveStatus} ${saveStatusClass}`}>{saveStatusText}</span>

        <div className={styles.actions}>
          {officeMode && (
            <Button variant="secondary" onClick={handleConvertToNative} title="Convert to Neutrino Slide">
              Convert to Neutrino Slide
            </Button>
          )}
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

          <ShareButton users={remoteUsers} onShare={() => setShowShareDialog(true)} />

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
      <RichTextToolbar>
        <LinesToolbarDropdown onAdd={addLine} />
        <ToolbarDivider />

        {/* Video controls */}
        {selectedElement?.type === 'video' && (
          <>
            <ToolbarDivider />
            <ToolbarGroup>
              <label className={styles.toolbarLabel} title="Autoplay">
                <input
                  type="checkbox"
                  checked={(selectedElement as VideoElement).autoplay}
                  onChange={(e) => updateElement(selectedElement.id, (el) => ({ ...el, autoplay: e.target.checked } as VideoElement))}
                />
                Autoplay
              </label>
              <label className={styles.toolbarLabel} title="Loop">
                <input
                  type="checkbox"
                  checked={(selectedElement as VideoElement).loop}
                  onChange={(e) => updateElement(selectedElement.id, (el) => ({ ...el, loop: e.target.checked } as VideoElement))}
                />
                Loop
              </label>
              <label className={styles.toolbarLabel} title="Muted">
                <input
                  type="checkbox"
                  checked={(selectedElement as VideoElement).muted}
                  onChange={(e) => updateElement(selectedElement.id, (el) => ({ ...el, muted: e.target.checked } as VideoElement))}
                />
                Muted
              </label>
              <span className={styles.toolbarLabel} title="Start time in seconds">
                Start
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={(selectedElement as VideoElement).startSeconds ?? 0}
                  onChange={(e) => updateElement(selectedElement.id, (el) => ({ ...el, startSeconds: parseInt(e.target.value) || 0 } as VideoElement))}
                  className={styles.toolbarNumberInput}
                  title="Start time (seconds)"
                />
                s
              </span>
              <ToolbarButton onClick={() => deleteElement(selectedElement.id)} title="Delete video">
                <Trash2 size={15} />
              </ToolbarButton>
            </ToolbarGroup>
          </>
        )}

        {/* Text formatting controls — mirrors the Docs toolbar */}
        {selectedElement?.type === 'text' && (
          <>
            <ToolbarDivider />

            {/* Font family */}
            <ToolbarSelect
              value={(selectedElement as TextElement).style.fontFamily}
              onChange={(e) => updateTextStyle(selectedElement.id, { fontFamily: e.target.value })}
              title="Font family"
              style={{ width: 120 }}
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </ToolbarSelect>

            {/* Font size */}
            <ToolbarSelect
              style={{ width: 56 }}
              title="Font size"
              value={String((selectedElement as TextElement).style.fontSize)}
              onChange={(e) => updateTextStyle(selectedElement.id, { fontSize: parseInt(e.target.value) || 24 })}
            >
              {FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </ToolbarSelect>

            <ToolbarDivider />

            {/* Bold / italic / underline / strikethrough */}
            <ToolbarGroup>
              <ToolbarButton
                active={(selectedElement as TextElement).style.bold}
                onClick={() => updateTextStyle(selectedElement.id, { bold: !(selectedElement as TextElement).style.bold })}
                title="Bold (B)"
                style={{ fontWeight: 700 }}
              >
                B
              </ToolbarButton>
              <ToolbarButton
                active={(selectedElement as TextElement).style.italic}
                onClick={() => updateTextStyle(selectedElement.id, { italic: !(selectedElement as TextElement).style.italic })}
                title="Italic (I)"
                style={{ fontStyle: 'italic' }}
              >
                I
              </ToolbarButton>
              <ToolbarButton
                active={(selectedElement as TextElement).style.underline}
                onClick={() => updateTextStyle(selectedElement.id, { underline: !(selectedElement as TextElement).style.underline })}
                title="Underline (U)"
                style={{ textDecoration: 'underline' }}
              >
                U
              </ToolbarButton>
              <ToolbarButton
                active={(selectedElement as TextElement).style.strikethrough ?? false}
                onClick={() => updateTextStyle(selectedElement.id, { strikethrough: !((selectedElement as TextElement).style.strikethrough ?? false) })}
                title="Strikethrough"
                style={{ textDecoration: 'line-through' }}
              >
                S
              </ToolbarButton>
            </ToolbarGroup>

            <ToolbarDivider />

            {/* Text color + background color */}
            <ToolbarGroup>
              <ColorPickerPopover
                color={(selectedElement as TextElement).style.color ?? '#202124'}
                onChange={(hex) => updateTextStyle(selectedElement.id, { color: hex })}
                title="Text color"
                showAlpha={flags.colorPickerAlpha}
              >
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>A</span>
                  <span style={{ display: 'block', width: 14, height: 3, borderRadius: 2, backgroundColor: (selectedElement as TextElement).style.color ?? '#202124' }} />
                </span>
              </ColorPickerPopover>
              <ColorPickerPopover
                color={(selectedElement as TextElement).style.backgroundColor ?? '#fef08a'}
                onChange={(hex) => updateTextStyle(selectedElement.id, { backgroundColor: hex })}
                title="Text background color"
                showAlpha={flags.colorPickerAlpha}
              >
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1 }}>
                  <span style={{ fontSize: 12 }}>&#9632;</span>
                  <span style={{ display: 'block', width: 14, height: 3, borderRadius: 2, backgroundColor: (selectedElement as TextElement).style.backgroundColor ?? '#fef08a' }} />
                </span>
              </ColorPickerPopover>
            </ToolbarGroup>

            <ToolbarDivider />

            {/* Shadow */}
            <ToolbarGroup>
              <ToolbarButton
                active={(selectedElement as TextElement).style.shadow ?? false}
                onClick={() => updateTextStyle(selectedElement.id, { shadow: !((selectedElement as TextElement).style.shadow ?? false) })}
                title="Text shadow"
              >
                <span style={{ fontWeight: 700, fontSize: 13, textShadow: '1px 1px 2px rgba(0,0,0,0.6)' }}>S</span>
              </ToolbarButton>
              {(selectedElement as TextElement).style.shadow && (
                <ColorPickerPopover
                  color={(selectedElement as TextElement).style.shadowColor ?? 'rgba(0,0,0,0.5)'}
                  onChange={(hex) => updateTextStyle(selectedElement.id, { shadowColor: hex })}
                  title="Shadow color"
                  showAlpha={flags.colorPickerAlpha}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1 }}>
                    <span style={{ fontSize: 11, textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>A</span>
                    <span style={{ display: 'block', width: 14, height: 3, borderRadius: 2, backgroundColor: (selectedElement as TextElement).style.shadowColor ?? 'rgba(0,0,0,0.5)' }} />
                  </span>
                </ColorPickerPopover>
              )}
            </ToolbarGroup>

            <ToolbarDivider />

            {/* Alignment */}
            <ToolbarGroup>
              <ToolbarButton
                active={(selectedElement as TextElement).style.align === 'left'}
                onClick={() => updateTextStyle(selectedElement.id, { align: 'left' })}
                title="Align left"
              >
                <AlignLeft size={15} />
              </ToolbarButton>
              <ToolbarButton
                active={(selectedElement as TextElement).style.align === 'center'}
                onClick={() => updateTextStyle(selectedElement.id, { align: 'center' })}
                title="Align center"
              >
                <AlignCenter size={15} />
              </ToolbarButton>
              <ToolbarButton
                active={(selectedElement as TextElement).style.align === 'right'}
                onClick={() => updateTextStyle(selectedElement.id, { align: 'right' })}
                title="Align right"
              >
                <AlignRight size={15} />
              </ToolbarButton>
              <ToolbarButton
                active={(selectedElement as TextElement).style.align === 'justify'}
                onClick={() => updateTextStyle(selectedElement.id, { align: 'justify' })}
                title="Justify"
              >
                <AlignJustify size={15} />
              </ToolbarButton>
            </ToolbarGroup>

            <ToolbarDivider />

            {/* Line & paragraph spacing */}
            <LineSpacingMenu
              lineHeight={(selectedElement as TextElement).style.lineHeight}
              spaceBefore={(selectedElement as TextElement).style.spaceBefore}
              spaceAfter={(selectedElement as TextElement).style.spaceAfter}
              fontSize={(selectedElement as TextElement).style.fontSize}
              onChangeLineHeight={(lh) => updateTextStyle(selectedElement.id, { lineHeight: lh })}
              onChangeSpaceBefore={(pt) => updateTextStyle(selectedElement.id, { spaceBefore: pt })}
              onChangeSpaceAfter={(pt) => updateTextStyle(selectedElement.id, { spaceAfter: pt })}
            />

            {/* List type */}
            <ToolbarGroup>
              <ToolbarButton
                active={(selectedElement as TextElement).style.listType === 'bullet'}
                onClick={() => {
                  const t = selectedElement as TextElement;
                  updateTextStyle(t.id, { listType: t.style.listType === 'bullet' ? 'none' : 'bullet' });
                }}
                title="Bullet list"
              >
                <List size={15} />
              </ToolbarButton>
              <ToolbarButton
                active={(selectedElement as TextElement).style.listType === 'numbered'}
                onClick={() => {
                  const t = selectedElement as TextElement;
                  updateTextStyle(t.id, { listType: t.style.listType === 'numbered' ? 'none' : 'numbered' });
                }}
                title="Numbered list"
              >
                <ListOrdered size={15} />
              </ToolbarButton>
            </ToolbarGroup>

            <ToolbarDivider />

            <ToolbarButton onClick={() => deleteElement(selectedElement.id)} title="Delete element">
              <Trash2 size={15} />
            </ToolbarButton>
          </>
        )}

        {/* Image controls */}
        {selectedElement?.type === 'image' && (
          <>
            <ToolbarDivider />
            <ToolbarGroup>
              <ToolbarSelect
                value={(selectedElement as ImageElement).objectFit ?? 'cover'}
                onChange={(e) => updateElement(selectedElement.id, (el) => ({ ...el, objectFit: e.target.value } as ImageElement))}
                title="Image fit"
              >
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
                <option value="fill">Fill</option>
              </ToolbarSelect>
            </ToolbarGroup>

            <ToolbarDivider />

            {/* Transparency */}
            <span className={styles.toolbarLabel} title="Opacity">
              Opacity
              <input
                type="range"
                min={0} max={100} step={1}
                value={Math.round(((selectedElement as ImageElement).opacity ?? 1) * 100)}
                onChange={(e) => updateElement(selectedElement.id, (el) => ({ ...el, opacity: parseInt(e.target.value) / 100 } as ImageElement))}
                className={styles.toolbarSlider}
              />
              {Math.round(((selectedElement as ImageElement).opacity ?? 1) * 100)}%
            </span>

            <ToolbarDivider />

            {/* Tint */}
            <ColorPickerPopover
              color={(selectedElement as ImageElement).tintColor ?? '#ff0000'}
              onChange={(hex) => updateElement(selectedElement.id, (el) => ({ ...el, tintColor: hex } as ImageElement))}
              title="Tint color"
              showAlpha={flags.colorPickerAlpha}
            >
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1 }}>
                <span style={{ fontSize: 11 }}>Tint</span>
                <span style={{ display: 'block', width: 14, height: 3, borderRadius: 2, backgroundColor: (selectedElement as ImageElement).tintColor ?? '#ff0000' }} />
              </span>
            </ColorPickerPopover>
            <input
              type="range"
              min={0} max={100} step={1}
              value={Math.round(((selectedElement as ImageElement).tintStrength ?? 0) * 100)}
              onChange={(e) => updateElement(selectedElement.id, (el) => ({ ...el, tintStrength: parseInt(e.target.value) / 100 } as ImageElement))}
              className={styles.toolbarSlider}
              title="Tint strength"
            />

            <ToolbarDivider />

            {/* Color adjustments */}
            <span className={styles.toolbarLabel} title="Brightness">
              Bright
              <input
                type="range"
                min={-100} max={100} step={1}
                value={(selectedElement as ImageElement).brightness ?? 0}
                onChange={(e) => updateElement(selectedElement.id, (el) => ({ ...el, brightness: parseInt(e.target.value) } as ImageElement))}
                className={styles.toolbarSlider}
              />
            </span>
            <span className={styles.toolbarLabel} title="Contrast">
              Contrast
              <input
                type="range"
                min={-100} max={100} step={1}
                value={(selectedElement as ImageElement).contrast ?? 0}
                onChange={(e) => updateElement(selectedElement.id, (el) => ({ ...el, contrast: parseInt(e.target.value) } as ImageElement))}
                className={styles.toolbarSlider}
              />
            </span>
            <span className={styles.toolbarLabel} title="Saturation">
              Sat
              <input
                type="range"
                min={-100} max={100} step={1}
                value={(selectedElement as ImageElement).saturation ?? 0}
                onChange={(e) => updateElement(selectedElement.id, (el) => ({ ...el, saturation: parseInt(e.target.value) } as ImageElement))}
                className={styles.toolbarSlider}
              />
            </span>

            <ToolbarDivider />

            {/* White balance */}
            <span className={styles.toolbarLabel} title="White balance (warm/cool)">
              Warm
              <input
                type="range"
                min={-100} max={100} step={1}
                value={(selectedElement as ImageElement).warmth ?? 0}
                onChange={(e) => updateElement(selectedElement.id, (el) => ({ ...el, warmth: parseInt(e.target.value) } as ImageElement))}
                className={styles.toolbarSlider}
              />
            </span>

            <ToolbarDivider />
            <ToolbarButton onClick={() => deleteElement(selectedElement.id)} title="Delete image">
              <Trash2 size={15} />
            </ToolbarButton>
          </>
        )}

        {/* Shape fill + stroke */}
        {selectedElement?.type === 'shape' && (
          <>
            <ToolbarDivider />
            <ToolbarGroup>
              <ColorPickerPopover
                color={(selectedElement as ShapeElement).fill}
                onChange={(hex) => updateElement(selectedElement.id, (el) => ({ ...el, fill: hex } as ShapeElement))}
                title="Fill color"
                showAlpha={flags.colorPickerAlpha}
              >
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1 }}>
                  <span style={{ fontSize: 12 }}>&#9632;</span>
                  <span style={{ display: 'block', width: 14, height: 3, borderRadius: 2, backgroundColor: (selectedElement as ShapeElement).fill }} />
                </span>
              </ColorPickerPopover>
              <ColorPickerPopover
                color={(selectedElement as ShapeElement).stroke === 'transparent' ? '#000000' : (selectedElement as ShapeElement).stroke}
                onChange={(hex) => updateElement(selectedElement.id, (el) => ({ ...el, stroke: hex } as ShapeElement))}
                title="Outline color"
                showAlpha={flags.colorPickerAlpha}
              >
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1 }}>
                  <span style={{ fontSize: 12 }}>&#9633;</span>
                  <span style={{ display: 'block', width: 14, height: 3, borderRadius: 2, backgroundColor: (selectedElement as ShapeElement).stroke === 'transparent' ? '#000000' : (selectedElement as ShapeElement).stroke }} />
                </span>
              </ColorPickerPopover>
            </ToolbarGroup>
            <ToolbarDivider />
            <span className={styles.toolbarLabel}>Outline</span>
            <ToolbarGroup>
              <ToolbarButton
                onClick={() => updateElement(selectedElement.id, (el) => ({ ...el, strokeWidth: Math.max(0, (el as ShapeElement).strokeWidth - 1) } as ShapeElement))}
                disabled={(selectedElement as ShapeElement).strokeWidth <= 0}
                title="Decrease outline width"
              >
                <Minus size={12} />
              </ToolbarButton>
              <span className={styles.stepperValue}>{(selectedElement as ShapeElement).strokeWidth}px</span>
              <ToolbarButton
                onClick={() => updateElement(selectedElement.id, (el) => ({ ...el, strokeWidth: Math.min(20, (el as ShapeElement).strokeWidth + 1) } as ShapeElement))}
                disabled={(selectedElement as ShapeElement).strokeWidth >= 20}
                title="Increase outline width"
              >
                <Plus size={12} />
              </ToolbarButton>
            </ToolbarGroup>
            <ToolbarSelect
              value={(selectedElement as ShapeElement).strokeDash ?? ''}
              onChange={(e) => updateElement(selectedElement.id, (el) => ({ ...el, strokeDash: e.target.value } as ShapeElement))}
              title="Line style"
            >
              <option value="">Solid</option>
              <option value="4 4">Dashed</option>
              <option value="2 2">Dotted</option>
              <option value="8 4 2 4">Dash · dot</option>
              <option value="8 4 2 4 2 4">Dash · dot · dot</option>
            </ToolbarSelect>
            <ToolbarDivider />
            <ToolbarButton onClick={() => deleteElement(selectedElement.id)} title="Delete element">
              <Trash2 size={15} />
            </ToolbarButton>
          </>
        )}

        {/* Line stroke controls */}
        {selectedElement?.type === 'line' && (
          <>
            <ToolbarDivider />
            <ToolbarGroup>
              <ColorPickerPopover
                color={(selectedElement as LineElement).stroke}
                onChange={(hex) => updateElement(selectedElement.id, (el) => ({ ...el, stroke: hex } as LineElement))}
                title="Line color"
                showAlpha={flags.colorPickerAlpha}
              >
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1 }}>
                  <span style={{ fontSize: 12 }}>&#9633;</span>
                  <span style={{ display: 'block', width: 14, height: 3, borderRadius: 2, backgroundColor: (selectedElement as LineElement).stroke }} />
                </span>
              </ColorPickerPopover>
            </ToolbarGroup>
            <ToolbarDivider />
            <ToolbarGroup>
              <ToolbarButton
                onClick={() => updateElement(selectedElement.id, (el) => ({ ...el, strokeWidth: Math.max(1, (el as LineElement).strokeWidth - 1) } as LineElement))}
                disabled={(selectedElement as LineElement).strokeWidth <= 1}
                title="Decrease line width"
              >
                <Minus size={12} />
              </ToolbarButton>
              <span className={styles.stepperValue}>{(selectedElement as LineElement).strokeWidth}px</span>
              <ToolbarButton
                onClick={() => updateElement(selectedElement.id, (el) => ({ ...el, strokeWidth: Math.min(20, (el as LineElement).strokeWidth + 1) } as LineElement))}
                disabled={(selectedElement as LineElement).strokeWidth >= 20}
                title="Increase line width"
              >
                <Plus size={12} />
              </ToolbarButton>
            </ToolbarGroup>
            <ToolbarSelect
              value={(selectedElement as LineElement).strokeDash ?? ''}
              onChange={(e) => updateElement(selectedElement.id, (el) => ({ ...el, strokeDash: e.target.value || undefined } as LineElement))}
              title="Line style"
            >
              <option value="">Solid</option>
              <option value="4 4">Dashed</option>
              <option value="2 2">Dotted</option>
              <option value="8 4 2 4">Dash · dot</option>
              <option value="8 4 2 4 2 4">Dash · dot · dot</option>
            </ToolbarSelect>
            <ToolbarDivider />
            <ToolbarButton onClick={() => deleteElement(selectedElement.id)} title="Delete line">
              <Trash2 size={15} />
            </ToolbarButton>
          </>
        )}

        {/* Layer order controls */}
        {selectedElement && (
          <>
            <ToolbarDivider />
            <ToolbarGroup>
              <ToolbarButton
                onClick={sendElementToBack}
                disabled={selectedElementIndex <= 0}
                title="Send to back"
              >
                <ArrowDownToLine size={14} />
              </ToolbarButton>
              <ToolbarButton
                onClick={moveElementBackward}
                disabled={selectedElementIndex <= 0}
                title="Send backward"
              >
                <ArrowDown size={14} />
              </ToolbarButton>
              <ToolbarButton
                onClick={moveElementForward}
                disabled={selectedElementIndex >= elementCount - 1}
                title="Bring forward"
              >
                <ArrowUp size={14} />
              </ToolbarButton>
              <ToolbarButton
                onClick={bringElementToFront}
                disabled={selectedElementIndex >= elementCount - 1}
                title="Bring to front"
              >
                <ArrowUpToLine size={14} />
              </ToolbarButton>
            </ToolbarGroup>
          </>
        )}

        {/* Animation controls for selected element */}
        {selectedElement && (
          <>
            <ToolbarDivider />
            <Zap size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <ToolbarSelect
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
            </ToolbarSelect>
            {selectedElement.animation?.type === 'fly-in' && (
              <ToolbarSelect
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
              </ToolbarSelect>
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
        <ToolbarDivider />
        <FillPicker
          background={currentSlide.background}
          onChange={(bg) => updateCurrentSlide((s) => ({ ...s, background: bg }))}
          theme={presentation.theme}
        />

        {/* Transition */}
        <ToolbarDivider />
        <ToolbarSelect
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
        </ToolbarSelect>

      </RichTextToolbar>

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
                {remoteUsers.some(u => u.slideIndex === idx) && (
                  <div className={styles.slideUserAvatars}>
                    {remoteUsers.filter(u => u.slideIndex === idx).slice(0, 3).map(u => (
                      <span key={u.clientId} className={styles.slideUserAvatar} style={{ backgroundColor: u.color }} title={u.name}>
                        {u.name[0]?.toUpperCase() ?? '?'}
                      </span>
                    ))}
                  </div>
                )}
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
                editingInitialText={editingInitialText}
                spellCheck={spellCheck}
                onSelectElement={setSelectedElementId}
                onStartEdit={(id) => { setEditingInitialText(null); setEditingElementId(id); }}
                onStopEdit={() => { setEditingElementId(null); setEditingInitialText(null); }}
                onUpdateElement={updateElement}
                onClickBackground={() => { setSelectedElementId(null); setEditingElementId(null); setEditingInitialText(null); }}
                onEmbedCacheUpdate={handleEmbedCacheUpdate}
                onEmbedConvertToStatic={handleEmbedConvertToStatic}
                onEmbedRemove={deleteElement}
                onInsertDrop={handleInsertDrop}
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
                ) : rightPanelTab === 'insert' ? (
                  <div className={styles.insertPanel}>
                    <div className={styles.insertSection}>
                      <span className={styles.insertSectionLabel}>Text</span>
                      <button
                        className={styles.insertBtn}
                        onClick={addTextBox}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('application/x-slide-insert', JSON.stringify({ kind: 'text' }))}
                      >
                        <Type size={15} />
                        <span>Text Box</span>
                      </button>
                    </div>
                    <div className={styles.insertSection}>
                      <span className={styles.insertSectionLabel}>Media</span>
                      <button className={styles.insertBtn} onClick={() => setImageDialogOpen(true)}>
                        <ImageIcon size={15} />
                        <span>Image</span>
                      </button>
                      <button className={styles.insertBtn} onClick={() => { setVideoUrlInput(''); setVideoDialogOpen(true); }}>
                        <Video size={15} />
                        <span>Video</span>
                      </button>
                      {flags.sheetLiveEmbed && (
                        <button className={styles.insertBtn} onClick={() => setSheetDialogOpen(true)}>
                          <Table2 size={15} />
                          <span>Sheet</span>
                        </button>
                      )}
                      {flags.diagramsApp && (
                        <button className={styles.insertBtn} onClick={() => setDiagramDialogOpen(true)}>
                          <Network size={15} />
                          <span>Diagram</span>
                        </button>
                      )}
                    </div>
                    {SHAPE_GROUPS.map((group) => (
                      <div key={group.key} className={styles.insertSection}>
                        <span className={styles.insertSectionLabel}>{group.label}</span>
                        <div className={styles.shapesGrid}>
                          {Object.entries(SHAPE_CATALOG)
                            .filter(([, def]) => def.group === group.key)
                            .map(([id, def]) => (
                              <button
                                key={id}
                                className={styles.shapeBtn}
                                title={def.label}
                                onClick={() => addShape(id)}
                                draggable
                                onDragStart={(e) => e.dataTransfer.setData('application/x-slide-insert', JSON.stringify({ kind: 'shape', shape: id }))}
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
                ) : null}
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
                  className={`${styles.rightPanelTab} ${rightPanelTab === 'insert' ? styles.rightPanelTabActive : ''}`}
                  onClick={() => setRightPanelTab('insert')}
                  title="Insert"
                >
                  <span className={styles.rightPanelTabLabel}>Insert</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom notes bar */}
      <div className={styles.notesBar}>
        <span className={styles.notesBarLabel}>Notes</span>
        <textarea
          className={styles.notesArea}
          placeholder="Add speaker notes for this slide…"
          spellCheck={spellCheck}
          value={currentSlide?.notes ?? ''}
          onChange={(e) => updateCurrentSlide((s) => ({ ...s, notes: e.target.value }))}
        />
      </div>

      {/* Status bar */}
      <div className={styles.statusBar}>
        <div className={styles.statusBarSpacer} />
        <ZoomSlider value={zoom} onChange={setZoom} />
      </div>

      {flags.sheetLiveEmbed && sheetPasteDialogState && (
        <PasteChoiceDialog
          previewData={sheetPasteDialogState.previewData}
          onPasteAsTable={sheetPasteDialogState.onPasteAsTable}
          onPasteAsEmbed={sheetPasteDialogState.onPasteAsEmbed}
          onClose={sheetPasteDialogState.onClose}
        />
      )}

      {sheetDialogOpen && (
        <InsertSheetDialog
          onInsert={(attrs) => { addSheetEmbed(attrs); setSheetDialogOpen(false); }}
          onClose={() => setSheetDialogOpen(false)}
        />
      )}

      {imageDialogOpen && (
        <InsertImageDialog
          onInsert={(src, driveFileId) => { addImage(src, driveFileId); setImageDialogOpen(false); }}
          onClose={() => setImageDialogOpen(false)}
        />
      )}

      {videoDialogOpen && (
        <div className={styles.dialogOverlay} onClick={() => setVideoDialogOpen(false)}>
          <div className={styles.dialogBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.dialogTitle}>Insert Video</div>
            <p className={styles.dialogHint}>Paste a YouTube, Vimeo, Loom, or direct video URL.</p>
            <input
              className={styles.dialogInput}
              type="url"
              placeholder="https://www.youtube.com/watch?v=…"
              value={videoUrlInput}
              onChange={(e) => setVideoUrlInput(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && videoUrlInput.trim()) {
                  addVideo(videoUrlInput.trim());
                  setVideoDialogOpen(false);
                } else if (e.key === 'Escape') {
                  setVideoDialogOpen(false);
                }
              }}
            />
            <div className={styles.dialogActions}>
              <button className={styles.dialogCancelBtn} onClick={() => setVideoDialogOpen(false)}>Cancel</button>
              <button
                className={styles.dialogConfirmBtn}
                disabled={!videoUrlInput.trim()}
                onClick={() => {
                  if (videoUrlInput.trim()) {
                    addVideo(videoUrlInput.trim());
                    setVideoDialogOpen(false);
                  }
                }}
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      )}

      {diagramDialogOpen && (
        <InsertDiagramDialog
          onInsert={(diagramId) => { addDiagram(diagramId); setDiagramDialogOpen(false); }}
          onClose={() => setDiagramDialogOpen(false)}
        />
      )}

      {showShareDialog && slideData && (
        <ShareDialog
          resource={{ ...slideData, name: slideData.title } as unknown as FileItem}
          resourceType="file"
          onClose={() => setShowShareDialog(false)}
        />
      )}
    </div>
  );
}

