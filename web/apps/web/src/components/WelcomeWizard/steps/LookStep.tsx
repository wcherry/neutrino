'use client';

/**
 * Step 2: a look, an accent and a theme. Each choice is the same preference Settings › Appearance
 * writes (`appearance.look`, `appearance.accent`, `appearance.theme`), so it applies to the app
 * behind the dialog on click, syncs to the user's other devices, and Back does not undo it.
 */

import React from 'react';
import { preferences, usePreference } from '@neutrino/preferences';
import { useTheme, type ThemeChoice } from '@/providers/ThemeProvider';
import { LookPicker } from '@/app/(apps)/settings/LookPicker';
import { ACCENT_SWATCHES } from '@/app/(apps)/settings/DisplaySettings';
import { InheritedNote, useLocked } from '@/app/(apps)/settings/InheritedNote';
import { useStep } from '../stepApi';
import styles from './Steps.module.css';

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'As the device' },
];

export function LookStep() {
  const { markDone } = useStep();
  const { theme, setTheme } = useTheme();
  const [accent, setAccent] = usePreference('appearance.accent');
  // `set(null)` is refused for a string preference; going back to the look's own accent is a reset.
  const accentLocked = useLocked('appearance.accent');
  const themeLocked = useLocked('appearance.theme');

  return (
    <div className={styles.stack}>
      {/* The look picker applies its choice itself; the capture only notes that one was made. */}
      <div className={styles.group} onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest('[role="radio"]')) markDone();
      }}>
        <span className={styles.label}>Look</span>
        <LookPicker className={styles.looks} />
      </div>

      <div className={styles.group}>
        <span className={styles.label} id="wizard-accent-label">Accent</span>
        <div className={styles.swatches} role="radiogroup" aria-labelledby="wizard-accent-label">
          <button
            type="button"
            role="radio"
            aria-checked={!accent}
            className={styles.swatchDefault}
            disabled={accentLocked}
            onClick={() => { preferences.reset('appearance.accent'); markDone(); }}
          >
            Look&rsquo;s own
          </button>
          {ACCENT_SWATCHES.map(({ value, name }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={accent?.toLowerCase() === value}
              className={styles.swatch}
              disabled={accentLocked}
              onClick={() => { setAccent(value); markDone(); }}
            >
              <span className={styles.dot} style={{ background: value }} aria-hidden="true" />
              {name}
            </button>
          ))}
        </div>
        <InheritedNote prefKey="appearance.accent" />
      </div>

      <div className={styles.group}>
        <span className={styles.label} id="wizard-theme-label">Theme</span>
        <div className={styles.segmented} role="radiogroup" aria-labelledby="wizard-theme-label">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={theme === t.value}
              className={styles.segment}
              disabled={themeLocked}
              onClick={() => { setTheme(t.value); markDone(); }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <InheritedNote prefKey="appearance.theme" />
      </div>
    </div>
  );
}
