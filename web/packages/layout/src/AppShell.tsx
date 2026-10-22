'use client';

import React, { createContext, useContext, useState } from 'react';
import { usePreference } from '@neutrino/preferences';
import styles from './AppShell.module.css';
import frame from './shell/ShellFrame.module.css';

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
  /**
   * `classic` is today's shell: the sidebar's logo row beside a separate top bar. `flow` is the
   * new one the three new looks use (look-and-feel roadmap §2, "Structure"): one top bar across
   * the width, the sidebar and the page below it as regions — cards in Quiet Precision, one
   * seamless surface in the flows. Which one is the caller's choice, from `appearance.look`.
   */
  variant?: 'classic' | 'flow';
  /**
   * `editor` drops the top bar so an editor's own title bar is the first row (the editor frame);
   * the sidebar stays, with its collapse control. Only the `flow` variant has an editor frame.
   */
  chrome?: 'full' | 'editor';
}

export function AppShell({ sidebar, topbar, children, className = '', variant = 'classic', chrome = 'full' }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // A device preference (`shell.sidebarCollapsed`): it outlives a refresh and follows the user
  // from one app to the next, but a laptop and a wide monitor want different answers, so it is
  // not synced. The server render reads the default (expanded), as it always did.
  const [sidebarCollapsed, setSidebarCollapsed] = usePreference('shell.sidebarCollapsed');

  const toggleSidebar = () => setSidebarOpen((v) => !v);
  const closeSidebar = () => setSidebarOpen(false);
  const toggleSidebarCollapsed = () => setSidebarCollapsed(!sidebarCollapsed);

  const shellClasses = [styles.shell, sidebarCollapsed ? styles['sidebar-collapsed'] : '', className]
    .filter(Boolean)
    .join(' ');

  if (variant === 'flow') {
    return (
      <ShellContext.Provider value={{ sidebarOpen, toggleSidebar, closeSidebar, sidebarCollapsed, toggleSidebarCollapsed }}>
        <div
          className={[frame.frame, className].filter(Boolean).join(' ')}
          data-chrome={chrome}
          data-collapsed={sidebarCollapsed || undefined}
        >
          {chrome === 'full' && <div className={frame.bar}>{topbar}</div>}
          <div className={frame.body}>
            <div className={[frame.side, sidebarOpen ? frame['mobile-open'] : ''].filter(Boolean).join(' ')}>
              {sidebar}
            </div>
            {sidebarOpen && <div className={frame.backdrop} onClick={closeSidebar} aria-hidden="true" />}
            <main className={frame.main} id="main-content">
              <div className={frame.inner}>{children}</div>
            </main>
          </div>
        </div>
      </ShellContext.Provider>
    );
  }

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
