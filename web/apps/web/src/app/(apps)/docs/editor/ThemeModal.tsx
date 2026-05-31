'use client';

import React, { useState } from 'react';
import styles from './page.module.css';

export type DocTheme = 'default' | 'corporate' | 'academic' | 'minimal';

const THEMES: { id: DocTheme; label: string; description: string; previewStyle: React.CSSProperties }[] = [
  {
    id: 'default',
    label: 'Default',
    description: 'Clean, modern sans-serif style.',
    previewStyle: { fontFamily: 'Arial, sans-serif', color: '#202124' },
  },
  {
    id: 'corporate',
    label: 'Corporate',
    description: 'Professional look with navy blue headings.',
    previewStyle: { fontFamily: 'Arial, sans-serif', color: '#003366' },
  },
  {
    id: 'academic',
    label: 'Academic',
    description: 'Serif typeface; suited for papers and reports.',
    previewStyle: { fontFamily: 'Georgia, serif', color: '#2c2c2c' },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Light-weight headings; open, airy feel.',
    previewStyle: { fontFamily: 'Arial, sans-serif', fontWeight: 300, color: '#202124' },
  },
];

export interface ThemeModalProps {
  currentTheme: DocTheme;
  onSave: (theme: DocTheme) => void;
  onClose: () => void;
}

export function ThemeModal({ currentTheme, onSave, onClose }: ThemeModalProps) {
  const [selected, setSelected] = useState<DocTheme>(currentTheme);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ minWidth: 440 }}>
        <div className={styles.modalTitle}>Document theme</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              onClick={() => setSelected(theme.id)}
              style={{
                border: selected === theme.id ? '2px solid #1a73e8' : '2px solid var(--color-border, #e0e0e0)',
                borderRadius: 8,
                padding: 12,
                cursor: 'pointer',
                background: selected === theme.id ? '#e8f0fe' : 'var(--color-bg, #ffffff)',
                textAlign: 'left',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <div style={{ ...theme.previewStyle, fontSize: 14, marginBottom: 4 }}>
                Heading
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text, #202124)', marginBottom: 2 }}>
                {theme.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted, #5f6368)' }}>
                {theme.description}
              </div>
            </button>
          ))}
        </div>

        <div className={styles.modalActions}>
          <button className={styles.exportBtn} onClick={onClose}>Cancel</button>
          <button
            className={styles.exportBtn}
            style={{ background: '#1a73e8', color: 'white', border: 'none' }}
            onClick={() => { onSave(selected); onClose(); }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
