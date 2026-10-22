'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Bell, Bug, Import, LogOut, Settings, User } from 'lucide-react';
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

export interface AccountMenuProps {
  user: TopbarUser;
  onProfile?: () => void;
  onSettings?: () => void;
  onImport?: () => void;
  onSignOut?: () => void;
  /** Issue tracker, opened in a new tab. */
  bugReportHref?: string;
  placement?: 'below' | 'above';
}

export function AccountMenu({ user, onProfile, onSettings, onImport, onSignOut, bugReportHref, placement = 'below' }: AccountMenuProps) {
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
