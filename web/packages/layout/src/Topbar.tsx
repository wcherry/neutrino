'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Menu, Bell, Settings, LogOut, User, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { slideUp } from './variants';
import { SearchInput } from '@neutrino/ui';
import { Avatar } from '@neutrino/ui';
import { useShell } from './AppShell';
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
}

export interface TopbarProps {
  user?: TopbarUser;
  onSearch?: (query: string) => void;
  searchPlaceholder?: string;
  searchResults?: TopbarSearchResult[];
  onResultClick?: (result: TopbarSearchResult) => void;
  actions?: TopbarAction[];
  notifications?: TopbarNotification[];
  unreadNotificationCount?: number;
  onNotificationRead?: (id: string) => void;
  onMarkAllNotificationsRead?: () => void;
  onSettings?: () => void;
  onSignOut?: () => void;
  onProfileClick?: () => void;
  className?: string;
  children?: React.ReactNode;
}

function notificationLabel(n: TopbarNotification): string {
  const payload = n.payload as Record<string, string>;
  const type = payload.resourceType === 'folder' ? 'folder' : 'file';
  const name = payload.resourceName;

  if (n.eventType === 'file_access_revoked' || n.eventType === 'folder_access_revoked') {
    if (name) {
      return `Your access to the ${type} "${name}" has been revoked`;
    }
    return `Your access to a ${type} has been revoked`;
  }

  const role = payload.role ?? 'access';
  if (name) {
    return `You were granted ${role} access to the ${type} "${name}"`;
  }
  return `You were granted ${role} access to a ${type}`;
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function Topbar({
  user,
  onSearch,
  searchPlaceholder = 'Search files...',
  searchResults,
  onResultClick,
  actions = [],
  notifications = [],
  unreadNotificationCount = 0,
  onNotificationRead,
  onMarkAllNotificationsRead,
  onSettings,
  onSignOut,
  onProfileClick,
  className = '',
  children,
}: TopbarProps) {
  const [searchValue, setSearchValue] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const notificationPanelRef = useRef<HTMLDivElement>(null);
  const { toggleSidebar } = useShell();
  const userMenuRef = useRef<HTMLDivElement>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userMenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUserMenuOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    if (!notificationPanelOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (notificationPanelRef.current && !notificationPanelRef.current.contains(e.target as Node)) {
        setNotificationPanelOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotificationPanelOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [notificationPanelOpen]);

  useEffect(() => {
    if (!searchDropdownOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node)) {
        setSearchDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchDropdownOpen(false);
        setSearchValue('');
        onSearch?.('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [searchDropdownOpen, onSearch]);

  useEffect(() => {
    if (searchResults && searchResults.length > 0 && searchValue.length >= 3) {
      setSearchDropdownOpen(true);
    } else {
      setSearchDropdownOpen(false);
    }
  }, [searchResults, searchValue]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
    onSearch?.(e.target.value);
  };

  const handleSearchClear = () => {
    setSearchValue('');
    onSearch?.('');
    setSearchDropdownOpen(false);
  };

  const handleResultClick = (result: TopbarSearchResult) => {
    setSearchDropdownOpen(false);
    setSearchValue('');
    onSearch?.('');
    onResultClick?.(result);
  };

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

      {/* Search */}
      {onSearch && (
        <div className={styles['search-wrapper']} ref={searchWrapperRef}>
          <SearchInput
            variant="subtle"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={handleSearchChange}
            onClear={handleSearchClear}
            aria-label="Search"
            aria-expanded={searchDropdownOpen}
            aria-autocomplete="list"
          />
          {searchDropdownOpen && searchResults && searchResults.length > 0 && (
            <ul className={styles['search-dropdown']} role="listbox" aria-label="Search results">
              {searchResults.map((result) => (
                <li key={result.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    className={styles['search-result-btn']}
                    onMouseDown={() => handleResultClick(result)}
                  >
                    {result.icon && (
                      <span className={styles['search-result-icon']} aria-hidden="true">
                        {result.icon}
                      </span>
                    )}
                    <span className={styles['search-result-text']}>
                      <span className={styles['search-result-title']}>{result.title}</span>
                      <span className={styles['search-result-subtitle']}>{result.subtitle}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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

          <AnimatePresence>
            {notificationPanelOpen && (
              <motion.div
                className={styles['notification-panel']}
                role="dialog"
                aria-label="Notifications"
                {...slideUp}
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>

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

            <AnimatePresence>
              {userMenuOpen && (
                <motion.div
                  className={styles['user-menu']}
                  role="menu"
                  aria-label="User options"
                  {...slideUp}
                >
                  <div className={styles['user-info']}>
                    <p className={styles['user-display-name']}>{user.name}</p>
                    <p className={styles['user-email']}>{user.email}</p>
                  </div>
                  {onProfileClick && (
                    <button
                      type="button"
                      className={`${styles['icon-btn']} ${styles['menu-item']}`}
                      onClick={() => { setUserMenuOpen(false); onProfileClick(); }}
                      role="menuitem"
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-2) var(--space-4)',
                        borderRadius: 0,
                        fontSize: 'var(--text-sm)',
                        color: 'var(--color-text-primary)',
                        height: 'auto',
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
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </header>
  );
}
