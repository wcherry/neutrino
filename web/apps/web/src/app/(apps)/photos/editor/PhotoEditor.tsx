'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Spinner, ZoomSlider, AlertDialog } from '@neutrino/ui';
import type { Background } from '@neutrino/ui';
import { useToast } from '@neutrino/ui';
import { useAuth } from '@neutrino/auth';
import { storageApi, filesystemApi, encryptionApi } from '@neutrino/api-drive';
import { photosAiApi, type DetectedObject } from '@neutrino/api-photos';
import type { SmartEraseTarget } from '@neutrino/api-photos';
import { initSodium, loadKeyPair, decryptFileKey, decryptFile } from '@neutrino/e2e-crypto';
import { PhotoTopBar } from './PhotoTopBar';
import { PhotoToolbar } from './PhotoToolbar';
import { AdjustmentsPanel } from './AdjustmentsPanel';
import { PhotoCanvas, type PhotoCanvasHandle } from './PhotoCanvas';
import type { Tool, Adjustments, CropRect, MarkupStroke, PhotoFilter, CloneStampSettings, TextSettings, StrokeSettings, AreaSelection } from './types';
import { DEFAULT_ADJUSTMENTS, DEFAULT_CLONE_SETTINGS, DEFAULT_TEXT_SETTINGS, DEFAULT_STROKE_SETTINGS } from './types';
import styles from './page.module.css';

// ── AI image prep ────────────────────────────────────────────────────────────

async function resizeForAi(blob: Blob, maxPx = 1536): Promise<{ base64: string; mediaType: string }> {
  const url = URL.createObjectURL(blob);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
    i.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img load failed')); };
    i.src = url;
  });
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { base64: dataUrl.split(',')[1] ?? '', mediaType: 'image/jpeg' };
}

// ── Canvas fill helpers ───────────────────────────────────────────────────────

function splitGradArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseCssGradient(
  ctx: CanvasRenderingContext2D,
  css: string,
  width: number,
  height: number,
): CanvasGradient | null {
  const lin = css.match(/^linear-gradient\((.+)\)$/is);
  const rad = css.match(/^radial-gradient\((.+)\)$/is);

  const parseStops = (parts: string[], startIdx: number) =>
    parts.slice(startIdx).flatMap((p) => {
      const m = p.trim().match(/^(#[0-9a-fA-F]{3,8})\s+(\d+(?:\.\d+)?)%$/);
      return m ? [{ color: m[1], position: parseFloat(m[2]) / 100 }] : [];
    });

  if (lin) {
    const parts = splitGradArgs(lin[1]);
    let angleDeg = 135, startIdx = 0;
    const degM = parts[0]?.trim().match(/^(-?\d+(?:\.\d+)?)deg$/i);
    if (degM) { angleDeg = parseFloat(degM[1]); startIdx = 1; }
    const stops = parseStops(parts, startIdx);
    if (stops.length < 2) return null;
    const r = (angleDeg * Math.PI) / 180;
    const dx = Math.sin(r), dy = -Math.cos(r);
    const half = Math.sqrt(width * width + height * height) / 2;
    const grad = ctx.createLinearGradient(
      width / 2 - dx * half, height / 2 - dy * half,
      width / 2 + dx * half, height / 2 + dy * half,
    );
    for (const s of stops) grad.addColorStop(s.position, s.color);
    return grad;
  }

  if (rad) {
    const parts = splitGradArgs(rad[1]);
    const startIdx = /^circle/i.test(parts[0]?.trim() ?? '') ? 1 : 0;
    const stops = parseStops(parts, startIdx);
    if (stops.length < 2) return null;
    const r = Math.sqrt((width / 2) ** 2 + (height / 2) ** 2);
    const grad = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, r);
    for (const s of stops) grad.addColorStop(s.position, s.color);
    return grad;
  }

  return null;
}

async function applyBackgroundFill(
  ctx: CanvasRenderingContext2D,
  fill: Background,
  width: number,
  height: number,
): Promise<void> {
  if (fill.type === 'color') {
    ctx.fillStyle = fill.value;
    ctx.fillRect(0, 0, width, height);
    return;
  }

  if (fill.type === 'gradient') {
    ctx.fillStyle = parseCssGradient(ctx, fill.value, width, height) ?? '#ffffff';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  // image type — draw with objectFit semantics
  await new Promise<void>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve();
    img.onload = () => {
      const fit = fill.objectFit ?? 'cover';
      if (fit === 'fill') {
        ctx.drawImage(img, 0, 0, width, height);
      } else if (fit === 'cover') {
        const imgAspect = img.width / img.height;
        const canvasAspect = width / height;
        let sw = img.width, sh = img.height, sx = 0, sy = 0;
        if (imgAspect > canvasAspect) { sw = sh * canvasAspect; sx = (img.width - sw) / 2; }
        else { sh = sw / canvasAspect; sy = (img.height - sh) / 2; }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
      } else {
        // contain
        const imgAspect = img.width / img.height;
        const canvasAspect = width / height;
        let dw = width, dh = height, dx = 0, dy = 0;
        if (imgAspect > canvasAspect) { dh = width / imgAspect; dy = (height - dh) / 2; }
        else { dw = height * imgAspect; dx = (width - dw) / 2; }
        ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh);
      }
      resolve();
    };
    img.src = fill.value;
  });
}

export function PhotoEditor() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();
  const { user: currentUser } = useAuth();

  const fileId = searchParams.get('fileId');

  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileName, setFileName] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [activeTool, setActiveTool] = useState<Tool>('select');
  const [panelTab, setPanelTab] = useState('filters');
  const [selectedStrokeIds, setSelectedStrokeIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedStrokeIds([]);
    setAreaSelection(null);
    if (
      activeTool === 'clone' || activeTool === 'blur' || activeTool === 'pixelate' || activeTool === 'text' ||
      activeTool === 'pen' || activeTool === 'highlighter' || activeTool === 'arrow' ||
      activeTool === 'rectangle' || activeTool === 'circle' || activeTool === 'line'
    ) {
      setPanelTab('tools');
    }
  }, [activeTool]);

  const [adjustments, setAdjustments] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [markupStrokes, setMarkupStrokes] = useState<MarkupStroke[]>([]);

  // Phase 2
  const [photoFilter, setPhotoFilter] = useState<PhotoFilter>('none');
  const [bgReplaceFill, setBgReplaceFill] = useState<Background>({ type: 'color', value: '#ffffff' });
  const [cloneSettings, setCloneSettings] = useState<CloneStampSettings>(DEFAULT_CLONE_SETTINGS);
  const [textSettings, setTextSettings] = useState<TextSettings>(DEFAULT_TEXT_SETTINGS);
  const [strokeSettings, setStrokeSettings] = useState<StrokeSettings>(DEFAULT_STROKE_SETTINGS);

  const [zoom, setZoom] = useState(100);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [areaSelection, setAreaSelection] = useState<AreaSelection | null>(null);
  const [edgeMask, setEdgeMask] = useState<ImageData | null>(null);
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[] | null>(null);

  const [confirmDialog, setConfirmDialog] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null);

  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const canvasRef = useRef<PhotoCanvasHandle>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);

  // Load and decrypt image from drive
  useEffect(() => {
    if (!fileId) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load() {
      try {
        await initSodium();

        const [blob, meta] = await Promise.all([
          storageApi.downloadFile(fileId!),
          storageApi.getFileMetadata(fileId!),
        ]);
        if (cancelled) return;

        setFileName(meta.name);
        setFolderId(meta.folderId);

        const mimeType = meta.mimeType?.startsWith('image/') ? meta.mimeType : 'image/png';

        let imageBlob: Blob;
        const kp = currentUser?.id ? loadKeyPair(currentUser.id) : null;
        if (kp) {
          try {
            const keyRef = await encryptionApi.getFileKey(fileId!);
            if (cancelled) return;
            if (keyRef) {
              const dek = decryptFileKey(keyRef.encryptedFileKey, kp.publicKey, kp.secretKey);
              const cipherBytes = new Uint8Array(await blob.arrayBuffer());
              const plainBytes = decryptFile(cipherBytes, dek);
              imageBlob = new Blob([plainBytes.buffer as ArrayBuffer], { type: mimeType });
            } else {
              imageBlob = new Blob([blob], { type: mimeType });
            }
          } catch {
            imageBlob = new Blob([blob], { type: mimeType });
          }
        } else {
          imageBlob = new Blob([blob], { type: mimeType });
        }

        if (cancelled) return;

        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(imageBlob);
        objectUrlRef.current = url;
        setImageDataUrl(url);
        setPanOffset({ x: 0, y: 0 });
        setLoading(false);
        appliedStateRef.current = {
          imageDataUrl: url,
          adjustments: DEFAULT_ADJUSTMENTS,
          rotation: 0,
          flipH: false,
          flipV: false,
          cropRect: null,
          photoFilter: 'none',
          markupStrokes: [],
        };
      } catch {
        if (!cancelled) {
          setLoadError('Failed to load image');
          setLoading(false);
          // DO NOT autosave — leave state empty on error
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [fileId, currentUser?.id]);

  type EditorSnapshot = {
    imageDataUrl: string | null;
    adjustments: Adjustments;
    rotation: 0 | 90 | 180 | 270;
    flipH: boolean;
    flipV: boolean;
    cropRect: CropRect | null;
    photoFilter: PhotoFilter;
    markupStrokes: MarkupStroke[];
  };

  // Tracks the last "applied" editor state so Revert can restore it.
  // Updated on explicit Apply or automatically before any destructive AI op.
  const appliedStateRef = useRef<EditorSnapshot>({
    imageDataUrl: null,
    adjustments: DEFAULT_ADJUSTMENTS,
    rotation: 0,
    flipH: false,
    flipV: false,
    cropRect: null,
    photoFilter: 'none',
    markupStrokes: [],
  });

  // Always-current ref so stable callbacks can read latest state without deps.
  const currentStateRef = useRef<EditorSnapshot>({
    imageDataUrl, adjustments, rotation, flipH, flipV, cropRect, photoFilter, markupStrokes,
  });
  currentStateRef.current = { imageDataUrl, adjustments, rotation, flipH, flipV, cropRect, photoFilter, markupStrokes };

  const handleSave = useCallback(async () => {
    if (!canvasRef.current || !fileId) return;
    setIsSaving(true);
    try {
      const blob = await canvasRef.current.getExportBlob();
      const file = new File([blob], fileName || 'photo.png', { type: 'image/png' });
      await storageApi.uploadFile(file, undefined, folderId ?? null);
      toastSuccess('Saved');
      setIsDirty(false);
    } catch {
      toastError('Failed to save');
    } finally {
      setIsSaving(false);
    }
  }, [fileId, fileName, folderId, toastSuccess, toastError]);

  const handleRename = useCallback(async (name: string) => {
    setFileName(name);
    if (!fileId) return;
    try {
      await filesystemApi.updateFile(fileId, { name });
    } catch {
      toastError('Failed to rename file');
    }
  }, [fileId, toastError]);

  const handleDuplicate = useCallback(async () => {
    if (!canvasRef.current) return;
    try {
      const blob = await canvasRef.current.getExportBlob();
      const baseName = (fileName || 'photo').replace(/\.[^.]+$/, '');
      const dupName = `Copy of ${baseName}.png`;
      const file = new File([blob], dupName, { type: 'image/png' });
      await storageApi.uploadFile(file, undefined, folderId ?? null);
      toastSuccess(`Saved as "${dupName}"`);
    } catch {
      toastError('Failed to duplicate');
    }
  }, [fileName, folderId, toastSuccess, toastError]);

  const handleExport = useCallback(async () => {
    if (!canvasRef.current) return;
    const blob = await canvasRef.current.getExportBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'export.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [fileName]);

  const handleAdjustmentChange = useCallback((key: keyof Adjustments, value: number) => {
    setAdjustments((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }, []);

  const handleRotateLeft = useCallback(() => {
    setRotation((prev) => (((prev - 90 + 360) % 360) as 0 | 90 | 180 | 270));
    setIsDirty(true);
  }, []);

  const handleRotateRight = useCallback(() => {
    setRotation((prev) => (((prev + 90) % 360) as 0 | 90 | 180 | 270));
    setIsDirty(true);
  }, []);

  const handleFlipH = useCallback(() => {
    setFlipH((prev) => !prev);
    setIsDirty(true);
  }, []);

  const handleFlipV = useCallback(() => {
    setFlipV((prev) => !prev);
    setIsDirty(true);
  }, []);

  const handleResetAdjustments = useCallback(() => {
    setAdjustments(DEFAULT_ADJUSTMENTS);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setCropRect(null);
    setPhotoFilter('none');
    setIsDirty(true);
  }, []);

  const handleApply = useCallback(() => {
    appliedStateRef.current = { ...currentStateRef.current };
    setIsDirty(true);
  }, []);

  const handleRevert = useCallback(() => {
    const s = appliedStateRef.current;
    setImageDataUrl(s.imageDataUrl);
    setAdjustments(s.adjustments);
    setRotation(s.rotation);
    setFlipH(s.flipH);
    setFlipV(s.flipV);
    setCropRect(s.cropRect);
    setPhotoFilter(s.photoFilter);
    setMarkupStrokes(s.markupStrokes);
    setIsDirty(true);
  }, []);

  const handleAutoEnhance = useCallback(async () => {
    if (!canvasRef.current) return;
    const blob = await canvasRef.current.getExportBlob();
    const img = await createImageBitmap(blob);
    const tmp = document.createElement('canvas');
    tmp.width = img.width;
    tmp.height = img.height;
    const ctx = tmp.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);

    let sumL = 0, sumR = 0, sumG = 0, sumB = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
      sumL += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    const avgL = sumL / n;
    const avgR = sumR / n;
    const avgG = sumG / n;
    const avgB = sumB / n;

    // Brightness: target 128, clamp adjustment to ±60
    const brightness = Math.round(Math.max(-60, Math.min(60, (128 - avgL) * 0.5)));

    // Contrast: measure std-dev of luminance
    let sumDev = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sumDev += (l - avgL) ** 2;
    }
    const stdDev = Math.sqrt(sumDev / n);
    // Low contrast (stdDev < 50) → boost; high (> 80) → leave alone
    const contrast = Math.round(Math.max(0, Math.min(40, (50 - stdDev) * 0.6)));

    // Saturation: estimate from distance of channels from gray
    const colorfulness = Math.sqrt(
      (avgR - avgG) ** 2 + (avgG - avgB) ** 2 + (avgB - avgR) ** 2,
    ) / Math.sqrt(2);
    const saturation = Math.round(Math.max(0, Math.min(40, (30 - colorfulness) * 0.6)));

    handleApply();
    setAdjustments((prev) => ({ ...prev, brightness, contrast, saturation }));
    setIsDirty(true);
    toastSuccess('Photo enhanced');
  }, [handleApply, toastSuccess]);

  const handleOcr = useCallback(async (): Promise<string> => {
    if (!canvasRef.current) throw new Error('no canvas');
    const blob = await canvasRef.current.getExportBlob();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return photosAiApi.ocr(base64, 'image/png');
  }, []);

  const handleScreenshotIntel = useCallback(
    async (outputType: 'table' | 'document' | 'diagram'): Promise<string> => {
      if (!canvasRef.current) throw new Error('no canvas');
      const blob = await canvasRef.current.getExportBlob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return photosAiApi.screenshotIntel(base64, outputType, 'image/png');
    },
    [],
  );

  const handleStrokeAdd = useCallback((stroke: MarkupStroke) => {
    setMarkupStrokes((prev) => [...prev, stroke]);
    setIsDirty(true);
  }, []);

  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedStrokeIds(ids);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedStrokeIds.length === 0) return;
    setMarkupStrokes((prev) => prev.filter((s) => !selectedStrokeIds.includes(s.id)));
    setSelectedStrokeIds([]);
    setIsDirty(true);
  }, [selectedStrokeIds]);

  const [clipboardStrokes, setClipboardStrokes] = useState<MarkupStroke[]>([]);

  const handleCopy = useCallback(() => {
    const copied = markupStrokes.filter((s) => selectedStrokeIds.includes(s.id));
    setClipboardStrokes(copied);
  }, [markupStrokes, selectedStrokeIds]);

  const handleCut = useCallback(() => {
    const copied = markupStrokes.filter((s) => selectedStrokeIds.includes(s.id));
    setClipboardStrokes(copied);
    setMarkupStrokes((prev) => prev.filter((s) => !selectedStrokeIds.includes(s.id)));
    setSelectedStrokeIds([]);
    setIsDirty(true);
  }, [markupStrokes, selectedStrokeIds]);

  const handlePaste = useCallback(() => {
    if (clipboardStrokes.length === 0) return;
    const offset = 16;
    const pasted = clipboardStrokes.map((s) => ({
      ...s,
      id: `${Date.now()}-${Math.random()}`,
      points: s.points.map((p) => ({ x: p.x + offset, y: p.y + offset })),
      ...(s.cloneSource ? { cloneSource: { x: s.cloneSource.x + offset, y: s.cloneSource.y + offset } } : {}),
    }));
    setMarkupStrokes((prev) => [...prev, ...pasted]);
    setSelectedStrokeIds(pasted.map((s) => s.id));
    setIsDirty(true);
  }, [clipboardStrokes]);

  const handleCropChange = useCallback((rect: CropRect | null) => {
    setCropRect(rect);
    setActiveTool('select');
    setIsDirty(true);
  }, []);

  const handleFilterChange = useCallback((filter: PhotoFilter) => {
    setPhotoFilter(filter);
    setIsDirty(true);
  }, []);

  const removeBgFromBlob = useCallback(async (blob: Blob, fill?: Background): Promise<string> => {
    const srcUrl = URL.createObjectURL(blob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onerror = () => { URL.revokeObjectURL(srcUrl); reject(new Error('img load failed')); };
      i.onload = () => { URL.revokeObjectURL(srcUrl); resolve(i); };
      i.src = srcUrl;
    });

    const width = img.naturalWidth;
    const height = img.naturalHeight;

    const tmp = document.createElement('canvas');
    tmp.width = width;
    tmp.height = height;
    const ctx = tmp.getContext('2d');
    if (!ctx) throw new Error('no ctx');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, width, height);

    // Sample the 4 corners to estimate the background colour
    const corners: [number, number][] = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
    let sr = 0, sg = 0, sb = 0;
    for (const [cx, cy] of corners) {
      const i = (cy * width + cx) * 4;
      sr += data[i]; sg += data[i + 1]; sb += data[i + 2];
    }
    sr /= 4; sg /= 4; sb /= 4;

    const tolerance = 80;
    for (let i = 0; i < data.length; i += 4) {
      const dr = data[i] - sr;
      const dg = data[i + 1] - sg;
      const db = data[i + 2] - sb;
      if (Math.sqrt(dr * dr + dg * dg + db * db) < tolerance) {
        data[i + 3] = 0;
      }
    }

    const imageData = new ImageData(data, width, height);
    const fgCanvas = document.createElement('canvas');
    fgCanvas.width = width;
    fgCanvas.height = height;
    fgCanvas.getContext('2d')!.putImageData(imageData, 0, 0);

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const outCtx = out.getContext('2d')!;

    if (fill) await applyBackgroundFill(outCtx, fill, width, height);
    outCtx.drawImage(fgCanvas, 0, 0);

    return out.toDataURL('image/png');
  }, []);

  const handleRemoveBackground = useCallback(() => {
    if (!canvasRef.current) return;
    setConfirmDialog({
      title: 'Remove background',
      description: 'This will flatten the image. Use Revert to undo.',
      onConfirm: async () => {
        if (!canvasRef.current) return;
        try {
          handleApply();
          const blob = await canvasRef.current.getExportBlob();
          const dataUrl = await removeBgFromBlob(blob);
          setImageDataUrl(dataUrl);
          setAdjustments(DEFAULT_ADJUSTMENTS);
          setRotation(0);
          setFlipH(false);
          setFlipV(false);
          setCropRect(null);
          setMarkupStrokes([]);
          setPhotoFilter('none');
          setIsDirty(true);
          toastSuccess('Background removed');
        } catch {
          toastError('Background removal failed');
        }
      },
    });
  }, [handleApply, removeBgFromBlob, toastSuccess, toastError]);

  const handleReplaceBackground = useCallback((fill: Background) => {
    if (!canvasRef.current) return;
    setConfirmDialog({
      title: 'Replace background',
      description: 'This will flatten the image. Use Revert to undo.',
      onConfirm: async () => {
        if (!canvasRef.current) return;
        try {
          handleApply();
          const blob = await canvasRef.current.getExportBlob();
          const dataUrl = await removeBgFromBlob(blob, fill);
          setImageDataUrl(dataUrl);
          setAdjustments(DEFAULT_ADJUSTMENTS);
          setRotation(0);
          setFlipH(false);
          setFlipV(false);
          setCropRect(null);
          setMarkupStrokes([]);
          setPhotoFilter('none');
          setIsDirty(true);
          toastSuccess('Background replaced');
        } catch {
          toastError('Background replacement failed');
        }
      },
    });
  }, [handleApply, removeBgFromBlob, toastSuccess, toastError]);

  // Drag-and-drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(reader.result as string);
      setIsDirty(true);
    };
    reader.readAsDataURL(file);
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const handleAreaSelect = useCallback((rect: AreaSelection | null) => {
    setAreaSelection(rect);
    setEdgeMask(null);
    setDetectedObjects(null);
    if (rect) setPanelTab('ai');
  }, []);

  const handleAreaOp = useCallback((op: 'blur' | 'pixelate' | 'fill') => {
    if (!canvasRef.current || !areaSelection) return;
    try {
      handleApply();
      const dataUrl = canvasRef.current.applyBaseRegionOp(areaSelection, op);
      setImageDataUrl(dataUrl);
      setAdjustments(DEFAULT_ADJUSTMENTS);
      setRotation(0);
      setFlipH(false);
      setFlipV(false);
      setCropRect(null);
      setPhotoFilter('none');
      setAreaSelection(null);
      setEdgeMask(null);
      setDetectedObjects(null);
      setIsDirty(true);
    } catch {
      toastError('Region operation failed');
    }
  }, [areaSelection, handleApply, toastError]);

  const handleSmartErase = useCallback(async (target: SmartEraseTarget) => {
    if (!canvasRef.current) return;
    try {
      const blob = await canvasRef.current.getExportBlob();
      const { base64, mediaType } = await resizeForAi(blob);
      const objects = await photosAiApi.detectObjects(base64, target, mediaType);
      setDetectedObjects(objects);
      setPanelTab('ai');
    } catch {
      toastError('Object detection failed');
    }
  }, [toastError]);

  const handleRemoveObjects = useCallback(() => {
    if (!canvasRef.current || !detectedObjects || detectedObjects.length === 0) return;
    setConfirmDialog({
      title: 'Remove objects',
      description: 'This will flatten the image. Use Revert to undo.',
      onConfirm: () => {
        if (!canvasRef.current || !detectedObjects) return;
        try {
          handleApply();
          const dataUrl = canvasRef.current.eraseObjects(detectedObjects);
          setImageDataUrl(dataUrl);
          setAdjustments(DEFAULT_ADJUSTMENTS);
          setRotation(0);
          setFlipH(false);
          setFlipV(false);
          setCropRect(null);
          setMarkupStrokes([]);
          setPhotoFilter('none');
          setDetectedObjects(null);
          setAreaSelection(null);
          setIsDirty(true);
          toastSuccess(`${detectedObjects.length} object${detectedObjects.length !== 1 ? 's' : ''} removed`);
        } catch {
          toastError('Object removal failed');
        }
      },
    });
  }, [detectedObjects, handleApply, toastSuccess, toastError]);

  // Two-finger pan + pinch-to-zoom — non-passive wheel listener on window so it
  // works regardless of the loading state when this effect first runs.
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      const el = canvasAreaRef.current;
      if (!el || !el.contains(e.target as Node)) return;
      e.preventDefault();
      if (e.ctrlKey) {
        // Pinch gesture — zoom in/out toward cursor
        setZoom((prev) => {
          const factor = Math.exp(-e.deltaY * 0.004);
          return Math.round(Math.max(10, Math.min(400, prev * factor)));
        });
      } else {
        // Two-finger drag — pan
        setPanOffset((prev) => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
      }
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  // Delete selected strokes
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setAreaSelection(null);
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      handleDeleteSelected();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleDeleteSelected]);

  // Clipboard paste
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const item = e.clipboardData?.items[0];
      if (!item || !item.type.startsWith('image/')) return;
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        setImageDataUrl(reader.result as string);
        setIsDirty(true);
      };
      reader.readAsDataURL(file);
    }
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.errorState}>
        <p>{loadError}</p>
        <button onClick={() => router.back()} className={styles.backLink}>
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container} onDragOver={handleDragOver} onDrop={handleDrop}>
      <PhotoTopBar
        fileName={fileName}
        isDirty={isDirty}
        isSaving={isSaving}
        hasSelection={selectedStrokeIds.length > 0}
        hasClipboard={clipboardStrokes.length > 0}
        onBack={() => router.back()}
        onSave={handleSave}
        onDuplicate={handleDuplicate}
        onExport={handleExport}
        onCut={handleCut}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onDelete={handleDeleteSelected}
        onRename={handleRename}
      />
      <div className={styles.editorBody}>
        <PhotoToolbar activeTool={activeTool} onToolChange={setActiveTool} />
        <div className={styles.canvasArea} ref={canvasAreaRef}>
          <PhotoCanvas
            ref={canvasRef}
            imageDataUrl={imageDataUrl}
            adjustments={adjustments}
            rotation={rotation}
            flipH={flipH}
            flipV={flipV}
            cropRect={cropRect}
            photoFilter={photoFilter}
            activeTool={activeTool}
            markupStrokes={markupStrokes}
            zoom={zoom}
            panOffset={panOffset}
            cloneSettings={cloneSettings}
            textSettings={textSettings}
            strokeSettings={strokeSettings}
            selectedStrokeIds={selectedStrokeIds}
            areaSelection={areaSelection}
            edgeMask={edgeMask}
            detectedObjects={detectedObjects}
            onStrokeAdd={handleStrokeAdd}
            onCropChange={handleCropChange}
            onSelectionChange={handleSelectionChange}
            onAreaSelect={handleAreaSelect}
          />
          <div className={styles.zoomBar}>
            <ZoomSlider value={zoom} onChange={setZoom} min={10} max={400} step={25} sliderStep={1} showHandle />
          </div>
        </div>
        <AdjustmentsPanel
          adjustments={adjustments}
          rotation={rotation}
          flipH={flipH}
          flipV={flipV}
          photoFilter={photoFilter}
          bgReplaceFill={bgReplaceFill}
          activeTool={activeTool}
          cloneSettings={cloneSettings}
          textSettings={textSettings}
          activeTabId={panelTab}
          onTabChange={setPanelTab}
          onAdjustmentChange={handleAdjustmentChange}
          onRotateLeft={handleRotateLeft}
          onRotateRight={handleRotateRight}
          onFlipH={handleFlipH}
          onFlipV={handleFlipV}
          onResetAdjustments={handleResetAdjustments}
          onApply={handleApply}
          onRevert={handleRevert}
          onFilterChange={handleFilterChange}
          onRemoveBackground={handleRemoveBackground}
          onReplaceBackground={handleReplaceBackground}
          onBgReplaceFillChange={setBgReplaceFill}
          onCloneSettingsChange={setCloneSettings}
          onTextSettingsChange={setTextSettings}
          strokeSettings={strokeSettings}
          onStrokeSettingsChange={setStrokeSettings}
          onAutoEnhance={handleAutoEnhance}
          onOcr={handleOcr}
          onScreenshotIntel={handleScreenshotIntel}
          areaSelection={areaSelection}
          onAreaOp={handleAreaOp}
          onAreaClear={() => { setAreaSelection(null); setEdgeMask(null); setDetectedObjects(null); }}
          detectedObjects={detectedObjects}
          onSmartErase={handleSmartErase}
          onRemoveObjects={handleRemoveObjects}
          onSmartEraseClear={() => setDetectedObjects(null)}
        />
      </div>
      <AlertDialog
        open={confirmDialog !== null}
        onClose={() => setConfirmDialog(null)}
        title={confirmDialog?.title ?? ''}
        description={confirmDialog?.description}
        variant="warning"
        confirmLabel="Continue"
        onConfirm={() => {
          const action = confirmDialog?.onConfirm;
          setConfirmDialog(null);
          action?.();
        }}
      />
    </div>
  );
}
