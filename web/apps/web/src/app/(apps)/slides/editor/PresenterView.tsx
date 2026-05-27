'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { SlidePresentation } from './slideEditorTypes';
import { slideBackgroundStyle } from './slideEditorHelpers';
import { SlideRenderer } from './SlideRenderer';
import styles from './page.module.css';

interface PresenterViewProps {
  presentation: SlidePresentation;
  onExit: () => void;
}

// ── PresenterView ─────────────────────────────────────────────────────────────

export default function PresenterView({ presentation, onExit }: PresenterViewProps) {
  const [idx, setIdx] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const [showMirrorPrompt, setShowMirrorPrompt] = useState(false);
  const mirrorWindowRef = useRef<Window | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const idxRef = useRef(0);
  idxRef.current = idx;

  const slide = presentation.slides[idx];
  const total = presentation.slides.length;

  function next() {
    setIdx((i) => {
      const next = Math.min(total - 1, i + 1);
      if (next !== i) setAnimKey((k) => k + 1);
      return next;
    });
  }
  function prev() {
    setIdx((i) => {
      const next = Math.max(0, i - 1);
      if (next !== i) setAnimKey((k) => k + 1);
      return next;
    });
  }

  // Detect external monitors on mount
  useEffect(() => {
    // screen.isExtended requires no permission and no user gesture (Chrome 94+)
    if ('isExtended' in window.screen) {
      if ((window.screen as unknown as { isExtended: boolean }).isExtended) {
        console.log('[PresenterView] External display detected via screen.isExtended');
        setShowMirrorPrompt(true);
      } else {
        console.log('[PresenterView] screen.isExtended: single display only');
      }
      return;
    }
    // Fallback: getScreenDetails (requires user gesture in some browsers — may silently fail here)
    if ('getScreenDetails' in window) {
      (window as unknown as { getScreenDetails(): Promise<{ screens: Array<{ isPrimary: boolean }> }> })
        .getScreenDetails()
        .then((sd) => {
          if (sd.screens.length > 1) {
            console.log('[PresenterView] External display detected via getScreenDetails:', sd.screens);
            setShowMirrorPrompt(true);
          } else {
            console.log('[PresenterView] getScreenDetails: single display only');
          }
        })
        .catch(() => {
          console.log('[PresenterView] getScreenDetails unavailable or permission denied');
        });
    } else {
      console.log('[PresenterView] No multi-screen API available in this browser');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Broadcast slide changes to mirror window
  useEffect(() => {
    channelRef.current?.postMessage({ type: 'slide', slideIndex: idx });
  }, [idx]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') next();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prev();
      else if (e.key === 'Escape') {
        channelRef.current?.postMessage({ type: 'exit' });
        channelRef.current?.close();
        channelRef.current = null;
        mirrorWindowRef.current?.close();
        mirrorWindowRef.current = null;
        onExit();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  async function openMirror() {
    setShowMirrorPrompt(false);
    const channelId = `slides-mirror-${Date.now()}`;
    const channel = new BroadcastChannel(channelId);
    channelRef.current = channel;

    channel.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'ready') {
        channel.postMessage({ type: 'init', presentation, slideIndex: idxRef.current });
      }
    };

    try {
      type ScreenInfo = { isPrimary: boolean; left: number; top: number; width: number; height: number };
      const screenDetails = await (window as unknown as { getScreenDetails(): Promise<{ screens: ScreenInfo[] }> }).getScreenDetails();
      const externalScreen = screenDetails.screens.find((s) => !s.isPrimary) ?? screenDetails.screens[1];
      const mirrorUrl = `${window.location.origin}/slides-mirror?channelId=${encodeURIComponent(channelId)}`;
      const win = window.open(
        mirrorUrl,
        'slides-mirror',
        `left=${externalScreen.left},top=${externalScreen.top},width=${externalScreen.width},height=${externalScreen.height}`
      );
      mirrorWindowRef.current = win;
    } catch {
      channel.close();
      channelRef.current = null;
    }
  }

  function handleExit() {
    if (channelRef.current) {
      channelRef.current.postMessage({ type: 'exit' });
      channelRef.current.close();
      channelRef.current = null;
    }
    if (mirrorWindowRef.current) {
      mirrorWindowRef.current.close();
      mirrorWindowRef.current = null;
    }
    onExit();
  }

  const nextSlide = presentation.slides[idx + 1];

  return (
    <div className={styles.presenterWrapper}>
      {showMirrorPrompt && (
        <div className={styles.mirrorPrompt}>
          <span>External monitor detected — mirror the presentation on it?</span>
          <button className={styles.mirrorPromptBtnYes} onClick={openMirror}>Mirror on external display</button>
          <button className={styles.mirrorPromptBtnNo} onClick={() => setShowMirrorPrompt(false)}>No thanks</button>
        </div>
      )}

      <div className={styles.presenterContent}>
      {/* Current slide */}
      <div className={styles.presenterMain}>
        <div
          key={animKey}
          className={`${styles.presenterSlide} ${
            slide.transition === 'fade'        ? styles.presenterTransFade       :
            slide.transition === 'dissolve'    ? styles.presenterTransDissolve   :
            slide.transition === 'slide'       ? styles.presenterTransSlideRight :
            slide.transition === 'slide-left'  ? styles.presenterTransSlideLeft  :
            slide.transition === 'flip'        ? styles.presenterTransFlip       :
            slide.transition === 'cube'        ? styles.presenterTransCube       :
            slide.transition === 'gallery'     ? styles.presenterTransGallery    :
            slide.transition === 'pixelate'    ? styles.presenterTransPixelate   :
            slide.transition === 'cover'       ? styles.presenterTransCover      :
            slide.transition === 'wipe'        ? styles.presenterTransWipe       :
            slide.transition === 'zoom'        ? styles.presenterTransZoom       : ''
          }`}
          style={slideBackgroundStyle(slide.background)}
        >
          <SlideRenderer slide={slide} scale={0.75} animKey={animKey} />
        </div>

        <div className={styles.presenterControls}>
          <button className={styles.presenterBtn} onClick={prev} disabled={idx === 0}>←</button>
          <span className={styles.presenterCounter}>{idx + 1} / {total}</span>
          <button className={styles.presenterBtn} onClick={next} disabled={idx === total - 1}>→</button>
          <button className={styles.presenterBtnExit} onClick={handleExit}>✕ Exit</button>
        </div>
      </div>

      {/* Right panel: notes + next slide */}
      <div className={styles.presenterSidebar}>
        {nextSlide && (
          <div className={styles.presenterNextSection}>
            <div className={styles.presenterSideLabel}>Next slide</div>
            <div
              className={styles.presenterNextSlide}
              style={slideBackgroundStyle(nextSlide.background)}
            >
              <SlideRenderer slide={nextSlide} scale={0.3} />
            </div>
          </div>
        )}

        <div className={styles.presenterNotesSection}>
          <div className={styles.presenterSideLabel}>Speaker notes</div>
          <div className={styles.presenterNotes}>
            {slide.notes || <span style={{ opacity: 0.4 }}>No notes for this slide</span>}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
