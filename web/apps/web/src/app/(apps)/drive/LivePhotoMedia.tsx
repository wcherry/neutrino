'use client';

/**
 * Press and hold a Live Photo to loop its clip until release (issue #316).
 *
 * Drive shows a Live Photo as the two files it is, and this is the still half
 * drawn with its motion behind it: a LIVE badge, and a held press (250 ms, by
 * pointer or by Space) that fades the clip in over the still, plays it from the
 * start on a loop, and fades back the moment the press ends. A short click is
 * left alone, so a tile still opens and the preview still does nothing; a click
 * that ends a hold is swallowed so it does not *also* open the preview.
 *
 * "The press ends" is any of `pointerup`, `pointercancel` (a touch the browser
 * took over for a scroll), `pointerleave`, the window losing focus, or the tab
 * being hidden — a loop that outlives the gesture would be a clip playing with
 * nobody holding it.
 *
 * Sound follows user activation. A mouse `pointerdown` is activation, so a
 * desktop hold plays with sound; a touch only activates on release (`touchend`
 * / `pointerup`), which for a hold is when playback should *stop*, so touch and
 * pen start muted. Either way a refused `play()` is retried muted rather than
 * dropped.
 *
 * Bytes come from `lib/livePhotos/clipLoader.ts`, which decrypts (photos are
 * E2EE: a `<video>` at the content URL plays ciphertext and fails silently),
 * confirms a name-only match against the movie's own metadata, and remembers
 * the answer for the session. A clip that turns out not to be a Live Photo's
 * leaves a plain picture with no badge and no hold.
 */

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motionPhotoLabel } from '@neutrino/api-photos';
import { useKeyHandler } from '@neutrino/commands';
import { useUser } from '@neutrino/auth';
import { useSessionKeyPair } from '@/hooks/useSessionKeyPair';
import { clipVerdict, loadLiveClip, subscribeToClipVerdicts } from '@/lib/livePhotos/clipLoader';
import { clipKey, type LiveClip } from '@/lib/livePhotos/pairing';
import styles from './LivePhotoMedia.module.css';

/** How long a press must last to count as a hold rather than a click. */
export const HOLD_DELAY_MS = 250;

type InputKind = 'mouse' | 'touch' | 'pen' | 'keyboard';

export interface LivePhotoMediaProps {
  /** The still's Drive file id. */
  stillId: string;
  clip: LiveClip;
  /** The still to paint; null for a tile with no thumbnail yet. */
  src: string | null;
  alt: string;
  /** A grid card's preview box, or the preview modal's image. */
  variant: 'tile' | 'preview';
  /** The still's decrypted bytes, when the caller has them — saves a download for an embedded clip. */
  stillBlob?: Blob | null;
  /** Start fetching the clip on mount (the preview) rather than on the first press (a tile). */
  preload?: boolean;
  /** Extra class for the `<img>`, e.g. the preview's sizing. */
  imgClassName?: string;
  onImgError?: () => void;
  /** Drawn in place of the `<img>` when `src` is null. */
  fallback?: React.ReactNode;
}

function useClipVerdict(key: string): boolean | undefined {
  return useSyncExternalStore(
    subscribeToClipVerdicts,
    () => clipVerdict(key),
    () => undefined,
  );
}

export function LivePhotoMedia({
  stillId,
  clip,
  src,
  alt,
  variant,
  stillBlob = null,
  preload = false,
  imgClassName,
  onImgError,
  fallback,
}: LivePhotoMediaProps) {
  const user = useUser();
  const keyPair = useSessionKeyPair(user?.id);
  const key = clipKey(stillId, clip);
  const verdict = useClipVerdict(key);
  // A clip something already vouches for is live until its bytes say otherwise;
  // a name-only match is live once its bytes say so.
  const isLive = clip.confirmed ? verdict !== false : verdict === true;
  const holdable = verdict !== false;

  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [held, setHeld] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const urlRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const heldRef = useRef(false);
  const suppressClickRef = useRef(false);
  const inputRef = useRef<InputKind>('mouse');
  // A ref, not effect-local: the listener below re-subscribes whenever its
  // callbacks change, and a Space held across that must still end on keyup.
  const spaceDownRef = useRef(false);

  // ── Loading ────────────────────────────────────────────────────────────────
  const ensureLoaded = useCallback(() => {
    if (urlRef.current || loadingRef.current || !user?.id || !holdable) return;
    loadingRef.current = true;
    setLoading(true);
    loadLiveClip(stillId, clip, { userId: user.id, unlocked: keyPair !== null, stillBlob })
      .then((blob) => {
        if (!blob || !mountedRef.current) return;
        const objectUrl = URL.createObjectURL(blob);
        urlRef.current = objectUrl;
        setUrl(objectUrl);
      })
      .catch((err) => {
        // The still stays; the next press tries again.
        console.warn('[drive] Live Photo clip could not be loaded', err);
      })
      .finally(() => {
        loadingRef.current = false;
        if (mountedRef.current) setLoading(false);
      });
  }, [stillId, clip, user?.id, keyPair, stillBlob, holdable]);

  useEffect(() => {
    if (preload) ensureLoaded();
  }, [preload, ensureLoaded]);

  // The object URL lives as long as the tile or the modal does.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, []);

  // ── The hold ───────────────────────────────────────────────────────────────
  const begin = useCallback(
    (kind: InputKind) => {
      if (!holdable || timerRef.current !== null || heldRef.current) return;
      inputRef.current = kind;
      // A new press: whatever an earlier hold left armed is stale.
      suppressClickRef.current = false;
      ensureLoaded();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        heldRef.current = true;
        // Only a pointer hold is followed by a click; a Space hold is not, and
        // arming it then would eat the next real click.
        suppressClickRef.current = kind !== 'keyboard';
        setHeld(true);
      }, HOLD_DELAY_MS);
    },
    [holdable, ensureLoaded],
  );

  /** Ends the press. True when it had become a hold. */
  const end = useCallback((): boolean => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!heldRef.current) return false;
    heldRef.current = false;
    setHeld(false);
    // The click that follows a released hold arrives in the same task and is
    // swallowed below; a hold that ended any other way has no click coming.
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 400);
    return true;
  }, []);

  // Focus or visibility lost mid-hold is a release.
  useEffect(() => {
    const onBlur = () => end();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') end();
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [end]);

  // Space on the focused image (preview) or card (tile), or on the badge.
  // Keydown is taken in the capture phase, before it reaches the card, because
  // `FileGrid` opens a file on Space keydown; for a Live Photo a short press
  // still opens it, on keyup, once it is known not to have been a hold.
  const keyTarget = (): HTMLElement | null => {
    const root = rootRef.current;
    if (!root) return null;
    return variant === 'tile' ? (root.closest<HTMLElement>('[role="listitem"]') ?? root) : root;
  };
  useKeyHandler(
    (e) => {
      if (e.key !== ' ') return;
      const target = keyTarget();
      if (!target || (e.target !== target && e.target !== badgeRef.current)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || spaceDownRef.current) return;
      spaceDownRef.current = true;
      begin('keyboard');
    },
    { type: 'keydown', phase: 'capture', enabled: holdable },
  );
  useKeyHandler(
    (e) => {
      if (e.key !== ' ' || !spaceDownRef.current) return;
      spaceDownRef.current = false;
      // Also stops the badge button's own Space-on-keyup click.
      e.preventDefault();
      const wasHold = end();
      const target = keyTarget();
      if (!wasHold && variant === 'tile' && target && e.target === target) target.click();
    },
    { type: 'keyup', enabled: holdable },
  );

  // ── Playback ───────────────────────────────────────────────────────────────
  const playing = held && url !== null;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!playing) {
      video.pause();
      return;
    }
    video.currentTime = 0;
    video.muted = inputRef.current === 'touch' || inputRef.current === 'pen';
    video
      .play()
      .catch(() => {
        // Refused with sound (no activation reached us): play it silent.
        video.muted = true;
        return video.play();
      })
      .catch(() => {});
  }, [playing]);

  // ── Rendering ──────────────────────────────────────────────────────────────
  const handlers: React.HTMLAttributes<HTMLDivElement> = holdable
    ? {
        onPointerDown: (e) => {
          // Primary pointer, main button. Written to tolerate an event that
          // lacks the fields (some embedders synthesise plain events).
          if (e.isPrimary === false || (e.button ?? 0) !== 0) return;
          begin(e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse');
        },
        onPointerUp: () => {
          end();
        },
        onPointerCancel: () => {
          end();
        },
        onPointerLeave: () => {
          end();
        },
        onClickCapture: (e) => {
          if (!suppressClickRef.current) return;
          suppressClickRef.current = false;
          e.preventDefault();
          e.stopPropagation();
        },
        // Android Chrome's long-press menu; Drive's own menu is not on long press.
        onContextMenu: (e) => e.preventDefault(),
        onDragStart: (e) => e.preventDefault(),
      }
    : {};

  const label = motionPhotoLabel(clip.subtype);
  const state = playing ? 'playing' : held ? 'waiting' : 'idle';

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${variant === 'tile' ? styles.tile : styles.preview}`}
      data-live-photo={isLive ? 'true' : undefined}
      data-live-state={state}
      tabIndex={variant === 'preview' && holdable ? 0 : undefined}
      aria-label={variant === 'preview' && isLive ? `${alt}. Hold Space to play the Live Photo.` : undefined}
      {...handlers}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          draggable={false}
          loading={variant === 'tile' ? 'lazy' : undefined}
          className={variant === 'tile' ? `${styles.tileImage} ${imgClassName ?? ''}` : imgClassName}
          onError={onImgError}
        />
      ) : (
        fallback
      )}

      {url && (
        <video
          ref={videoRef}
          className={styles.video}
          src={url}
          loop
          playsInline
          muted
          preload="auto"
          aria-hidden="true"
          data-playing={playing ? 'true' : 'false'}
        />
      )}

      {isLive && (
        <button
          ref={badgeRef}
          type="button"
          className={styles.badge}
          aria-label="Hold to play Live Photo"
          title={clip.subtype === 'motion_photo_google' ? 'Google Motion Photo' : 'Apple Live Photo'}
          // The hold is the root's; a click on the badge is a click on the picture.
        >
          <span className={styles.dot} data-loading={held && !url && loading ? 'true' : undefined} aria-hidden="true" />
          {label}
        </button>
      )}
    </div>
  );
}
