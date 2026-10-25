'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Bell, Bug, Compass, History, Import, LogOut, Search, Settings, Star, User } from 'lucide-react';
import { useDismiss } from '@neutrino/commands';
import { Avatar, usePresence } from '@neutrino/ui';
import type { TopbarNotification, TopbarUser } from '../Topbar';
import { formatRelativeTime, notificationLabel } from '../notifications';
import styles from './ShellMenus.module.css';

/** Open on click, closed by a click outside or Escape (the topmost layer only). */
function usePopup() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useDismiss(() => setOpen(false), open);
  const presence = usePresence(open);
  return { open, setOpen, ref, presence };
}

export interface SearchButtonProps {
  /** Opens the command palette, which is also where files are searched. */
  onOpenPalette: () => void;
  /** The palette's key, already formatted for this platform (`⌘K`), shown in the tooltip. */
  paletteShortcut?: string;
}

/**
 * Search, as an icon beside the bell. The palette is where the typing happens, so a field in the bar
 * only ever stood for the palette; one icon reads the same in the top bar and an editor's title bar.
 */
export function SearchButton({ onOpenPalette, paletteShortcut }: SearchButtonProps) {
  return (
    <button
      type="button"
      className={styles['icon-btn']}
      onClick={onOpenPalette}
      aria-haspopup="dialog"
      aria-label="Search and commands"
      title={paletteShortcut ? `Search files, people and commands (${paletteShortcut})` : 'Search files, people and commands'}
    >
      <Search size={18} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

export interface NotificationsMenuProps {
  notifications: TopbarNotification[];
  unreadCount: number;
  onRead?: (id: string) => void;
  onMarkAllRead?: () => void;
  /** Where the panel opens from: below a top-bar button, or above one in the sidebar's footer. */
  placement?: 'below' | 'above';
}

export function NotificationsMenu({ notifications, unreadCount, onRead, onMarkAllRead, placement = 'below' }: NotificationsMenuProps) {
  const { open, setOpen, ref, presence } = usePopup();
  return (
    <div className={styles.anchor} ref={ref}>
      <button
        type="button"
        className={styles['icon-btn']}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={18} strokeWidth={1.8} aria-hidden="true" />
        {unreadCount > 0 && <span className={styles.dot} aria-hidden="true" />}
      </button>
      {presence.mounted && (
        <div
          className={[styles.popup, styles.wide, styles[placement]].join(' ')}
          role="dialog"
          aria-label="Notifications"
          aria-hidden={open ? undefined : true}
          data-motion="rise"
          data-state={presence.state}
        >
          <div className={styles['popup-header']}>
            <span className={styles['popup-title']}>Notifications</span>
            {unreadCount > 0 && (
              <button type="button" className={styles['text-btn']} onClick={() => onMarkAllRead?.()}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className={styles.empty}>No notifications yet</p>
          ) : (
            <ul className={styles.list}>
              {notifications.map((n) => (
                <li key={n.id} className={styles.notification} data-unread={!n.isRead || undefined}>
                  <span className={styles['notification-text']}>{notificationLabel(n)}</span>
                  <span className={styles['notification-meta']}>
                    {formatRelativeTime(n.createdAt)}
                    {n.href ? (
                      <a href={n.href} className={styles['text-btn']} onClick={() => { if (!n.isRead) onRead?.(n.id); }}>
                        Open
                      </a>
                    ) : (
                      !n.isRead && (
                        <button type="button" className={styles['text-btn']} onClick={() => onRead?.(n.id)}>
                          Mark read
                        </button>
                      )
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export interface QuickAccessItem {
  id: string;
  title: string;
  /** Pre-formatted by the caller, e.g. "Edited · Yesterday". */
  subtitle: string;
  icon?: React.ReactNode;
  iconColor?: string;
  starred?: boolean;
}

export interface QuickAccessMenuProps {
  /** Undefined while loading. */
  items: QuickAccessItem[] | undefined;
  onOpen: (id: string) => void;
  /** The trigger's class, for a top bar whose icon buttons are styled its own way (the classic one). */
  triggerClassName?: string;
  placement?: 'below' | 'above';
}

/**
 * The same list as Drive's Quick access, from anywhere: the bar's button between the bell and the
 * avatar. The app decides what is in it (`useQuickAccess`); this only draws it.
 */
export function QuickAccessMenu({ items, onOpen, triggerClassName, placement = 'below' }: QuickAccessMenuProps) {
  const { open, setOpen, ref, presence } = usePopup();
  return (
    <div className={styles.anchor} ref={ref}>
      <button
        type="button"
        className={triggerClassName ?? styles['icon-btn']}
        aria-label="Quick access"
        title="Quick access"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <History size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {presence.mounted && (
        <div
          className={[styles.popup, styles.wide, styles[placement]].join(' ')}
          role="dialog"
          aria-label="Quick access"
          aria-hidden={open ? undefined : true}
          data-motion="rise"
          data-state={presence.state}
        >
          <div className={styles['popup-header']}>
            <span className={styles['popup-title']}>Quick access</span>
          </div>
          {!items ? (
            <p className={styles.empty}>Loading…</p>
          ) : items.length === 0 ? (
            <p className={styles.empty}>Files you edit or star appear here.</p>
          ) : (
            <ul className={styles.list}>
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={styles['quick-item']}
                    onClick={() => {
                      setOpen(false);
                      onOpen(item.id);
                    }}
                  >
                    <span className={styles['quick-icon']} style={item.iconColor ? { color: item.iconColor } : undefined} aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className={styles['quick-text']}>
                      <span className={styles['quick-title']}>{item.title}</span>
                      <span className={styles['quick-sub']}>
                        {item.starred && <Star size={11} className={styles['quick-star']} aria-label="Starred" />}
                        {item.subtitle}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export interface AccountMenuProps {
  user: TopbarUser;
  onProfile?: () => void;
  onSettings?: () => void;
  onImport?: () => void;
  onSignOut?: () => void;
  /** Issue tracker, opened in a new tab. */
  bugReportHref?: string;
  /**
   * Replays the current app's guided tour, labelled `tourLabel` ("Take the Drive tour"). The shell
   * has no Help menu, so it sits here beside Report a bug; shown only with both.
   */
  onTakeTour?: () => void;
  tourLabel?: string;
  placement?: 'below' | 'above';
}

export function AccountMenu({
  user,
  onProfile,
  onSettings,
  onImport,
  onSignOut,
  bugReportHref,
  onTakeTour,
  tourLabel,
  placement = 'below',
}: AccountMenuProps) {
  const { open, setOpen, ref, presence } = usePopup();
  const item = (label: string, Icon: typeof User, run?: () => void, danger = false) =>
    run && (
      <button
        type="button"
        role="menuitem"
        className={[styles.item, danger ? styles.danger : ''].filter(Boolean).join(' ')}
        onClick={() => { setOpen(false); run(); }}
      >
        <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
        {label}
      </button>
    );
  return (
    <div className={styles.anchor} ref={ref}>
      <button
        type="button"
        className={styles.avatar}
        aria-label="Account"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar name={user.name} src={user.avatarSrc} size="sm" />
      </button>
      {presence.mounted && (
        <div
          className={[styles.popup, styles[placement], placement === 'above' ? styles['align-start'] : ''].filter(Boolean).join(' ')}
          role="menu"
          aria-label="Account"
          aria-hidden={open ? undefined : true}
          data-motion="rise"
          data-state={presence.state}
        >
          <div className={styles.who}>
            <span className={styles['who-name']}>{user.name}</span>
            <span className={styles['who-email']}>{user.email}</span>
          </div>
          <div className={styles.group}>
            {item('Profile', User, onProfile)}
            {item('Settings', Settings, onSettings)}
            {item('Import', Import, onImport)}
            {tourLabel && item(tourLabel, Compass, onTakeTour)}
            {bugReportHref && (
              <a
                role="menuitem"
                className={styles.item}
                href={bugReportHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <Bug size={16} strokeWidth={1.8} aria-hidden="true" />
                Report a bug
              </a>
            )}
          </div>
          <div className={styles.group}>{item('Sign out', LogOut, onSignOut, true)}</div>
        </div>
      )}
    </div>
  );
}
