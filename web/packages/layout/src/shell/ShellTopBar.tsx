'use client';

import React from 'react';
import { Lock, Menu } from 'lucide-react';
import { useShell } from '../AppShell';
import type { TopbarNotification, TopbarUser } from '../Topbar';
import { BrandMark, type ShellBrand } from './BrandMark';
import { AccountMenu, NotificationsMenu, QuickAccessMenu, SearchButton, type AccountMenuProps, type QuickAccessMenuProps } from './ShellMenus';
import styles from './ShellTopBar.module.css';

export interface ShellTopBarProps {
  brand?: ShellBrand;
  logoHref: string;
  /** Opens the command palette, which is also where files are searched. */
  onOpenPalette: () => void;
  /** The palette's key, already formatted for this platform (`⌘K`). */
  paletteShortcut?: string;
  user?: TopbarUser;
  notifications?: TopbarNotification[];
  unreadNotificationCount?: number;
  onNotificationRead?: (id: string) => void;
  onMarkAllNotificationsRead?: () => void;
  account?: Omit<AccountMenuProps, 'user' | 'placement'>;
  /** Drive's Quick access list, as a menu between the bell and the avatar. */
  quickAccess?: Omit<QuickAccessMenuProps, 'placement' | 'triggerClassName'>;
}

/**
 * The one top bar of the new shell (look-and-feel roadmap §2): the brand, the end-to-end-encryption
 * pill as a quiet trust signal, and search (which opens the command palette), notifications and the
 * account menu. It replaces the classic shell's logo row and top bar.
 */
export function ShellTopBar({
  brand,
  logoHref,
  onOpenPalette,
  paletteShortcut,
  user,
  notifications = [],
  unreadNotificationCount = 0,
  onNotificationRead,
  onMarkAllNotificationsRead,
  account,
  quickAccess,
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
      <div className={styles.spacer} />
      <span
        className={styles.pill}
        title="Files are encrypted on this device before they are uploaded. The server stores them but cannot read them."
      >
        <Lock size={13} strokeWidth={2.2} aria-hidden="true" />
        <span className={styles['pill-text']}>End-to-end encrypted</span>
      </span>
      <SearchButton onOpenPalette={onOpenPalette} paletteShortcut={paletteShortcut} />
      <NotificationsMenu
        notifications={notifications}
        unreadCount={unreadNotificationCount}
        onRead={onNotificationRead}
        onMarkAllRead={onMarkAllNotificationsRead}
      />
      {quickAccess && <QuickAccessMenu {...quickAccess} />}
      {user && <AccountMenu user={user} {...account} />}
    </header>
  );
}
