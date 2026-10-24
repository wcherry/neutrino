'use client';

import React, { createContext, useContext } from 'react';
import {
  AccountMenu,
  NotificationsMenu,
  QuickAccessMenu,
  SearchButton,
  type AccountMenuProps,
  type NotificationsMenuProps,
  type QuickAccessMenuProps,
} from '@neutrino/layout';
import styles from './editorChrome.module.css';

/**
 * Search, the notifications bell, Quick access and the account menu at the right end of an
 * editor's title bar.
 *
 * The editor frame has no top bar, so these were moved to the foot of the sidebar — where nobody
 * looked for them, and from where they read as missing beside Notes, which keeps the top bar and so
 * the top-right corner everyone else in the app has. The editor's title bar is the top row of the
 * frame, so its right end is that corner, and these are the same controls the top bar draws.
 *
 * The shell owns the data (it already holds the palette, the notification socket and the account
 * actions) and hands it down through `EditorShellActionsProvider`, only while it is drawing the
 * editor frame. Outside it — the classic look, whose top bar still carries them all — nothing is
 * drawn.
 */

export interface EditorShellActionsValue {
  onOpenPalette: () => void;
  paletteShortcut?: string;
  notifications: Omit<NotificationsMenuProps, 'placement'>;
  quickAccess: Omit<QuickAccessMenuProps, 'placement' | 'triggerClassName'>;
  account?: Omit<AccountMenuProps, 'placement'>;
}

const EditorShellActionsContext = createContext<EditorShellActionsValue | null>(null);

export const EditorShellActionsProvider = EditorShellActionsContext.Provider;

export function EditorShellActions() {
  const value = useContext(EditorShellActionsContext);
  if (!value) return null;
  return (
    <div className={styles.shellActions}>
      <SearchButton onOpenPalette={value.onOpenPalette} paletteShortcut={value.paletteShortcut} />
      <NotificationsMenu {...value.notifications} />
      <QuickAccessMenu {...value.quickAccess} />
      {value.account && <AccountMenu {...value.account} />}
    </div>
  );
}
