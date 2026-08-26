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
  Pencil,
  Eye,
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
  driveAutosaveEncryptedBytes, mintFileKey, canEncryptFor, extractSlideText,
  storageApi, filesystemApi, encryptionApi, ApiClientError, type FileItem,
} from '@/lib/api';
import { indexOnSave } from '@/lib/searchIndexUpdate';
import { useContentVersionGuard } from '@/hooks/useContentVersionGuard';
import { officeAppForFile, withOoxmlExtension, stripOoxmlExtension } from '@/lib/officeFormats';
import { packNeutrinoModel, readNeutrinoModel } from '@/lib/ooxmlContainer';
import { ShareDialog } from '@/app/(apps)/drive/ShareDialog';
import { useSlidePresence } from '@/hooks/useSlidePresence';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { decryptFile, isUnlocked } from '@neutrino/e2e-crypto';
import { readStoredBody, looksLikeJsonBody } from '@/lib/storedBody';
import { ENCRYPTION_WARNING_MESSAGE } from '@/components/EncryptionWarningMessage';
import type { SlideTheme, CreateThemeRequest, UpdateThemeRequest } from '@neutrino/api-slides';
import { ThemeEditorDialog, type ThemeEditorMode } from './ThemeEditorDialog';
import { useSpellCheck } from '@/hooks/useSpellCheck';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import { useAvailableFonts } from '@/hooks/useAvailableFonts';
import { useSheetPasteInterceptor, PasteChoiceDialog } from '@neutrino/sheet-embed';
import type { SheetEmbedAttrsShape, CellValue } from '@neutrino/sheet-embed';
import { InsertSheetDialog } from './InsertSheetDialog';
import { InsertImageDialog } from '@/components/InsertImageDialog';
import { driveImageRef } from '@/lib/driveImages';
import { InsertDiagramDialog } from './InsertDiagramDialog';
import { HamburgerMenu } from './MenuBar';

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
  const { fontFamilyNames: FONT_FAMILIES } = useAvailableFonts();
  const slideId = searchParams.get('id') ?? '';
  useAccessRevocation(slideId);
  const { spellCheck } = useSpellCheck();
  const currentUser = useUser();
  const [authToken, setAuthToken] = useState<string | null>(null);
  useEffect(() => {
    setAuthToken(localStorage.getItem('access_token'));
  }, []);

  const { dekRef, dekResolved, isNewEncryption, awaitDek } =
    useEncryptedDocumentContent({ id: slideId, filename: 'slide.json' });
  const toast = useToast();
  // Rejects a save that would overwrite a revision written elsewhere since this
  // presentation was loaded. See `useContentVersionGuard`.
  const versionGuard = useContentVersionGuard();

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
  const titleInputRef = useRef<HTMLInputElement>(null);
  const dragSrcIdx = useRef<number | null>(null);
  const initialSaveDoneRef = useRef(false);
  // Set when the content read finds the server still holding this deck in the
  // clear. A ref, not state: setting state from inside a query function
  // re-renders mid-fetch and sets a second fetch going. `contentUpdatedAt` is
  // the reactive signal instead — it moves on every completed read, including
  // the second one on a reload, which returns the same text as the first (that
  // read runs while the vault is still locked).
  const serverPlaintextRef = useRef(false);
  // Forward-ref to the content autosave — set once `contentMutation` is defined
  // below, and read from the OOXML load effect, which runs before that
  // definition point. That effect needs it for one case: a deck created here
  // and never saved, whose empty record has to become a real package.
  const contentMutationRef = useRef<(content: string) => void>(() => {});
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
    // Presence is keyed on the Drive file id and carries the editor's own
    // presentation model, so it does not care which format the file is stored
    // in. It used to be skipped for `.pptx` files back when those were only
    // ever uploads (issue #43); leaving it that way now would mean no deck
    // created from this point on could be co-edited.
    enabled: !!slideId,
    selectedSlideIndex: selectedSlideIdx,
    onRemotePresentationRef,
  });

  const { isLoading: metaLoading, isError: metaIsError, error: metaError, data: slideData } = useQuery({
    queryKey: ['slide', slideId],
    queryFn: () => slidesApi.getSlide(slideId),
    enabled: !!slideId,
    staleTime: 30_000,
  });

  useEffect(() => {
    versionGuard.observe(slideData?.contentVersion);
  }, [slideData?.contentVersion, versionGuard]);

  // ── OOXML mode (issues #43, #127) ──────────────────────────────────────────
  // `slidesApi.getSlide` answers only for the bespoke JSON format, so it 404s
  // for a `.pptx` — which is every presentation created since #127, as well as
  // any deck uploaded to Drive. Fall back to the generic Drive file metadata to
  // tell that apart from a genuinely deleted or missing presentation. Named
  // `officeMode` because that is what it was when only uploads took this path.
  const slide404 = metaIsError
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

  // Seed the stale-write guard from the revision this load saw. The effect
  // above does it from `slideData`, which a `.pptx` never has — without this
  // every OOXML save would assert no revision at all.
  useEffect(() => {
    if (officeMode) versionGuard.observe(officeFileMeta?.contentVersion);
  }, [officeMode, officeFileMeta?.contentVersion, versionGuard]);

  useEffect(() => { officeModeRef.current = officeMode; }, [officeMode]);
  const officeFileMetaRef = useRef<FileItem | null>(null);
  useEffect(() => { officeFileMetaRef.current = officeFileMeta ?? null; }, [officeFileMeta]);
  const presentationRef = useRef<SlidePresentation>(presentation);
  presentationRef.current = presentation;

  const {
    isLoading: contentLoading,
    data: slideContent,
    dataUpdatedAt: contentUpdatedAt,
  } = useQuery({
    queryKey: ['slide-content', slideId, dekResolved],
    queryFn: async () => {
      if (!slideData?.contentUrl) return null;
      // `awaitDek`, not `dekRef.current`. `dekResolved` only means the *attempt*
      // has finished, and on a reload the attempt finishes immediately with no
      // key: the keyring is unwrapped from IndexedDB a moment later. Sampling
      // the ref there reported "no key" for a perfectly readable deck and fell
      // through to the raw read below, which hands back ciphertext — JSON.parse
      // rejects it and the editor shows the empty default deck instead of the
      // presentation. Re-resolving on unlock flips `dekResolved` false and back
      // to true, which is the same query key, so the bad result stayed cached
      // for its whole `staleTime` rather than being retried.
      const dek = await awaitDek();
      if (dek) {
        const blob = await storageApi.downloadFile(slideId);
        const stored = new Uint8Array(await blob.arrayBuffer());
        // Plaintext-or-ciphertext is decided from the bytes, not from
        // `isNewEncryption` — see `readStoredBody`. A deck created and then
        // reloaded before the sealing write landed has a key ref and a
        // plaintext body, and the session flag calls that ciphertext.
        const { text, wasPlaintext } = readStoredBody(stored, dek);
        // Tracks the read that produced the deck on screen, both ways: a later
        // read that decrypts means the body is sealed and the effect below must
        // not fire again.
        serverPlaintextRef.current = wasPlaintext;
        return text;
      }
      // No key in hand. A deck with a key ref on the server really is
      // encrypted, so reading it raw would render its ciphertext; failing
      // instead leaves an errored query, which refetches once the vault is
      // unlocked and the key resolution runs again.
      if (currentUser?.id && !isUnlocked(currentUser.id)) {
        const keyRef = await encryptionApi.getFileKey(slideId);
        if (keyRef) {
          throw new Error('presentation content is unreadable until the vault is unlocked');
        }
      }
      // This read is routine for a brand-new deck: `dekResolved` means the
      // resolution attempt finished, not that a key exists, so the first read
      // of a file whose key is still being minted lands here. Such a deck needs
      // sealing as much as one read through the branch above — the effect below
      // waits for the key. Which it is comes off the bytes, not off reaching
      // this line: the check above catches a locked session, but a session that
      // is unlocked with the resolution not yet started reads a real deck's
      // ciphertext as text, and marking *that* for sealing would overwrite it.
      const raw = await driveReadContent(slideData.contentUrl);
      serverPlaintextRef.current = looksLikeJsonBody(raw);
      return raw;
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

  const [themeDialogState, setThemeDialogState] = useState<{ mode: ThemeEditorMode; theme: SlideTheme | null } | null>(null);

  const createThemeMutation = useMutation({
    mutationFn: (body: CreateThemeRequest) => slidesApi.createTheme(body),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['slide-themes'] });
      applyTheme(dbThemeToTheme(created));
      setThemeDialogState(null);
      toast.success('Theme created');
    },
    onError: () => toast.error('Failed to create theme'),
  });

  const updateThemeMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateThemeRequest }) => slidesApi.updateTheme(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slide-themes'] });
      setThemeDialogState(null);
      toast.success('Theme updated');
    },
    onError: () => toast.error('Failed to update theme'),
  });

  const deleteThemeMutation = useMutation({
    mutationFn: (id: string) => slidesApi.deleteTheme(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slide-themes'] });
      setThemeDialogState(null);
      toast.success('Theme deleted');
    },
    onError: () => toast.error('Failed to delete theme'),
  });

  // `contentUnread`: the content query is gated on `dekResolved`, and React
  // Query reports a query it has not started as "not loading" — so without it
  // the editor was interactive before the deck it is about to show had been
  // read, and the read then replaced whatever had been added in the meantime.
  const contentUnread = !!slideData?.contentUrl && !dekResolved;
  const isLoading = metaLoading || contentLoading || contentUnread
    || (slide404 && officeFallbackLoading);

  useEffect(() => {
    if (!slideData) return;
    setTitle(slideData.title);
  }, [slideData]);

  // ── Office mode: title + content load (issue #43) ───────────────────────
  useEffect(() => {
    if (officeMode && officeFileMeta) setTitle(stripOoxmlExtension(officeFileMeta.name));
  }, [officeMode, officeFileMeta]);

  const officeContentLoadStartedRef = useRef(false);
  useEffect(() => {
    if (!officeMode || !officeFileMeta || !dekResolved || officeContentLoadStartedRef.current) return;
    officeContentLoadStartedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const blob = await storageApi.downloadFile(slideId);
        if (cancelled) return;
        // Office-mode saves are encrypted now, so a file that already has a key
        // ref holds ciphertext. `isNewEncryption` separates the two: it means
        // the DEK was just minted for a file that had none, so what is stored
        // is still the plaintext .pptx it was uploaded as, and the first save
        // is what encrypts it.
        const stored = new Uint8Array(await blob.arrayBuffer());
        if (cancelled) return;
        const plain = dekRef.current && !isNewEncryption
          ? decryptFile(stored, dekRef.current)
          : stored;
        // A presentation created here starts with no body at all: a `.pptx` is
        // a zip, so the server writes no seed. The default deck already on
        // screen is what it should look like, and this save is what turns the
        // empty record into a real package — now rather than on the first edit,
        // or a deck opened and closed again stays a zero-byte file.
        if (plain.byteLength === 0) {
          contentMutationRef.current(JSON.stringify(presentationRef.current));
          return;
        }

        // The model packed into the deck is the lossless copy; the deck itself
        // is what PowerPoint reads and what a file from anywhere else arrives
        // as. Preferring the model is what keeps themes, transitions, gradient
        // backgrounds and speaker-note formatting across a save — pptxgenjs
        // carries none of them (issue #127).
        const model = await readNeutrinoModel(plain, 'slides');
        if (cancelled) return;
        if (model) {
          setPresentation(JSON.parse(model) as SlidePresentation);
          lastSavedRef.current = model;
          return;
        }

        const file = new File(
          [plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer],
          officeFileMeta.name,
          { type: officeFileMeta.mimeType },
        );
        const { importFromPptx } = await import('./pptxImport');
        if (cancelled) return;
        const imported = await importFromPptx(file);
        if (cancelled) return;
        setPresentation(imported);
        lastSavedRef.current = JSON.stringify(imported);
      } catch {
        if (!cancelled) toast.error('Failed to open this file for editing');
      }
    })();
    return () => { cancelled = true; };
  // toast is intentionally omitted — a fresh identity on every render would
  // otherwise cancel this one-shot load via the cleanup function above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeMode, officeFileMeta, slideId, dekResolved, isNewEncryption]);

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

  // After the DEK resolves and the content query settles, seal whatever the
  // server is holding in plaintext.
  //
  // `serverPlaintext` is the whole condition: the read above got the body back
  // without decrypting it, which is the only evidence that it is not ciphertext.
  // This used to ask `isNewEncryption` — "the DEK was minted here, so the file
  // had no key ref, so the bytes are plaintext". True as far as it goes, but
  // blind to the case in between: a deck created and then reloaded before this
  // write landed has a key ref *and* a plaintext body, and was never sealed.
  // Bytes that neither decrypt nor look like plaintext are ciphertext this key
  // cannot open; `readStoredBody` throws on those rather than reporting them as
  // content, so this never runs for them and real content is never overwritten.
  //
  // This used to also require `lastSavedRef.current === ''` — "and nothing
  // loaded". That made sense when a new deck had no body at all, but Drive now
  // seeds the empty-deck JSON itself from the mime type (`NATIVE_TYPES` in
  // `src/drive/storage/native_types.rs`), so a load always produces content and
  // the condition never held. A newly created presentation therefore kept its
  // body in plaintext on the server indefinitely — the one thing E2EE is for —
  // while sheets, which tracks this as `serverHasPlaintextContent`, re-sealed
  // its own seed correctly.
  useEffect(() => {
    if (!dekRef.current || !slideData || contentLoading) return;
    if (!serverPlaintextRef.current) return;
    if (initialSaveDoneRef.current) return;
    initialSaveDoneRef.current = true;
    // Prefer the body just read from the server, so this re-seals exactly what
    // is stored rather than replacing it with the client's default deck.
    const content = lastSavedRef.current || JSON.stringify(presentationRef.current);
    driveAutosaveEncryptedContent(slideData.id, content, 'slide.json', dekRef.current)
      // This write bumps `contentVersion` just like any other, and nothing
      // re-reads the metadata query afterwards — so without feeding the result
      // back the guard keeps asserting the version we loaded and every
      // subsequent save is rejected as stale.
      .then((saved) => versionGuard.observe(saved?.contentVersion))
      .catch(() => {});
  // dekRef is a stable ref; use dekResolved (state) as the reactive signal.
  // `presentation` is read through presentationRef, so it is deliberately not a
  // dependency: this runs once, not on every edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dekResolved, contentUpdatedAt, slideData, contentLoading, slideContent]);

  const contentMutation = useMutation({
    mutationFn: async ({ content }: { content: string }) => {
      // Office mode (issue #43): re-serialize the current presentation into
      // real PPTX bytes and write them to the SAME Drive file id via the
      // binary-safe transport, instead of the native JSON autosave path.
      if (officeModeRef.current) {
        const meta = officeFileMetaRef.current;
        if (!meta) throw new Error('office-meta-missing');
        if (!dekRef.current) throw new Error('no-dek');
        // The package carries both halves: the PowerPoint deck other tools
        // read, and this editor's own presentation model, which is what keeps
        // themes, transitions and gradient backgrounds — none of which survive
        // pptxgenjs — across a save. See `lib/ooxmlContainer.ts`.
        const deck = await exportAsPptxBytes(presentationRef.current);
        const bytes = await packNeutrinoModel(deck, 'slides', content);
        // Those bytes are encrypted like everything else. They used not to be,
        // on the grounds that "downloading the raw file must open in real
        // PowerPoint" (issue #43, criterion 3) — but Drive's download decrypts
        // client-side, so the .pptx that reaches the user's disk is the same
        // either way. What the plaintext write bought was a readable deck in
        // object storage: issue #95.
        return driveAutosaveEncryptedBytes(
          slideId, bytes, meta.name, dekRef.current, versionGuard.check(),
        );
      }
      if (!dekRef.current) throw new Error('no-dek');
      return driveAutosaveEncryptedContent(
        slideData!.id, content, 'slide.json', dekRef.current, versionGuard.check(),
      );
    },
    onMutate: () => setSaveStatus('saving'),
    onSuccess: (saved, { content }) => {
      setSaveStatus('saved');
      versionGuard.observe(saved?.contentVersion);
      lastSavedRef.current = content;
      queryClient.invalidateQueries({ queryKey: ['slides'] });
      indexOnSave(currentUser?.id, {
        id: slideId,
        type: 'slide',
        title,
        content: extractSlideText(content),
      });
    },
    onError: (err) => {
      setSaveStatus('error');
      if (err instanceof Error && err.message === 'no-dek') {
        toast.warning(ENCRYPTION_WARNING_MESSAGE);
        return;
      }
      if (versionGuard.handleError(err)) {
        toast.warning(
          'This presentation changed elsewhere since you opened it. Reload to get the ' +
            'latest version, or save again to keep your copy.',
        );
      }
    },
  });

  const titleMutation = useMutation({
    mutationFn: async ({ title: t }: { title: string }): Promise<void> => {
      // Office mode: no `slides` row to PATCH — rename through the generic
      // Drive rename call (same one FileContextMenu's rename action uses).
      if (officeModeRef.current) {
        // The extension goes back on: the title is what the user typed, and the
        // file still has to land on disk as a deck PowerPoint opens.
        await filesystemApi.updateFile(slideId, { name: withOoxmlExtension(t, 'slides') });
        return;
      }
      await slidesApi.saveSlide(slideData!.id, { title: t });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['slides'] }),
  });

  useEffect(() => {
    contentMutationRef.current = (content: string) => { contentMutation.mutate({ content }); };
  }, [contentMutation]);

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

  /** Menu / Ctrl+S: skip the autosave debounce and write the deck now. */
  const handleManualSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    contentMutation.mutate({ content: JSON.stringify(presentationRef.current) });
  }, [contentMutation]);

  const handleNewPresentation = useCallback(async () => {
    const created = await slidesApi.createSlide({ title: 'Untitled presentation' });
    router.push(`/slides/editor?id=${created.id}`);
  }, [router]);

  const handleDuplicate = useCallback(async () => {
    // The copy is a new Drive file with no key of its own, so mint a DEK and
    // register it the way an editor's first save does. This used to fall back
    // to a plaintext write when there was no key pair on this device, which
    // left a presentation that could never be encrypted (issue #95). Checked
    // before the copy is created so a locked vault leaves no empty deck behind.
    if (!(await canEncryptFor(currentUser?.id))) {
      toast.warning(ENCRYPTION_WARNING_MESSAGE);
      return;
    }
    const content = JSON.stringify(presentationRef.current);
    const copy = await slidesApi.createSlide({ title: `${title || 'Untitled presentation'} (copy)` });
    const dek = await mintFileKey(currentUser?.id, copy.id);
    await driveAutosaveEncryptedContent(copy.id, content, 'slide.json', dek);
    queryClient.invalidateQueries({ queryKey: ['slides'] });
    router.push(`/slides/editor?id=${copy.id}`);
  }, [title, currentUser?.id, queryClient, router, toast]);

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
        <HamburgerMenu
          titleInputRef={titleInputRef}
          onSave={handleManualSave}
          onNewPresentation={handleNewPresentation}
          onDuplicate={handleDuplicate}
          onImport={() => importInputRef.current?.click()}
          onExportPptx={() => { void exportAsPptx(title || 'presentation', presentationRef.current); }}
          onShare={() => setShowShareDialog(true)}
          onNewSlide={addSlide}
          onDuplicateSlide={duplicateSlide}
          onDeleteSlide={deleteSlide}
          onMoveSlide={moveSlide}
          canMoveSlideUp={selectedSlideIdx > 0}
          canMoveSlideDown={selectedSlideIdx < presentation.slides.length - 1}
          canDeleteSlide={presentation.slides.length > 1}
          onApplyLayout={applyLayout}
          onInsertTextBox={addTextBox}
          onInsertShape={addShape}
          onInsertLine={addLine}
          onInsertImage={() => setImageDialogOpen(true)}
          onInsertVideo={() => { setVideoUrlInput(''); setVideoDialogOpen(true); }}
          onInsertSheet={() => setSheetDialogOpen(true)}
          onInsertDiagram={() => setDiagramDialogOpen(true)}
          hasSelection={!!selectedElement}
          onBringToFront={bringElementToFront}
          onMoveForward={moveElementForward}
          onMoveBackward={moveElementBackward}
          onSendToBack={sendElementToBack}
          onDeleteElement={() => { if (selectedElementId) deleteElement(selectedElementId); }}
          rightPanelTab={rightPanelTab}
          onSelectPanel={setRightPanelTab}
          masterMode={masterMode}
          onToggleMaster={() => { setMasterMode((v) => !v); setSelectedElementId(null); }}
          zoom={zoom}
          onZoomChange={setZoom}
          onPresent={() => setPresenterMode(true)}
        />

        <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={handleBack} className={styles.backBtn}>
          Slides
        </Button>

        <div className={styles.titleArea}>
          <Presentation size={18} color="var(--color-rose, #e11d48)" />
          <input
            ref={titleInputRef}
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
                      <button
                        className={`${styles.themeCard} ${styles.themeCardNew}`}
                        onClick={() => setThemeDialogState({ mode: 'create', theme: null })}
                        title="Create a new theme from scratch"
                      >
                        <div className={styles.themeCardNewPreview}>
                          <Plus size={20} />
                        </div>
                        <span className={styles.themeCardName}>New theme</span>
                      </button>
                      {(dbThemesData?.themes ?? []).map((t) => (
                        <div
                          key={t.id}
                          className={`${styles.themeCard} ${presentation.theme.name === t.name ? styles.themeCardActive : ''}`}
                          onClick={() => applyTheme(dbThemeToTheme(t))}
                          title={t.name}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') applyTheme(dbThemeToTheme(t)); }}
                        >
                          <button
                            className={styles.themeCardManageBtn}
                            onClick={(e) => { e.stopPropagation(); setThemeDialogState({ mode: t.isSystem ? 'view' : 'edit', theme: t }); }}
                            title={t.isSystem ? 'View theme' : 'Edit theme'}
                          >
                            {t.isSystem ? <Eye size={11} /> : <Pencil size={11} />}
                          </button>
                          <div className={styles.themeCardPreview}>
                            <ThemePreview theme={t} />
                          </div>
                          <span className={styles.themeCardName}>{t.name}</span>
                        </div>
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
          onInsert={({ src, driveFileId }) => {
            // Reference the Drive file rather than storing the image; `src` is
            // the fallback for an image the picker could not store.
            addImage(driveFileId ? driveImageRef(driveFileId) : src, driveFileId);
            setImageDialogOpen(false);
          }}
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

      {themeDialogState && (
        <ThemeEditorDialog
          mode={themeDialogState.mode}
          theme={themeDialogState.theme}
          saving={createThemeMutation.isPending || updateThemeMutation.isPending || deleteThemeMutation.isPending}
          onClose={() => setThemeDialogState(null)}
          onCreate={(body) => createThemeMutation.mutate(body)}
          onSave={(body) => { if (themeDialogState.theme) updateThemeMutation.mutate({ id: themeDialogState.theme.id, body }); }}
          onDelete={() => { if (themeDialogState.theme) deleteThemeMutation.mutate(themeDialogState.theme.id); }}
          onDuplicate={(body) => createThemeMutation.mutate(body)}
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

