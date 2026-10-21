'use client';

import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { REGISTRY } from '@neutrino/preferences';
import { COMMANDS, COMMAND_APPS } from '@neutrino/commands';
import styles from './SettingsSearch.module.css';

/** The Settings tabs a result can open; the page's own `TABS` list names them. */
export type SettingsTabId = 'ai' | 'appearance' | 'notifications' | 'calendar' | 'keyboard' | 'account' | 'security' | 'advanced';

const TAB_LABELS: Record<SettingsTabId, string> = {
  ai: 'AI Assistant',
  appearance: 'Appearance',
  notifications: 'Notifications',
  calendar: 'Calendar',
  keyboard: 'Keyboard',
  account: 'Account',
  security: 'Security',
  advanced: 'Advanced',
};

/** Where a preference set outside Settings is changed, in words. */
const ELSEWHERE: Record<string, string> = {
  docs: 'In the Docs editor',
  sheets: 'In the Sheets editor',
  slides: 'In the Slides editor',
  diagrams: 'In the Diagrams editor',
  drawing: 'In the Drawing editor',
  photos: 'In the photo editor',
  editors: 'In the Docs, Sheets and Slides editors',
  sidebar: 'The sidebar’s collapse button',
};

export interface SettingsSearchResult {
  label: string;
  /** Set when the result is on a Settings tab, which a click opens. */
  tab?: SettingsTabId;
  where: string;
}

/**
 * Every setting a person can look for: each registered preference, wherever its control lives,
 * each keyboard command (its shortcut is set on the Keyboard tab), and each Settings tab by name.
 * Generated from the preference registry and the command catalog, so a new preference or command
 * is findable the moment it is registered rather than when someone remembers to add it here.
 */
export function searchSettings(query: string): SettingsSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: SettingsSearchResult[] = [];
  for (const [tab, label] of Object.entries(TAB_LABELS) as [SettingsTabId, string][]) {
    if (label.toLowerCase().includes(q)) results.push({ label, tab, where: 'Settings' });
  }
  for (const spec of REGISTRY) {
    if (spec.section === 'none' || !spec.label.toLowerCase().includes(q)) continue;
    const tab = spec.section in TAB_LABELS ? (spec.section as SettingsTabId) : undefined;
    results.push({
      label: spec.label,
      tab,
      where: tab ? `Settings › ${TAB_LABELS[tab]}` : ELSEWHERE[spec.section] ?? 'Elsewhere in the app',
    });
  }
  for (const cmd of COMMANDS) {
    if (!cmd.title.toLowerCase().includes(q)) continue;
    const app = COMMAND_APPS.find((a) => a.id === cmd.app)!.label;
    results.push({ label: `${cmd.title} (${app}) shortcut`, tab: 'keyboard', where: 'Settings › Keyboard' });
  }
  return results;
}

export function SettingsSearch({ onOpenTab }: { onOpenTab: (tab: SettingsTabId) => void }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchSettings(query), [query]);

  return (
    <div className={styles.root}>
      <label className={styles.field}>
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          className={styles.input}
          placeholder="Search settings"
          aria-label="Search settings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {query.trim() && (
        <ul className={styles.results} aria-label="Matching settings">
          {results.length === 0 && <li className={styles.empty}>No settings match “{query.trim()}”.</li>}
          {results.map((r) => (
            <li key={`${r.where}:${r.label}`}>
              {r.tab ? (
                <button
                  type="button"
                  className={styles.result}
                  onClick={() => {
                    onOpenTab(r.tab!);
                    setQuery('');
                  }}
                >
                  <span className={styles.label}>{r.label}</span>
                  <span className={styles.where}>{r.where}</span>
                </button>
              ) : (
                <div className={styles.result}>
                  <span className={styles.label}>{r.label}</span>
                  <span className={styles.where}>{r.where}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
