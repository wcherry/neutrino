'use client';

import React, { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { PanelContainer, Button, type PanelTab } from '@neutrino/ui';
import styles from './page.module.css';

export interface ImageAttrs {
  src?: string;
  width?: string | null;
  alignment?: string;
  alt?: string;
  title?: string;
  caption?: string;
  border?: string | null;
  shadow?: string;
  imageFilter?: string | null;
}

interface Props {
  editor: Editor;
  initialAttrs: ImageAttrs;
  onClose: () => void;
}

const ALIGNMENT_OPTIONS = [
  { value: 'none',        label: 'Default' },
  { value: 'left',        label: 'Left (block)' },
  { value: 'center',      label: 'Center' },
  { value: 'right',       label: 'Right (block)' },
  { value: 'float-left',  label: 'Float left' },
  { value: 'float-right', label: 'Float right' },
];

const SHADOW_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'sm',   label: 'Small' },
  { value: 'md',   label: 'Medium' },
  { value: 'lg',   label: 'Large' },
];

function parseFilter(filter: string | null | undefined) {
  const f = filter ?? '';
  const brightness = parseInt(f.match(/brightness\((\d+)%\)/)?.[1] ?? '100');
  const contrast   = parseInt(f.match(/contrast\((\d+)%\)/)?.[1]   ?? '100');
  const saturate   = parseInt(f.match(/saturate\((\d+)%\)/)?.[1]   ?? '100');
  return { brightness, contrast, saturate };
}

function buildFilter(brightness: number, contrast: number, saturate: number): string {
  const parts: string[] = [];
  if (brightness !== 100) parts.push(`brightness(${brightness}%)`);
  if (contrast !== 100)   parts.push(`contrast(${contrast}%)`);
  if (saturate !== 100)   parts.push(`saturate(${saturate}%)`);
  return parts.join(' ');
}

function TabBody({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '12px 16px' }}>{children}</div>;
}

function TabFooter({ onApply, onClose }: { onApply: () => void; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
      <Button variant="primary" size="sm" onClick={onApply}>Apply</Button>
    </div>
  );
}

export function ImagePropertiesModal({ editor, initialAttrs, onClose }: Props) {
  const [width, setWidth]         = useState(initialAttrs.width ?? '');
  const [alignment, setAlignment] = useState(initialAttrs.alignment ?? 'none');
  const [alt, setAlt]             = useState(initialAttrs.alt ?? '');
  const [title, setTitle]         = useState(initialAttrs.title ?? '');
  const [caption, setCaption]     = useState(initialAttrs.caption ?? '');
  const [border, setBorder]       = useState(initialAttrs.border ?? '');
  const [shadow, setShadow]       = useState(initialAttrs.shadow ?? 'none');

  const initial = parseFilter(initialAttrs.imageFilter);
  const [brightness, setBrightness] = useState(initial.brightness);
  const [contrast, setContrast]     = useState(initial.contrast);
  const [saturate, setSaturate]     = useState(initial.saturate);

  const handleApply = () => {
    const imageFilter = buildFilter(brightness, contrast, saturate) || null;
    editor
      .chain()
      .focus()
      .updateAttributes('image', {
        width:       width || null,
        alignment:   alignment || 'none',
        alt:         alt || null,
        title:       title || null,
        caption:     caption || '',
        border:      border || null,
        shadow:      shadow || 'none',
        imageFilter,
      })
      .run();
    onClose();
  };

  const sharedFooter = <TabFooter onApply={handleApply} onClose={onClose} />;

  const tabs: PanelTab[] = [
    {
      id: 'layout',
      title: 'Layout',
      footer: sharedFooter,
      content: (
        <TabBody>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Width</label>
            <input
              className={styles.formInput}
              value={width}
              placeholder="e.g. 300px, 50%, auto"
              onChange={(e) => setWidth(e.target.value)}
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Alignment</label>
            <select
              className={styles.formSelect}
              value={alignment}
              onChange={(e) => setAlignment(e.target.value)}
            >
              {ALIGNMENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </TabBody>
      ),
    },
    {
      id: 'appearance',
      title: 'Appearance',
      footer: sharedFooter,
      content: (
        <TabBody>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Border</label>
            <input
              className={styles.formInput}
              value={border}
              placeholder="e.g. 2px solid #333"
              onChange={(e) => setBorder(e.target.value)}
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Shadow</label>
            <select
              className={styles.formSelect}
              value={shadow}
              onChange={(e) => setShadow(e.target.value)}
            >
              {SHADOW_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </TabBody>
      ),
    },
    {
      id: 'tint',
      title: 'Tint',
      footer: sharedFooter,
      content: (
        <TabBody>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Brightness</label>
            <div className={styles.sliderRow}>
              <input
                type="range"
                className={styles.formSlider}
                min={50} max={150}
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
              />
              <span className={styles.sliderValue}>{brightness}%</span>
            </div>
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Contrast</label>
            <div className={styles.sliderRow}>
              <input
                type="range"
                className={styles.formSlider}
                min={50} max={150}
                value={contrast}
                onChange={(e) => setContrast(Number(e.target.value))}
              />
              <span className={styles.sliderValue}>{contrast}%</span>
            </div>
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Saturation</label>
            <div className={styles.sliderRow}>
              <input
                type="range"
                className={styles.formSlider}
                min={0} max={200}
                value={saturate}
                onChange={(e) => setSaturate(Number(e.target.value))}
              />
              <span className={styles.sliderValue}>{saturate}%</span>
            </div>
          </div>
        </TabBody>
      ),
    },
    {
      id: 'metadata',
      title: 'Metadata',
      footer: sharedFooter,
      content: (
        <TabBody>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Alt text</label>
            <input
              className={styles.formInput}
              value={alt}
              placeholder="Describe the image for accessibility"
              onChange={(e) => setAlt(e.target.value)}
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Title</label>
            <input
              className={styles.formInput}
              value={title}
              placeholder="Tooltip shown on hover"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Caption</label>
            <input
              className={styles.formInput}
              value={caption}
              placeholder="Optional caption text"
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>
        </TabBody>
      ),
    },
  ];

  return (
    <div style={{ position: 'fixed', top: 80, right: 24, zIndex: 1000 }}>
      <PanelContainer
        tabs={tabs}
        defaultLocation="float"
        onClose={onClose}
        width={320}
        height={400}
      />
    </div>
  );
}
