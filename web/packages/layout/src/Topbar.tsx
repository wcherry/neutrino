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

export interface TopbarProps {
  user?: TopbarUser;
  onSearch?: (query: string) => void;
  searchPlaceholder?: string;
  actions?: TopbarAction[];
  onSettings?: () => void;
  onSignOut?: () => void;
  onProfileClick?: () => void;
  className?: string;
  children?: React.ReactNode;
}

export function Topbar({
  user,
  onSearch,
  searchPlaceholder = 'Search files...',
  actions = [],
  onSettings,
  onSignOut,
  onProfileClick,
  className = '',
  children,
}: TopbarProps) {
  const [searchValue, setSearchValue] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { toggleSidebar } = useShell();
  const userMenuRef = useRef<HTMLDivElement>(null);

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

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
    onSearch?.(e.target.value);
  };

  const handleSearchClear = () => {
    setSearchValue('');
    onSearch?.('');
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
        <div className={styles['search-wrapper']}>
          <SearchInput
            variant="subtle"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={handleSearchChange}
            onClear={handleSearchClear}
            aria-label="Search"
          />
        </div>
      )}

      {children}

      {/* Actions */}
      <div className={styles.actions}>
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
        <button
          type="button"
          className={styles['icon-btn']}
          aria-label="Notifications"
        >
          <Bell size={18} />
        </button>

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
