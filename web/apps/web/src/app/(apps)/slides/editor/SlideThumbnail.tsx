'use client';

import React from 'react';
import type { Slide, TextElement, ShapeElement, ImageElement } from './slideEditorTypes';
import { slideBackgroundStyle } from './slideEditorHelpers';
import { ShapeRenderer } from './SlideCanvas';
import styles from './page.module.css';

export default function SlideThumbnail({ slide }: { slide: Slide }) {
  return (
    <div className={styles.thumbnailPreview} style={slideBackgroundStyle(slide.background)}>
      {slide.elements.map((el) => {
        if (el.type === 'text') {
          const textEl = el as TextElement;
          return (
            <div
              key={el.id}
              style={{
                position: 'absolute',
                left: `${el.x}%`,
                top: `${el.y}%`,
                width: `${el.w}%`,
                height: `${el.h}%`,
                fontSize: `${textEl.style.fontSize * 0.075}px`,
                fontWeight: textEl.style.bold ? 700 : 400,
                color: textEl.style.color,
                textShadow: textEl.style.shadow ? `0.5px 0.5px 1px ${textEl.style.shadowColor ?? 'rgba(0,0,0,0.5)'}` : undefined,
                overflow: 'hidden',
                lineHeight: textEl.style.lineHeight ?? 1.2,
              }}
            >
              {textEl.content.split('\n').map((line, i, arr) => {
                const listType = textEl.style.listType ?? 'none';
                const spaceBefore = (textEl.style.spaceBefore ?? 0) * 0.075;
                const spaceAfter = (textEl.style.spaceAfter ?? 0) * 0.075;
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      gap: listType !== 'none' ? '0.3em' : undefined,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      marginTop: i > 0 ? spaceBefore : 0,
                      marginBottom: i < arr.length - 1 ? spaceAfter : 0,
                    }}
                  >
                    {listType === 'bullet' && <span style={{ flexShrink: 0 }}>•</span>}
                    {listType === 'numbered' && <span style={{ flexShrink: 0 }}>{i + 1}.</span>}
                    <span style={{ flex: 1 }}>{line || ' '}</span>
                  </div>
                );
              })}
            </div>
          );
        }
        if (el.type === 'shape') {
          const shapeEl = el as ShapeElement;
          return (
            <div
              key={el.id}
              style={{ position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%` }}
            >
              <ShapeRenderer el={shapeEl} />
            </div>
          );
        }
        if (el.type === 'image') {
          const imgEl = el as ImageElement;
          return (
            <div
              key={el.id}
              style={{ position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, overflow: 'hidden' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgEl.src}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: imgEl.objectFit ?? 'cover', opacity: imgEl.opacity ?? 1, display: 'block' }}
              />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
