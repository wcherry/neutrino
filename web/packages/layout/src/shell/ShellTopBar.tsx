'use client';

import React from 'react';
import { Lock, Menu, Search } from 'lucide-react';
import { useShell } from '../AppShell';
import type { TopbarNotification, TopbarUser } from '../Topbar';
import { BrandMark, type ShellBrand } from './BrandMark';
import { AccountMenu, NotificationsMenu, type AccountMenuProps } from './ShellMenus';
import styles from './ShellTopBar.module.css';

export interface ShellTopBarProps {
  brand?: ShellBrand;
  logoHref: string;
  /** Opens the command palette, which is also where files are searched. */
  onOpenPalette: () => void;
  /** The palette's key, already formatted for this platform (`⌘K`). */
  paletteShortcut?: string;
  searchPlaceholder?: string;
  user?: TopbarUser;
  notifications?: TopbarNotification[];
  unreadNotificationCount?: number;
  onNotificationRead?: (id: string) => void;
  onMarkAllNotificationsRead?: () => void;
  account?: Omit<AccountMenuProps, 'user' | 'placement'>;
}

/**
 * The one top bar of the new shell (look-and-feel roadmap §2): the brand, a search field that
 * opens the command palette, the end-to-end-encryption pill as a quiet trust signal, notifications
 * and the account menu. It replaces the classic shell's logo row and top bar.
 */
export function ShellTopBar({
  brand,
  logoHref,
  onOpenPalette,
  paletteShortcut,
  searchPlaceholder = 'Search files, people and commands',
  user,
  notifications = [],
  unreadNotificationCount = 0,
  onNotificationRead,
  onMarkAllNotificationsRead,
  account,
}: ShellTopBarProps) {
  const { toggleSidebar } = useShell();
  return (
    <header className={styles.bar}>
      <button type="button" className={styles['menu-btn']} onClick={toggleSidebar} aria-label="Toggle navigation menu">
        <Menu size={20} aria-hidden="true" />
      </button>
      <div className={styles.brand}>
        <BrandMark brand={brand} href={logoHref} />
      </div>
      {/* A button that looks like a field: the palette is the search, so typing happens there. */}
      <button type="button" className={styles.search} onClick={onOpenPalette} aria-haspopup="dialog" aria-label="Search and commands">
        <Search size={16} strokeWidth={2} aria-hidden="true" />
        <span className={styles['search-text']}>{searchPlaceholder}</span>
        {paletteShortcut && <kbd className={styles.kbd}>{paletteShortcut}</kbd>}
      </button>
      <div className={styles.spacer} />
      <span
        className={styles.pill}
        title="Files are encrypted on this device before they are uploaded. The server stores them but cannot read them."
      >
        <Lock size={13} strokeWidth={2.2} aria-hidden="true" />
        <span className={styles['pill-text']}>End-to-end encrypted</span>
      </span>
      <NotificationsMenu
        notifications={notifications}
        unreadCount={unreadNotificationCount}
        onRead={onNotificationRead}
        onMarkAllRead={onMarkAllNotificationsRead}
      />
      {user && <AccountMenu user={user} {...account} />}
    </header>
  );
}
