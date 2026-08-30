'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import styles from './AppShell.module.css';

/**
 * The collapse state is a user preference, not per-page state: it outlives a
 * refresh and follows the user from one app to the next. Stored like the other
 * preferences (theme, calendar week start) — localStorage, plus a `storage`
 * listener so a second tab picks the change up.
 */
const SIDEBAR_COLLAPSED_KEY = 'neutrino.sidebar.collapsed';

function readStoredCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    // localStorage unavailable (private browsing restrictions, etc.)
    return false;
  }
}

function writeStoredCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Nothing to do — the sidebar still collapses, it just won't be remembered.
  }
}

interface ShellContextValue {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
}

const ShellContext = createContext<ShellContextValue>({
  sidebarOpen: false,
  toggleSidebar: () => {},
  closeSidebar: () => {},
  sidebarCollapsed: false,
  toggleSidebarCollapsed: () => {},
});

export function useShell() {
  return useContext(ShellContext);
}

export interface AppShellProps {
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function AppShell({ sidebar, topbar, children, className = '' }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Starts expanded and is corrected on mount rather than read in the
  // initialiser: this renders on the server too, and reading storage there
  // would make the markup disagree with the client's on hydration.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const collapsedRef = useRef(sidebarCollapsed);
  collapsedRef.current = sidebarCollapsed;

  useEffect(() => {
    setSidebarCollapsed(readStoredCollapsed());

    const onStorage = (e: StorageEvent) => {
      if (e.key !== SIDEBAR_COLLAPSED_KEY) return;
      setSidebarCollapsed(readStoredCollapsed());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleSidebar = () => setSidebarOpen((v) => !v);
  const closeSidebar = () => setSidebarOpen(false);
  const toggleSidebarCollapsed = () => {
    const next = !collapsedRef.current;
    collapsedRef.current = next;
    setSidebarCollapsed(next);
    writeStoredCollapsed(next);
  };

  const shellClasses = [styles.shell, sidebarCollapsed ? styles['sidebar-collapsed'] : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <ShellContext.Provider value={{ sidebarOpen, toggleSidebar, closeSidebar, sidebarCollapsed, toggleSidebarCollapsed }}>
      <div className={shellClasses}>
        {/* Sidebar */}
        <div
          className={[
            styles['sidebar-area'],
            sidebarOpen ? styles['mobile-open'] : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {sidebar}
        </div>

        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className={[styles['mobile-backdrop'], styles.visible].join(' ')}
            onClick={closeSidebar}
            aria-hidden="true"
          />
        )}

        {/* Topbar */}
        <div className={styles['topbar-area']}>{topbar}</div>

        {/* Main content */}
        <main className={styles.main} id="main-content">
          <div className={styles['main-inner']}>{children}</div>
        </main>
      </div>
    </ShellContext.Provider>
  );
}
