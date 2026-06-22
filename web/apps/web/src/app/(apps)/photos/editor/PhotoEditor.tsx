'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Spinner } from '@neutrino/ui';
import { useToast } from '@neutrino/ui';
import { storageApi } from '@neutrino/api-drive';
import { PhotoTopBar } from './PhotoTopBar';
import { PhotoToolbar } from './PhotoToolbar';
import { AdjustmentsPanel } from './AdjustmentsPanel';
import { PhotoCanvas, type PhotoCanvasHandle } from './PhotoCanvas';
import type { Tool, Adjustments, CropRect, MarkupStroke } from './types';
import { DEFAULT_ADJUSTMENTS } from './types';
import styles from './page.module.css';

export function PhotoEditor() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();

  const fileId = searchParams.get('fileId');

  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileName, setFileName] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);

  const [activeTool, setActiveTool] = useState<Tool>('select');
  const [adjustments, setAdjustments] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [markupStrokes, setMarkupStrokes] = useState<MarkupStroke[]>([]);

  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const canvasRef = useRef<PhotoCanvasHandle>(null);

  // Load image from drive
  useEffect(() => {
    if (!fileId) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load() {
      try {
        const [blob, meta] = await Promise.all([
          storageApi.downloadFile(fileId!),
          storageApi.getFileMetadata(fileId!),
        ]);
        if (cancelled) return;
        setFileName(meta.name);
        setFolderId(meta.folderId);
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        if (!cancelled) {
          setImageDataUrl(url);
          setLoading(false);
        }
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
  }, [fileId]);

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
    setIsDirty(true);
  }, []);

  const handleStrokeAdd = useCallback((stroke: MarkupStroke) => {
    setMarkupStrokes((prev) => [...prev, stroke]);
    setIsDirty(true);
  }, []);

  const handleCropChange = useCallback((rect: CropRect | null) => {
    setCropRect(rect);
    setActiveTool('select');
    setIsDirty(true);
  }, []);

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
        onBack={() => router.back()}
        onSave={handleSave}
        onExport={handleExport}
      />
      <div className={styles.editorBody}>
        <PhotoToolbar activeTool={activeTool} onToolChange={setActiveTool} />
        <div className={styles.canvasArea}>
          <PhotoCanvas
            ref={canvasRef}
            imageDataUrl={imageDataUrl}
            adjustments={adjustments}
            rotation={rotation}
            flipH={flipH}
            flipV={flipV}
            cropRect={cropRect}
            activeTool={activeTool}
            markupStrokes={markupStrokes}
            onStrokeAdd={handleStrokeAdd}
            onCropChange={handleCropChange}
          />
        </div>
        <AdjustmentsPanel
          adjustments={adjustments}
          rotation={rotation}
          flipH={flipH}
          flipV={flipV}
          onAdjustmentChange={handleAdjustmentChange}
          onRotateLeft={handleRotateLeft}
          onRotateRight={handleRotateRight}
          onFlipH={handleFlipH}
          onFlipV={handleFlipV}
          onResetAdjustments={handleResetAdjustments}
        />
      </div>
    </div>
  );
}
