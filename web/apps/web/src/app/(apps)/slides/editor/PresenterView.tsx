'use client';

import React, { useState, useEffect } from 'react';
import type { SlidePresentation, TextElement, ShapeElement } from './slideEditorTypes';
import { slideBackgroundStyle, getAnimationStyle } from './slideEditorHelpers';
import { ShapeRenderer } from './SlideCanvas';
import styles from './page.module.css';

interface PresenterViewProps {
  presentation: SlidePresentation;
  onExit: () => void;
}

export default function PresenterView({ presentation, onExit }: PresenterViewProps) {
  const [idx, setIdx] = useState(0);
  const [animKey, setAnimKey] = useState(0);
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') next();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prev();
      else if (e.key === 'Escape') onExit();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const nextSlide = presentation.slides[idx + 1];

  return (
    <div className={styles.presenterWrapper}>
      {/* Current slide */}
      <div className={styles.presenterMain}>
        <div
          key={animKey}
          className={`${styles.presenterSlide} ${
            slide.transition === 'fade'       ? styles.presenterTransFade       :
            slide.transition === 'dissolve'   ? styles.presenterTransDissolve   :
            slide.transition === 'slide'      ? styles.presenterTransSlideRight :
            slide.transition === 'slide-left' ? styles.presenterTransSlideLeft  :
            slide.transition === 'flip'       ? styles.presenterTransFlip       :
            slide.transition === 'cube'       ? styles.presenterTransCube       :
            slide.transition === 'gallery'    ? styles.presenterTransGallery    :
            slide.transition === 'pixelate'   ? styles.presenterTransPixelate   :
            slide.transition === 'cover'      ? styles.presenterTransCover      :
            slide.transition === 'wipe'       ? styles.presenterTransWipe       :
            slide.transition === 'zoom'       ? styles.presenterTransZoom       : ''
          }`}
          style={slideBackgroundStyle(slide.background)}
        >
          {slide.elements.map((el) => {
            const animStyle = getAnimationStyle(el.animation);
            if (el.type === 'text') {
              const textEl = el as TextElement;
              return (
                <div
                  key={`${el.id}-${animKey}`}
                  style={{
                    position: 'absolute',
                    left: `${el.x}%`,
                    top: `${el.y}%`,
                    width: `${el.w}%`,
                    height: `${el.h}%`,
                    fontSize: `${textEl.style.fontSize * 0.75}px`,
                    fontWeight: textEl.style.bold ? 700 : 400,
                    fontStyle: textEl.style.italic ? 'italic' : 'normal',
                    textDecoration: textEl.style.underline ? 'underline' : 'none',
                    color: textEl.style.color,
                    textAlign: textEl.style.align,
                    fontFamily: textEl.style.fontFamily,
                    overflow: 'hidden',
                    ...animStyle,
                  }}
                >
                  {textEl.content}
                </div>
              );
            }
            if (el.type === 'shape') {
              const shapeEl = el as ShapeElement;
              return (
                <div
                  key={`${el.id}-${animKey}`}
                  style={{ position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, ...animStyle }}
                >
                  <ShapeRenderer el={shapeEl} />
                </div>
              );
            }
            return null;
          })}
        </div>

        <div className={styles.presenterControls}>
          <button className={styles.presenterBtn} onClick={prev} disabled={idx === 0}>←</button>
          <span className={styles.presenterCounter}>{idx + 1} / {total}</span>
          <button className={styles.presenterBtn} onClick={next} disabled={idx === total - 1}>→</button>
          <button className={styles.presenterBtnExit} onClick={onExit}>✕ Exit</button>
        </div>
      </div>

      {/* Right panel: notes + next slide */}
      <div className={styles.presenterSidebar}>
        {nextSlide && (
          <div className={styles.presenterNextSection}>
            <div className={styles.presenterSideLabel}>Next slide</div>
            <div className={styles.presenterNextSlide} style={slideBackgroundStyle(nextSlide.background)}>
              {nextSlide.elements.map((el) => {
                if (el.type === 'text') {
                  const textEl = el as TextElement;
                  return (
                    <div key={el.id} style={{ position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, fontSize: `${textEl.style.fontSize * 0.3}px`, fontWeight: textEl.style.bold ? 700 : 400, color: textEl.style.color, overflow: 'hidden' }}>
                      {textEl.content}
                    </div>
                  );
                }
                if (el.type === 'shape') {
                  const shapeEl = el as ShapeElement;
                  return <div key={el.id} style={{ position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%` }}><ShapeRenderer el={shapeEl} /></div>;
                }
                return null;
              })}
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
  );
}
