'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HardDrive, Upload, Link2, X, Search, ImageOff } from 'lucide-react';
import styles from './ImagePickerDialog.module.css';

// ── Public types ────────────────────────────────────────────────────────────

export type ImageSource = 'drive' | 'local' | 'url';

export interface ImagePickerDriveItem {
  id: string;
  name: string;
  /** Full-size URL used as the inserted `src`. */
  url: string;
  /** Smaller URL used for the browse grid; falls back to `url`. */
  thumbnailUrl?: string;
}

export interface ImagePickerResult {
  /** What the caller should insert — a Drive URL, a remote URL, or a data URL. */
  src: string;
  /** Which tab the image came from. */
  source: ImageSource;
  /** Set for Drive images, and for local files when the caller uploaded them. */
  driveFileId?: string;
  /** File name (Drive item name or local file name); undefined for URLs. */
  name?: string;
  /** Natural pixel size of the previewed image, when the browser reported it. */
  width?: number;
  height?: number;
}

export interface ImagePickerDialogProps {
  /** Dialog heading (default: 'Insert image'). */
  title?: string;
  /** Confirm button label (default: 'Insert'). */
  confirmLabel?: string;
  /** Tab shown first (default: 'drive'). */
  defaultSource?: ImageSource;
  /**
   * Loads the caller's Drive images. Called the first time the Drive tab is
   * shown, and again when the user retries after a failure.
   */
  onFetchDriveImages: () => Promise<ImagePickerDriveItem[]>;
  /**
   * Turns a selected Drive item into a src that can actually be displayed and
   * inserted. Needed because a Drive file's stored bytes are not always the
   * image: an end-to-end-encrypted file downloads as ciphertext, which the
   * browser cannot decode, and it fails silently — a 200 response and an empty
   * console. Called once per selection; the item's own `url` is used when this
   * is omitted or when the caller has nothing to change about it.
   */
  onResolveDriveImage?: (item: ImagePickerDriveItem) => Promise<string>;
  /**
   * Uploads a locally-chosen file to Drive and resolves with the stored item.
   * When omitted, local files are inserted as base64 data URLs instead, which
   * keeps the document self-contained at the cost of its size.
   */
  onUploadLocalFile?: (file: File, onProgress: (percent: number) => void) => Promise<ImagePickerDriveItem>;
  /**
   * Copies an image at a URL into the caller's storage on insert, so the
   * document ends up referring to a file that outlives the original link.
   * When omitted the URL is inserted as-is.
   */
  onImportUrlImage?: (url: string, onProgress: (percent: number) => void) => Promise<ImagePickerDriveItem>;
  onInsert: (result: ImagePickerResult) => void;
  onClose: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const TABS: { id: ImageSource; label: string; icon: React.ReactNode }[] = [
  { id: 'drive', label: 'Neutrino Drive', icon: <HardDrive size={14} /> },
  { id: 'local', label: 'Local File', icon: <Upload size={14} /> },
  { id: 'url', label: 'URL', icon: <Link2 size={14} /> },
];

/** Bytes → a short human-readable size, for the preview caption. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

// ── Component ───────────────────────────────────────────────────────────────

export function ImagePickerDialog({
  title = 'Insert image',
  confirmLabel = 'Insert',
  defaultSource = 'drive',
  onFetchDriveImages,
  onResolveDriveImage,
  onUploadLocalFile,
  onImportUrlImage,
  onInsert,
  onClose,
}: ImagePickerDialogProps) {
  const [source, setSource] = useState<ImageSource>(defaultSource);

  // Drive tab
  const [driveItems, setDriveItems] = useState<ImagePickerDriveItem[] | null>(null);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState(false);
  const [driveQuery, setDriveQuery] = useState('');
  const [selectedDriveId, setSelectedDriveId] = useState<string | null>(null);
  const [driveSrc, setDriveSrc] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  // Selections can outrun their resolutions — clicking a second image while the
  // first is still downloading must not leave the first one's result on screen.
  const resolveTokenRef = useRef(0);

  // Local tab
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // URL tab
  const [urlInput, setUrlInput] = useState('');
  const [debouncedUrl, setDebouncedUrl] = useState('');

  // Preview + confirm
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [inserting, setInserting] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [insertError, setInsertError] = useState<string | null>(null);

  const loadDriveImages = useCallback(() => {
    setDriveLoading(true);
    setDriveError(false);
    onFetchDriveImages()
      .then((items) => { setDriveItems(items); setDriveLoading(false); })
      .catch(() => { setDriveError(true); setDriveLoading(false); });
  }, [onFetchDriveImages]);

  // Fetch on the first visit to the Drive tab, not on mount: a caller that
  // opens on the URL tab shouldn't pay for a Drive listing it never shows.
  useEffect(() => {
    if (source !== 'drive' || driveItems !== null || driveLoading || driveError) return;
    loadDriveImages();
  }, [source, driveItems, driveLoading, driveError, loadDriveImages]);

  // Debounce the URL so every keystroke of a pasted address doesn't fire a request.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedUrl(urlInput.trim()), 400);
    return () => clearTimeout(t);
  }, [urlInput]);

  // Object URLs are cheap to make and leak if never revoked, so each new local
  // selection revokes the previous one and unmount revokes the last.
  useEffect(() => () => { if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl); }, [localPreviewUrl]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const selectedDriveItem = useMemo(
    () => driveItems?.find((i) => i.id === selectedDriveId) ?? null,
    [driveItems, selectedDriveId],
  );

  const filteredDriveItems = useMemo(() => {
    const q = driveQuery.trim().toLowerCase();
    if (!q) return driveItems ?? [];
    return (driveItems ?? []).filter((i) => i.name.toLowerCase().includes(q));
  }, [driveItems, driveQuery]);

  /** The image the preview pane is showing for the active tab, if any. */
  const previewSrc =
    source === 'drive' ? driveSrc
    : source === 'local' ? localPreviewUrl
    : debouncedUrl || null;

  const previewCaption =
    source === 'drive' ? selectedDriveItem?.name ?? null
    : source === 'local' && localFile ? `${localFile.name} · ${formatBytes(localFile.size)}`
    : null;

  // Every tab requires a preview that actually decoded before it will insert —
  // that is the whole point of previewing, and it also rules out 404s and
  // non-image URLs without the caller having to validate them.
  const canInsert = !!previewSrc && previewLoaded && !previewFailed && !inserting && !resolving;

  function resetPreviewState() {
    setPreviewLoaded(false);
    setPreviewFailed(false);
    setNaturalSize(null);
    setInsertError(null);
  }

  function selectSource(next: ImageSource) {
    if (next === source) return;
    setSource(next);
    resetPreviewState();
  }

  function selectDriveItem(item: ImagePickerDriveItem) {
    resetPreviewState();
    setSelectedDriveId(item.id);

    if (!onResolveDriveImage) { setDriveSrc(item.url); return; }

    const token = ++resolveTokenRef.current;
    setDriveSrc(null);
    setResolving(true);
    onResolveDriveImage(item)
      .then((src) => {
        if (token !== resolveTokenRef.current) return;
        setDriveSrc(src);
        setResolving(false);
      })
      .catch((e) => {
        if (token !== resolveTokenRef.current) return;
        setResolving(false);
        setPreviewFailed(true);
        setInsertError(e instanceof Error ? e.message : 'Could not open that image.');
      });
  }

  function selectLocalFile(file: File | undefined | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setInsertError('That file is not an image.');
      return;
    }
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    resetPreviewState();
    setLocalFile(file);
    setLocalPreviewUrl(URL.createObjectURL(file));
  }

  async function handleInsert() {
    if (!canInsert || !previewSrc) return;
    const size = naturalSize ?? undefined;
    setInsertError(null);

    if (source === 'drive' && selectedDriveItem && driveSrc) {
      onInsert({
        // Whatever was previewed is what gets inserted — for an encrypted file
        // that is the decrypted image, not the URL it was fetched from.
        src: driveSrc,
        source: 'drive',
        driveFileId: selectedDriveItem.id,
        name: selectedDriveItem.name,
        ...size,
      });
      return;
    }

    if (source === 'url') {
      if (!onImportUrlImage) {
        onInsert({ src: debouncedUrl, source: 'url', ...size });
        return;
      }
      setInserting(true);
      try {
        setUploadPercent(0);
        const item = await onImportUrlImage(debouncedUrl, setUploadPercent);
        // The remote URL still displays, and is what was previewed; the stored
        // copy is what the caller should persist, via `driveFileId`.
        onInsert({ src: debouncedUrl, source: 'url', driveFileId: item.id, name: item.name, ...size });
      } catch (e) {
        setInsertError(e instanceof Error ? e.message : 'Could not save that image.');
      } finally {
        setInserting(false);
        setUploadPercent(null);
      }
      return;
    }

    if (source === 'local' && localFile) {
      setInserting(true);
      try {
        if (onUploadLocalFile) {
          setUploadPercent(0);
          const item = await onUploadLocalFile(localFile, setUploadPercent);
          onInsert({
            src: item.url,
            source: 'local',
            driveFileId: item.id,
            name: item.name || localFile.name,
            ...size,
          });
        } else {
          // No upload hook: embed the bytes so the document stays self-contained.
          const dataUrl = await readAsDataUrl(localFile);
          onInsert({ src: dataUrl, source: 'local', name: localFile.name, ...size });
        }
      } catch (e) {
        setInsertError(e instanceof Error ? e.message : 'Could not add that image. Please try again.');
      } finally {
        setInserting(false);
        setUploadPercent(null);
      }
    }
  }

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.headerTitle}>{title}</div>
          <button className={styles.closeBtn} type="button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="Image source">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={source === tab.id}
              className={`${styles.tab} ${source === tab.id ? styles.tabActive : ''}`}
              onClick={() => selectSource(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          <div className={styles.sourcePane} role="tabpanel">
            {source === 'drive' && (
              <>
                <div className={styles.searchRow}>
                  <Search size={14} className={styles.searchIcon} />
                  <input
                    className={styles.searchInput}
                    placeholder="Search your images"
                    value={driveQuery}
                    onChange={(e) => setDriveQuery(e.target.value)}
                    aria-label="Search your images"
                  />
                </div>

                {driveLoading && <div className={styles.muted}>Loading your images…</div>}

                {driveError && (
                  <div className={styles.errorBlock}>
                    <p className={styles.errorText}>Could not load your Drive images.</p>
                    <button className={styles.linkBtn} type="button" onClick={loadDriveImages}>Try again</button>
                  </div>
                )}

                {!driveLoading && !driveError && filteredDriveItems.length === 0 && (
                  <div className={styles.muted}>
                    {driveQuery.trim()
                      ? 'No images match that search.'
                      : 'No images in your Drive yet. Add one from the Local File tab.'}
                  </div>
                )}

                {!driveLoading && !driveError && filteredDriveItems.length > 0 && (
                  <ul className={styles.driveGrid}>
                    {filteredDriveItems.map((item) => (
                      <li key={item.id} className={styles.driveCell}>
                        <button
                          type="button"
                          title={item.name}
                          aria-pressed={selectedDriveId === item.id}
                          className={`${styles.driveItem} ${selectedDriveId === item.id ? styles.driveItemActive : ''}`}
                          onClick={() => selectDriveItem(item)}
                          onDoubleClick={() => { if (canInsert) handleInsert(); }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            className={styles.driveThumb}
                            src={item.thumbnailUrl ?? item.url}
                            alt=""
                            loading="lazy"
                          />
                          <span className={styles.driveName}>{item.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {source === 'local' && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className={styles.hiddenInput}
                  onChange={(e) => { selectLocalFile(e.target.files?.[0]); e.target.value = ''; }}
                  data-testid="image-picker-file-input"
                />
                <div
                  className={`${styles.dropZone} ${dragging ? styles.dropZoneActive : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); selectLocalFile(e.dataTransfer.files?.[0]); }}
                >
                  <Upload size={22} className={styles.dropIcon} />
                  <p className={styles.dropText}>{localFile ? 'Choose a different image' : 'Drag an image here'}</p>
                  <p className={styles.dropHint}>or click to browse your computer</p>
                </div>
                {onUploadLocalFile && (
                  <p className={styles.note}>The file is saved to your Neutrino Drive when you insert it.</p>
                )}
              </>
            )}

            {source === 'url' && (
              <>
                <label className={styles.label} htmlFor="image-picker-url">Image address</label>
                <input
                  id="image-picker-url"
                  className={styles.urlInput}
                  type="url"
                  placeholder="https://example.com/image.png"
                  value={urlInput}
                  onChange={(e) => { setUrlInput(e.target.value); resetPreviewState(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canInsert) handleInsert(); }}
                  autoFocus
                />
                <p className={styles.note}>
                  {onImportUrlImage
                    ? 'A copy is saved to your Neutrino Drive, so the image stays even if the original link stops working.'
                    : 'The image is linked, not copied — it disappears from your document if the address stops working.'}
                </p>
              </>
            )}
          </div>

          <div className={styles.previewPane}>
            <div className={styles.previewLabel}>Preview</div>
            <div className={styles.previewBox}>
              {resolving && <span className={styles.previewEmpty}>Opening image…</span>}

              {!resolving && !previewSrc && !previewFailed && (
                <span className={styles.previewEmpty}>Nothing selected yet</span>
              )}

              {!resolving && !previewSrc && previewFailed && (
                <span className={styles.previewEmpty}>
                  <ImageOff size={20} />
                  Could not open this image.
                </span>
              )}

              {previewSrc && previewFailed && (
                <span className={styles.previewEmpty}>
                  <ImageOff size={20} />
                  {source === 'url' ? 'Could not load an image from that address.' : 'Could not display this image.'}
                </span>
              )}

              {previewSrc && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={previewSrc}
                  className={styles.previewImg}
                  src={previewSrc}
                  alt="Selected image preview"
                  style={previewLoaded && !previewFailed ? undefined : { display: 'none' }}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    // SVGs without an intrinsic size decode fine but report 0×0;
                    // pass no dimensions at all rather than a meaningless zero.
                    setNaturalSize(
                      img.naturalWidth > 0 && img.naturalHeight > 0
                        ? { width: img.naturalWidth, height: img.naturalHeight }
                        : null,
                    );
                    setPreviewLoaded(true);
                    setPreviewFailed(false);
                  }}
                  onError={() => { setPreviewLoaded(false); setPreviewFailed(true); }}
                />
              )}
            </div>

            {/* Rendered even when empty — see the reserved heights in the CSS. */}
            <div className={styles.previewCaption}>{previewCaption ?? ''}</div>
            <div className={styles.previewMeta}>
              {naturalSize && previewLoaded && !previewFailed
                ? `${naturalSize.width} × ${naturalSize.height} px`
                : ''}
            </div>
          </div>
        </div>

        <div className={`${styles.progressTrack} ${uploadPercent !== null ? styles.progressTrackVisible : ''}`}>
          <div className={styles.progressBar} style={{ width: `${uploadPercent ?? 0}%` }} />
        </div>

        <div className={styles.footer}>
          {insertError && <span className={styles.footerError}>{insertError}</span>}
          <button className={styles.cancelBtn} type="button" onClick={onClose} disabled={inserting}>Cancel</button>
          <button className={styles.confirmBtn} type="button" onClick={handleInsert} disabled={!canInsert}>
            {inserting ? (uploadPercent !== null ? `Uploading… ${uploadPercent}%` : 'Working…') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
