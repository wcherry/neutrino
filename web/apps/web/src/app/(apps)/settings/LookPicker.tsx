'use client';

import React from 'react';
import { usePreference, type PreferenceValues } from '@neutrino/preferences';
import { InheritedNote, useLocked } from './InheritedNote';
import styles from './LookPicker.module.css';

type Look = PreferenceValues['appearance.look'];

const LOOKS: { id: Look; name: string; description: string }[] = [
  { id: 'classic', name: 'Classic', description: 'Neutrino as it has been. The default until every editor has its new look.' },
  { id: 'lightflow', name: 'Light Flow', description: 'One seamless white surface. Borders only on hover.' },
  { id: 'precision', name: 'Quiet Precision', description: 'Every region a card on a cool grey ground.' },
  { id: 'blended', name: 'Blended Flow', description: 'Light Flow, washed in the colour of the app you are in.' },
];

/**
 * The look (customization roadmap U4; look-and-feel roadmap §3). Each preview is a miniature
 * shell with `data-look` set on it, so it draws with that look's own tokens — the same values the
 * real shell uses, not a picture of them. The three new looks are an early opt-in until the
 * editors are restyled (ui-roadmap.md, stage 5).
 */
export function LookPicker({ className }: { className?: string }) {
  const [look, setLook] = usePreference('appearance.look');
  const locked = useLocked('appearance.look');
  return (
    <div>
      <div className={[styles.grid, className].filter(Boolean).join(' ')} role="radiogroup" aria-label="Look">
        {LOOKS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={look === l.id}
            className={styles.option}
            disabled={locked}
            onClick={() => setLook(l.id)}
          >
            <span className={styles.preview} data-look={l.id} aria-hidden="true">
              <span className={styles.bar}>
                <span className={styles.dot} />
                <span className={styles.search} />
              </span>
              <span className={styles.body}>
                <span className={styles.side}>
                  <span className={styles.line} />
                  <span className={styles.line} data-active />
                  <span className={styles.line} />
                </span>
                <span className={styles.page}>
                  <span className={styles.line} data-wide />
                  <span className={styles.line} data-wide />
                  <span className={styles.button} />
                </span>
              </span>
            </span>
            <span className={styles.name}>
              {l.name}
              {l.id !== 'classic' && <span className={styles.badge}>Early</span>}
            </span>
            <span className={styles.description}>{l.description}</span>
          </button>
        ))}
      </div>
      <InheritedNote prefKey="appearance.look" />
    </div>
  );
}
