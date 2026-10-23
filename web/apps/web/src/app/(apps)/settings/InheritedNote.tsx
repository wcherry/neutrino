'use client';

import React from 'react';
import { Lock } from 'lucide-react';
import { usePreferenceSource, type PreferenceKey } from '@neutrino/preferences';
import styles from './InheritedNote.module.css';

/**
 * What Settings says beside a control whose value is not the user's own (customization roadmap
 * §3.1): locked by the organisation — the control is disabled and this says why, rather than the
 * setting silently not applying — or a default the organisation or a team chose, which the user
 * may override. Nothing when the value is the user's own or the product default.
 */
export function InheritedNote({ prefKey }: { prefKey: PreferenceKey }) {
  const source = usePreferenceSource(prefKey);
  if (source === 'locked') {
    return (
      <p className={styles.note} data-locked>
        <Lock size={13} aria-hidden="true" /> Set by your organisation
      </p>
    );
  }
  if (source === 'org') return <p className={styles.note}>Your organisation&rsquo;s default — choose another to override it</p>;
  if (source === 'team') return <p className={styles.note}>This team&rsquo;s default — choose another to override it</p>;
  return null;
}

/** Whether a control for `prefKey` should be disabled: the organisation has locked it. */
export function useLocked(prefKey: PreferenceKey): boolean {
  return usePreferenceSource(prefKey) === 'locked';
}
