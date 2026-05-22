'use client';

import React, { createContext, useContext, useState } from 'react';
import styles from './AppShell.module.css';

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = () => setSidebarOpen((v) => !v);
  const closeSidebar = () => setSidebarOpen(false);
  const toggleSidebarCollapsed = () => setSidebarCollapsed((v) => !v);

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
