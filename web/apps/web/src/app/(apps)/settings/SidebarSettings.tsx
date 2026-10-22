'use client';

import React from 'react';
import { ArrowDown, ArrowUp, PinOff, RotateCcw } from 'lucide-react';
import { usePreference } from '@neutrino/preferences';
import { APP_ITEMS } from '../navSections';
import { moveApp, readLayout, resetLayout, setHidden, unpinFolder } from '@/lib/sidebarLayout';
import styles from './SidebarSettings.module.css';

const DRIVE_VIEWS = [
  { id: 'shared', label: 'Shared with me' },
  { id: 'recent', label: 'Recent' },
  { id: 'starred', label: 'Starred' },
  { id: 'trash', label: 'Trash' },
];

const SECTIONS = [
  { id: 'section:team', label: 'Teams' },
  { id: 'section:tags', label: 'Tags' },
];

/**
 * Settings › Appearance › Sidebar (customization roadmap U8): show or hide entries, put the apps in
 * your own order, and see what is pinned. Folders are pinned from their menu in Drive. Saved to
 * `shell.sidebar`, so the sidebar is the same on every device.
 */
export function SidebarSettings() {
  const [pref] = usePreference('shell.sidebar');
  const [enabledApps] = usePreference('apps.enabled');
  const layout = readLayout(pref);
  const shown = (id: string) => !layout.hidden.includes(id);

  // The apps as the sidebar shows them: the instance's, in the user's order.
  const apps = APP_ITEMS.filter((a) => enabledApps.includes(a.app));
  const rank = (id: string) => {
    const i = layout.order.indexOf(id);
    return i < 0 ? layout.order.length + apps.findIndex((a) => a.id === id) : i;
  };
  const ordered = [...apps].sort((a, b) => rank(a.id) - rank(b.id));
  const orderIds = ordered.map((a) => a.id);

  const toggle = (id: string, label: string) => (
    <label key={id} className={styles.check}>
      <input type="checkbox" checked={shown(id)} onChange={(e) => setHidden(id, !e.target.checked)} />
      {label}
    </label>
  );

  return (
    <div className={styles.root} id="sidebar">
      <div className={styles.head}>
        <span className={styles.label}>Sidebar</span>
        <button type="button" className={styles.link} onClick={resetLayout}>
          <RotateCcw size={13} aria-hidden="true" /> Reset
        </button>
      </div>
      <p className={styles.hint}>What the sidebar shows and in what order, on every device. Pin a folder from its menu in Drive.</p>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Drive</legend>
        {DRIVE_VIEWS.map((v) => toggle(v.id, v.label))}
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Apps</legend>
        <ul className={styles.apps}>
          {ordered.map((a, i) => (
            <li key={a.id} className={styles.app}>
              <label className={styles.check}>
                <input type="checkbox" checked={shown(a.id)} onChange={(e) => setHidden(a.id, !e.target.checked)} />
                {a.label}
              </label>
              <span className={styles.move}>
                <button type="button" aria-label={`Move ${a.label} up`} disabled={i === 0} onClick={() => moveApp(orderIds, a.id, -1)}>
                  <ArrowUp size={14} aria-hidden="true" />
                </button>
                <button type="button" aria-label={`Move ${a.label} down`} disabled={i === ordered.length - 1} onClick={() => moveApp(orderIds, a.id, 1)}>
                  <ArrowDown size={14} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Sections</legend>
        {SECTIONS.map((s) => toggle(s.id, s.label))}
      </fieldset>

      {layout.pinned.length > 0 && (
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Pinned folders</legend>
          <ul className={styles.apps}>
            {layout.pinned.map((p) => (
              <li key={p.id} className={styles.app}>
                <span>{p.name}</span>
                <button type="button" className={styles.link} onClick={() => unpinFolder(p.id)}>
                  <PinOff size={13} aria-hidden="true" /> Unpin
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </div>
  );
}
