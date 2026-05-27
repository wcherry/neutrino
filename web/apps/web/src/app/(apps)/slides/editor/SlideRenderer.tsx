'use client';

import React from 'react';
import type { Slide, TextElement, ShapeElement, LineElement, ImageElement, VideoElement } from './slideEditorTypes';
import { getAnimationStyle, getVideoEmbedInfo } from './slideEditorHelpers';
import { ShapeRenderer, LineRenderer } from './SlideCanvas';
import styles from './page.module.css';

export function SlideRenderer({
  slide,
  scale,
  animKey,
}: {
  slide: Slide;
  /** Font-size multiplier: 0.75 for full-size, 0.3 for next-slide preview. */
  scale: number;
  animKey?: number;
}) {
  return (
    <>
      {slide.elements.map((el) => {
        const animStyle = animKey !== undefined ? getAnimationStyle(el.animation) : {};

        if (el.type === 'text') {
          const textEl = el as TextElement;
          const listType = textEl.style.listType ?? 'none';
          const spaceBefore = (textEl.style.spaceBefore ?? 0) * scale;
          const spaceAfter = (textEl.style.spaceAfter ?? 0) * scale;
          const lines = textEl.content.split('\n');
          return (
            <div
              key={animKey !== undefined ? `${el.id}-${animKey}` : el.id}
              style={{
                position: 'absolute',
                left: `${el.x}%`,
                top: `${el.y}%`,
                width: `${el.w}%`,
                height: `${el.h}%`,
                fontSize: `${textEl.style.fontSize * scale}px`,
                fontWeight: textEl.style.bold ? 700 : 400,
                fontStyle: textEl.style.italic ? 'italic' : 'normal',
                textDecoration: [
                  textEl.style.underline ? 'underline' : '',
                  textEl.style.strikethrough ? 'line-through' : '',
                ].filter(Boolean).join(' ') || 'none',
                color: textEl.style.color,
                backgroundColor: textEl.style.backgroundColor ?? 'transparent',
                textAlign: textEl.style.align,
                fontFamily: textEl.style.fontFamily,
                lineHeight: textEl.style.lineHeight ?? 1.3,
                textShadow: textEl.style.shadow
                  ? `2px 2px 4px ${textEl.style.shadowColor ?? 'rgba(0,0,0,0.5)'}`
                  : undefined,
                overflow: 'hidden',
                wordBreak: 'break-word',
                ...animStyle,
              }}
            >
              {lines.map((line, i, arr) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: listType !== 'none' ? '0.4em' : undefined,
                    whiteSpace: 'pre-wrap',
                    marginTop: i > 0 ? spaceBefore : 0,
                    marginBottom: i < arr.length - 1 ? spaceAfter : 0,
                  }}
                >
                  {listType === 'bullet' && (
                    <span style={{ flexShrink: 0, userSelect: 'none' }}>•</span>
                  )}
                  {listType === 'numbered' && (
                    <span style={{ flexShrink: 0, userSelect: 'none' }}>{i + 1}.</span>
                  )}
                  <span style={{ flex: 1 }}>{line || ' '}</span>
                </div>
              ))}
            </div>
          );
        }

        if (el.type === 'shape') {
          const shapeEl = el as ShapeElement;
          return (
            <div
              key={animKey !== undefined ? `${el.id}-${animKey}` : el.id}
              style={{
                position: 'absolute',
                left: `${el.x}%`,
                top: `${el.y}%`,
                width: `${el.w}%`,
                height: `${el.h}%`,
                ...animStyle,
              }}
            >
              <ShapeRenderer el={shapeEl} />
            </div>
          );
        }

        if (el.type === 'line') {
          const lineEl = el as LineElement;
          return (
            <div
              key={animKey !== undefined ? `${el.id}-${animKey}` : el.id}
              style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none', ...animStyle }}
            >
              <LineRenderer el={lineEl} />
            </div>
          );
        }

        if (el.type === 'image') {
          const imgEl = el as ImageElement;
          const filterParts: string[] = [];
          if (imgEl.brightness !== 0) filterParts.push(`brightness(${1 + imgEl.brightness / 100})`);
          if (imgEl.contrast !== 0) filterParts.push(`contrast(${1 + imgEl.contrast / 100})`);
          if (imgEl.saturation !== 0)
            filterParts.push(`saturate(${Math.max(0, 1 + imgEl.saturation / 100)})`);
          if (imgEl.warmth > 0) {
            filterParts.push(`sepia(${(imgEl.warmth / 100) * 0.5})`);
            filterParts.push(`hue-rotate(${imgEl.warmth * -0.1}deg)`);
          } else if (imgEl.warmth < 0) {
            filterParts.push(`hue-rotate(${imgEl.warmth * 0.5}deg)`);
          }
          return (
            <div
              key={animKey !== undefined ? `${el.id}-${animKey}` : el.id}
              style={{
                position: 'absolute',
                left: `${el.x}%`,
                top: `${el.y}%`,
                width: `${el.w}%`,
                height: `${el.h}%`,
                overflow: 'hidden',
                ...animStyle,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgEl.src}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: imgEl.objectFit ?? 'cover',
                  opacity: imgEl.opacity ?? 1,
                  filter: filterParts.length > 0 ? filterParts.join(' ') : undefined,
                  display: 'block',
                }}
              />
              {imgEl.tintColor && imgEl.tintStrength > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: imgEl.tintColor,
                    opacity: imgEl.tintStrength,
                    mixBlendMode: 'multiply',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          );
        }

        if (el.type === 'video') {
          const videoEl = el as VideoElement;
          const info = getVideoEmbedInfo(videoEl.url, {
            startSeconds: videoEl.startSeconds,
            autoplay: videoEl.autoplay,
            loop: videoEl.loop,
            muted: videoEl.muted,
          });
          return (
            <div
              key={animKey !== undefined ? `${el.id}-${animKey}` : el.id}
              style={{
                position: 'absolute',
                left: `${el.x}%`,
                top: `${el.y}%`,
                width: `${el.w}%`,
                height: `${el.h}%`,
                overflow: 'hidden',
                background: '#000',
                ...animStyle,
              }}
            >
              {info.isPortrait ? (
                <div className={styles.shortVideoContainer}>
                  <iframe
                    src={info.embedUrl}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                    title="Video embed"
                  />
                </div>
              ) : info.provider === 'mp4' ? (
                <video
                  src={info.embedUrl}
                  controls
                  autoPlay={videoEl.autoplay}
                  loop={videoEl.loop}
                  muted={videoEl.muted}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <iframe
                  src={info.embedUrl}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  title="Video embed"
                />
              )}
            </div>
          );
        }

        return null;
      })}
    </>
  );
}
