'use client';

/**
 * Choose a Live Photo's key photo by scrubbing its clip (issue #317).
 *
 * A `<video>` with no native controls over a filmstrip of about a dozen frames,
 * a draggable playhead, ‹ › and ←/→ frame stepping, and an **Original** marker
 * where the clip's key frame sits now (with **Reset** back to it). At that
 * position **Make Key Photo** does nothing new and is disabled; anywhere else a
 * line beside it says how the frame's resolution compares with the current
 * still, which is usually a large drop (a clip is ~1.6 MP, a still ~12 MP).
 *
 * In `apply` mode (the viewer's **Choose Key Photo**) the button writes the
 * change through `keyPhotoSession.ts`. In `pick` mode (the editor's **Key
 * Photo** tool) it hands the frame back so other edits can go on top; the
 * editor's Save then writes it through the same path.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Spinner, useToast } from '@neutrino/ui';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { KeyPhotoConflictError } from '@neutrino/api-photos/key-photo';
import { useUser } from '@neutrino/auth';
import { toRenderableImageBlob } from '@/lib/heic';
import { captureFrame, filmstrip, measureFrameDuration, megapixels, seekTo, FALLBACK_FRAME_SECONDS } from '@/lib/livePhotos/keyFrame';
import {
  changeKeyPhoto,
  loadKeyPhotoFiles,
  revertToOriginalKeyPhoto,
  CLIP_NOT_UPDATED_WARNING,
  type ChosenImage,
  type KeyPhotoFiles,
} from './keyPhotoSession';
import type { KeyPhotoTarget } from './useKeyPhotoTarget';
import styles from './KeyPhotoDialog.module.css';

export interface PickedKeyFrame extends ChosenImage {
  seconds: number;
  /** An object URL of the frame, for the editor to paint; the editor revokes it. */
  url: string;
}

interface Props {
  open: boolean;
  target: KeyPhotoTarget;
  mode: 'apply' | 'pick';
  onClose: () => void;
  /** After a change or a revert has been written. */
  onChanged?: () => void;
  /** `pick` mode: the chosen frame. */
  onPicked?: (frame: PickedKeyFrame) => void;
}

/** Positions closer than this are the same frame. */
const SAME_FRAME_SECONDS = 0.004;

function failureMessage(err: unknown): string {
  if (err instanceof KeyPhotoConflictError) return err.message;
  const detail = err instanceof Error ? err.message : '';
  return detail ? `The key photo could not be changed. (${detail})` : 'The key photo could not be changed.';
}

export function KeyPhotoDialog({ open, target, mode, onClose, onChanged, onPicked }: Props) {
  const user = useUser();
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const [files, setFiles] = useState<KeyPhotoFiles | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [stillSize, setStillSize] = useState<{ width: number; height: number } | null>(null);
  const [frames, setFrames] = useState<Array<{ seconds: number; url: string }>>([]);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [frameStep, setFrameStep] = useState(FALLBACK_FRAME_SECONDS);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'saving' | 'reverting'>(null);
  const [error, setError] = useState<string | null>(null);

  const original = files?.currentStillImageTime ?? null;

  // ── Load both files once the dialog opens ────────────────────────────────
  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;
    let url: string | null = null;
    setLoadError(null);
    loadKeyPhotoFiles(target, user.id)
      .then(async (loaded) => {
        if (cancelled) return;
        setFiles(loaded);
        url = URL.createObjectURL(new Blob([loaded.clip.plain.slice().buffer as ArrayBuffer], { type: 'video/quicktime' }));
        setClipUrl(url);
        const fromRecord = target.photo?.metadata;
        if (fromRecord?.width && fromRecord?.height) {
          setStillSize({ width: fromRecord.width, height: fromRecord.height });
        } else {
          const renderable = await toRenderableImageBlob(new Blob([loaded.still.plain.slice().buffer as ArrayBuffer], { type: loaded.still.mimeType }));
          const bitmap = await createImageBitmap(renderable).catch(() => null);
          if (bitmap && !cancelled) setStillSize({ width: bitmap.width, height: bitmap.height });
          bitmap?.close();
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(failureMessage(err));
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, target, user?.id]);

  // ── Once the clip is decodable: duration, frame step, filmstrip, start at the original ──
  const onLoadedData = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !clipUrl) return;
    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    setFrameSize({ width: video.videoWidth, height: video.videoHeight });
    setFrameStep(await measureFrameDuration(video));
    setTime(await seekTo(video, original ?? 0));
    filmstrip(clipUrl).then(setFrames).catch(() => setFrames([]));
  }, [clipUrl, original]);

  const go = useCallback(async (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    setTime(await seekTo(video, seconds));
  }, []);

  const step = useCallback((direction: 1 | -1) => void go(time + direction * frameStep), [go, time, frameStep]);

  // ── Dragging the playhead along the filmstrip ────────────────────────────
  const seekFromPointer = useCallback(
    (clientX: number) => {
      const strip = stripRef.current;
      if (!strip || duration <= 0) return;
      const rect = strip.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      void go(ratio * duration);
    },
    [duration, go],
  );

  const atOriginal = original !== null && Math.abs(time - original) < Math.max(SAME_FRAME_SECONDS, frameStep / 2);
  const ready = files !== null && frameSize !== null && duration > 0;

  const warning = useMemo(() => {
    if (!frameSize || !stillSize || atOriginal) return null;
    return `This frame is ${megapixels(frameSize.width, frameSize.height)}. The current key photo is ${megapixels(stillSize.width, stillSize.height)}.`;
  }, [frameSize, stillSize, atOriginal]);

  // ── Make Key Photo / Revert ──────────────────────────────────────────────
  const makeKeyPhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !files || !user?.id) return;
    setError(null);
    try {
      const image = await captureFrame(video);
      if (mode === 'pick') {
        const url = URL.createObjectURL(new Blob([image.jpeg.slice().buffer as ArrayBuffer], { type: 'image/jpeg' }));
        onPicked?.({ ...image, seconds: time, url });
        onClose();
        return;
      }
      setBusy('saving');
      const outcome = await changeKeyPhoto(target, user.id, image, time, files);
      if (!outcome.clipRewritten) toast.warning(CLIP_NOT_UPDATED_WARNING);
      else toast.success('Key photo changed');
      onChanged?.();
      onClose();
    } catch (err) {
      console.error('[photos:keyPhoto] change failed', err);
      setError(failureMessage(err));
    } finally {
      setBusy(null);
    }
  }, [files, user?.id, mode, time, target, onPicked, onClose, onChanged, toast]);

  const revert = useCallback(async () => {
    if (!files || !user?.id) return;
    setError(null);
    setBusy('reverting');
    try {
      await revertToOriginalKeyPhoto(target, user.id, files);
      toast.success('Original key photo restored');
      onChanged?.();
      onClose();
    } catch (err) {
      console.error('[photos:keyPhoto] revert failed', err);
      setError(failureMessage(err));
    } finally {
      setBusy(null);
    }
  }, [files, user?.id, target, toast, onChanged, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (busy || !ready) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
    }
  };

  const percent = (seconds: number) => `${duration > 0 ? (seconds / duration) * 100 : 0}%`;

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="Choose Key Photo" size="lg">
      <div className={styles.body} onKeyDown={onKeyDown}>
        {loadError ? (
          <p className={styles.error} role="alert">{loadError}</p>
        ) : !clipUrl ? (
          <div className={styles.loading}><Spinner size="lg" /></div>
        ) : (
          <>
            <div className={styles.stage}>
              <video
                ref={videoRef}
                className={styles.video}
                src={clipUrl}
                muted
                playsInline
                preload="auto"
                onLoadedData={() => void onLoadedData()}
                aria-label="Live Photo clip"
              />
            </div>

            <div
              ref={stripRef}
              className={styles.strip}
              role="slider"
              tabIndex={0}
              aria-label="Key photo position"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration * 1000) / 1000}
              aria-valuenow={Math.round(time * 1000) / 1000}
              aria-valuetext={`${time.toFixed(2)} seconds`}
              onPointerDown={(e) => {
                draggingRef.current = true;
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                seekFromPointer(e.clientX);
              }}
              onPointerMove={(e) => draggingRef.current && seekFromPointer(e.clientX)}
              onPointerUp={() => (draggingRef.current = false)}
              onPointerCancel={() => (draggingRef.current = false)}
            >
              <div className={styles.frames} aria-hidden="true">
                {frames.map((f) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={f.seconds} src={f.url} alt="" draggable={false} />
                ))}
              </div>
              {original !== null && duration > 0 && (
                <div className={styles.originalMarker} style={{ left: percent(original) }}>
                  <span>Original</span>
                </div>
              )}
              {duration > 0 && <div className={styles.playhead} style={{ left: percent(time) }} aria-hidden="true" />}
            </div>

            <div className={styles.controls}>
              <Button variant="ghost" size="sm" icon={<ChevronLeft size={16} />} aria-label="Previous frame" onClick={() => step(-1)} disabled={!ready || !!busy} />
              <span className={styles.time}>{time.toFixed(2)} s</span>
              <Button variant="ghost" size="sm" icon={<ChevronRight size={16} />} aria-label="Next frame" onClick={() => step(1)} disabled={!ready || !!busy} />
              {original !== null && (
                <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={() => void go(original)} disabled={!ready || !!busy || atOriginal}>
                  Reset
                </Button>
              )}
            </div>
          </>
        )}

        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.footer}>
          {mode === 'apply' && target.keyPhoto && (
            <Button variant="secondary" onClick={() => void revert()} disabled={!files || !!busy} loading={busy === 'reverting'}>
              Revert to Original Key Photo
            </Button>
          )}
          <span className={styles.spacer} />
          {warning && <span className={styles.warning}>{warning}</span>}
          <Button variant="ghost" onClick={onClose} disabled={!!busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void makeKeyPhoto()} disabled={!ready || !!busy || atOriginal} loading={busy === 'saving'}>
            Make Key Photo
          </Button>
        </div>
      </div>
    </Modal>
  );
}
