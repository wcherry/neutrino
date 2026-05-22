'use client';

import React from 'react';
import type { Slide, TextElement, ShapeElement } from './slideEditorTypes';
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
                overflow: 'hidden',
                lineHeight: 1.2,
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
              key={el.id}
              style={{ position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%` }}
            >
              <ShapeRenderer el={shapeEl} />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
