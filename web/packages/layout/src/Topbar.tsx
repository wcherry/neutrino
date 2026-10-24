'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Menu, Bell, Bug, Search, Settings, Import, LogOut, User, ChevronDown } from 'lucide-react';
import { useDismiss } from '@neutrino/commands';
import { usePresence } from '@neutrino/ui';
import { Avatar } from '@neutrino/ui';
import { useShell } from './AppShell';
import { formatRelativeTime, notificationLabel } from './notifications';
import { QuickAccessMenu, type QuickAccessMenuProps } from './shell/ShellMenus';
import styles from './Topbar.module.css';

export interface TopbarUser {
  name: string;
  email: string;
  avatarSrc?: string;
}

export interface TopbarAction {
  id: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  badge?: boolean;
}

export interface TopbarNotification {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
  /** Optional navigation URL — when set the notification item links to it. */
  href?: string;
}

export interface TopbarSearchResult {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  icon?: React.ReactNode;
  /** Icon tint, so results match how the same item is drawn elsewhere. */
  iconColor?: string;
  /** Date of last change, pre-formatted by the caller. */
  modified?: string;
}

export interface TopbarProps {
  user?: TopbarUser;
  /**
   * Opens the command palette, which is where files are searched — an icon beside the bell, as in
   * the new looks' top bar and the editors' title bars, rather than a box of its own.
   */
  onOpenPalette?: () => void;
  /** The palette's key, already formatted for this platform (`⌘K`), shown in the tooltip. */
  paletteShortcut?: string;
  /** Drive's Quick access list, as a menu between the bell and the avatar. */
  quickAccess?: Omit<QuickAccessMenuProps, 'placement' | 'triggerClassName'>;
  actions?: TopbarAction[];
  notifications?: TopbarNotification[];
  unreadNotificationCount?: number;
  onNotificationRead?: (id: string) => void;
  onMarkAllNotificationsRead?: () => void;
  /** Issue tracker URL, opened in a new tab by the bug button. Hidden when unset. */
  bugReportHref?: string;
  onSettings?: () => void;
  onImport?: () => void;
  onSignOut?: () => void;
  onProfileClick?: () => void;
  className?: string;
  children?: React.ReactNode;
}

export function Topbar({
  user,
  onOpenPalette,
  paletteShortcut,
  quickAccess,
  actions = [],
  notifications = [],
  unreadNotificationCount = 0,
  onNotificationRead,
  onMarkAllNotificationsRead,
  bugReportHref,
  onSettings,
  onImport,
  onSignOut,
  onProfileClick,
  className = '',
  children,
}: TopbarProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const notificationPanelRef = useRef<HTMLDivElement>(null);
  const { toggleSidebar } = useShell();
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userMenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userMenuOpen]);
  useDismiss(() => setUserMenuOpen(false), userMenuOpen);

  useEffect(() => {
    if (!notificationPanelOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (notificationPanelRef.current && !notificationPanelRef.current.contains(e.target as Node)) {
        setNotificationPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [notificationPanelOpen]);
  useDismiss(() => setNotificationPanelOpen(false), notificationPanelOpen);
  const notificationPanel = usePresence(notificationPanelOpen);
  const userMenu = usePresence(userMenuOpen);

  return (
    <header className={[styles.topbar, className].filter(Boolean).join(' ')}>
      {/* Mobile menu toggle */}
      <button
        type="button"
        className={styles['menu-btn']}
        onClick={toggleSidebar}
        aria-label="Toggle navigation menu"
      >
        <Menu size={20} />
      </button>

      {/* Actions */}
      <div className={styles.actions}>
        {children}

        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={styles['icon-btn']}
            onClick={action.onClick}
            aria-label={action.label}
          >
            {action.icon}
            {action.badge && (
              <span className={styles['notification-badge']} aria-label="New notification" />
            )}
          </button>
        ))}

        {onOpenPalette && (
          <button
            type="button"
            className={styles['icon-btn']}
            onClick={onOpenPalette}
            aria-haspopup="dialog"
            aria-label="Search and commands"
            title={paletteShortcut ? `Search files, people and commands (${paletteShortcut})` : 'Search files, people and commands'}
          >
            <Search size={18} />
          </button>
        )}

        {/* Notifications */}
        <div className={styles['user-menu-wrapper']} ref={notificationPanelRef}>
          <button
            type="button"
            className={styles['icon-btn']}
            aria-label="Notifications"
            aria-expanded={notificationPanelOpen}
            aria-haspopup="true"
            onClick={() => setNotificationPanelOpen((v) => !v)}
          >
            <Bell size={18} />
            {unreadNotificationCount > 0 && (
              <span className={styles['notification-badge']} aria-label={`${unreadNotificationCount} unread notifications`} />
            )}
          </button>

          {notificationPanel.mounted && (
            <div
              className={styles['notification-panel']}
              role="dialog"
              aria-label="Notifications"
              aria-hidden={notificationPanelOpen ? undefined : true}
              data-motion="rise"
              data-state={notificationPanel.state}
            >
              <div className={styles['notification-header']}>
                <span className={styles['notification-title']}>Notifications</span>
                {unreadNotificationCount > 0 && (
                  <button
                    type="button"
                    className={styles['notification-mark-all']}
                    onClick={() => { onMarkAllNotificationsRead?.(); }}
                  >
                    Mark all read
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <p className={styles['notification-empty']}>No notifications yet</p>
              ) : (
                <ul className={styles['notification-list']} role="list">
                  {notifications.map((n) => (
                    <li key={n.id} className={styles['notification-item']} data-unread={!n.isRead}>
                      {n.href ? (
                        <div className={styles['notification-item-btn']}>
                          <span className={styles['notification-item-text']}>
                            {notificationLabel(n)}
                          </span>
                          <div className={styles['notification-item-footer']}>
                            <span className={styles['notification-item-time']}>
                              {formatRelativeTime(n.createdAt)}
                            </span>
                            <a
                              href={n.href}
                              className={styles['notification-open-link']}
                              onClick={() => { if (!n.isRead) onNotificationRead?.(n.id); }}
                            >
                              Open
                            </a>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles['notification-item-btn']}
                          onClick={() => { if (!n.isRead) onNotificationRead?.(n.id); }}
                        >
                          <span className={styles['notification-item-text']}>
                            {notificationLabel(n)}
                          </span>
                          <span className={styles['notification-item-time']}>
                            {formatRelativeTime(n.createdAt)}
                          </span>
                        </button>
                      )}
                      {!n.isRead && <span className={styles['notification-dot']} aria-hidden="true" />}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {quickAccess && <QuickAccessMenu {...quickAccess} triggerClassName={styles['icon-btn']} />}

        {/* Report a bug — a link, not a button, so it can be opened however the
            reporter prefers and survives a popup blocker. */}
        {bugReportHref && (
          <a
            className={styles['icon-btn']}
            href={bugReportHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Report a bug"
            title="Report a bug"
          >
            <Bug size={18} aria-hidden="true" />
          </a>
        )}

        {/* User menu */}
        {user && (
          <div className={styles['user-menu-wrapper']} ref={userMenuRef}>
            <button
              type="button"
              className={styles['user-btn']}
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-expanded={userMenuOpen}
              aria-haspopup="true"
              aria-label="User menu"
            >
              <Avatar name={user.name} src={user.avatarSrc} size="sm" />
              <span className={styles['user-name']}>{user.name}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>

            {userMenu.mounted && (
              <div
                className={styles['user-menu']}
                role="menu"
                aria-label="User options"
                aria-hidden={userMenuOpen ? undefined : true}
                data-motion="rise"
                data-state={userMenu.state}
              >
                <div className={styles['user-info']}>
                  <p className={styles['user-display-name']}>{user.name}</p>
                  <p className={styles['user-email']}>{user.email}</p>
                </div>
                {onProfileClick && (
                  <button
                    type="button"
                    onClick={() => { setUserMenuOpen(false); onProfileClick(); }}
                    role="menuitem"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-2) var(--space-4)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-text-primary)',
                      textAlign: 'left',
                      transition: 'background-color var(--duration-fast) var(--ease-default)',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-subtle)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                    }}
                  >
                    <User size={16} aria-hidden="true" />
                    Profile
                  </button>
                )}
                {onSettings && (
                  <button
                    type="button"
                    onClick={() => { setUserMenuOpen(false); onSettings(); }}
                    role="menuitem"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-2) var(--space-4)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-text-primary)',
                      textAlign: 'left',
                      transition: 'background-color var(--duration-fast) var(--ease-default)',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-subtle)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                    }}
                  >
                    <Settings size={16} aria-hidden="true" />
                    Settings
                  </button>
                )}
                {onImport && (
                  <button
                    type="button"
                    onClick={() => { setUserMenuOpen(false); onImport(); }}
                    role="menuitem"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-2) var(--space-4)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-text-primary)',
                      textAlign: 'left',
                      transition: 'background-color var(--duration-fast) var(--ease-default)',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg-subtle)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                    }}
                  >
                    <Import size={16} aria-hidden="true" />
                    Import
                  </button>
                )}
                <div className={styles.divider} aria-hidden="true" />
                {onSignOut && (
                  <button
                    type="button"
                    onClick={() => { setUserMenuOpen(false); onSignOut(); }}
                    role="menuitem"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-2) var(--space-4)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-error)',
                      textAlign: 'left',
                      marginBottom: 'var(--space-1)',
                      transition: 'background-color var(--duration-fast) var(--ease-default)',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-error-subtle)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                    }}
                  >
                    <LogOut size={16} aria-hidden="true" />
                    Sign out
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
