'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { SlideBackground } from './slideEditorTypes';
import { PRESET_GRADIENTS } from './slideEditorConstants';
import { bgPreviewStyle } from './slideEditorHelpers';
import styles from './page.module.css';

export default function BackgroundPicker({ background, onChange }: { background: SlideBackground; onChange: (bg: SlideBackground) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'color' | 'gradient' | 'image'>(
    background.type === 'gradient' ? 'gradient' : background.type === 'image' ? 'image' : 'color',
  );
  const [customGradient, setCustomGradient] = useState(background.type === 'gradient' ? background.value : '');
  const [imageUrl, setImageUrl] = useState(background.type === 'image' ? background.value : '');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div ref={ref} className={styles.bgPickerWrap}>
      <button
        className={styles.bgPickerTrigger}
        onClick={() => setOpen((v) => !v)}
        title="Slide background"
      >
        <span className={styles.bgPickerSwatch} style={bgPreviewStyle(background)} />
        BG
      </button>

      {open && (
        <div className={styles.bgPickerPopover}>
          <div className={styles.bgPickerTabStrip}>
            {(['color', 'gradient', 'image'] as const).map((t) => (
              <button
                key={t}
                className={`${styles.bgPickerTab} ${tab === t ? styles.bgPickerTabActive : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'color' ? 'Color' : t === 'gradient' ? 'Gradient' : 'Image'}
              </button>
            ))}
          </div>

          <div className={styles.bgPickerBody}>
            {tab === 'color' && (
              <div className={styles.bgPickerColorRow}>
                <input
                  type="color"
                  className={styles.bgPickerColorInput}
                  value={background.type === 'color' ? background.value : '#ffffff'}
                  onChange={(e) => onChange({ type: 'color', value: e.target.value })}
                />
                <span className={styles.bgPickerColorVal}>
                  {background.type === 'color' ? background.value : '#ffffff'}
                </span>
              </div>
            )}

            {tab === 'gradient' && (
              <>
                <div className={styles.bgGradientGrid}>
                  {PRESET_GRADIENTS.map((g) => (
                    <button
                      key={g}
                      className={`${styles.bgGradientSwatch} ${background.type === 'gradient' && background.value === g ? styles.bgGradientSwatchActive : ''}`}
                      style={{ background: g }}
                      onClick={() => { setCustomGradient(g); onChange({ type: 'gradient', value: g }); }}
                      title={g}
                    />
                  ))}
                </div>
                <input
                  type="text"
                  className={styles.bgUrlInput}
                  placeholder="Custom: linear-gradient(…)"
                  value={customGradient}
                  onChange={(e) => setCustomGradient(e.target.value)}
                  onBlur={() => { if (customGradient.trim()) onChange({ type: 'gradient', value: customGradient.trim() }); }}
                />
              </>
            )}

            {tab === 'image' && (
              <>
                <input
                  type="text"
                  className={styles.bgUrlInput}
                  placeholder="Image URL…"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  onBlur={() => {
                    if (imageUrl.trim()) {
                      onChange({ type: 'image', value: imageUrl.trim(), objectFit: 'cover' });
                    } else {
                      onChange({ type: 'color', value: '#ffffff' });
                    }
                  }}
                />
                {background.type === 'image' && background.value && (
                  <div className={styles.bgImagePreview} style={{ backgroundImage: `url(${background.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
