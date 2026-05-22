'use client';

import React, { createContext, useContext, useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { fadeIn } from '../../motion/variants';
import styles from './Tabs.module.css';

export type TabsVariant = 'default' | 'pills';

interface TabsContextValue {
  activeTab: string;
  setActiveTab: (id: string) => void;
  variant: TabsVariant;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tab components must be used within <Tabs>');
  return ctx;
}

export interface TabsProps {
  defaultTab?: string;
  value?: string;
  onChange?: (tab: string) => void;
  variant?: TabsVariant;
  className?: string;
  children: React.ReactNode;
}

export function Tabs({
  defaultTab,
  value,
  onChange,
  variant = 'default',
  className = '',
  children,
}: TabsProps) {
  const baseId = useId();
  const [internalTab, setInternalTab] = useState(defaultTab ?? '');

  const activeTab = value ?? internalTab;
  const setActiveTab = (id: string) => {
    setInternalTab(id);
    onChange?.(id);
  };

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab, variant, baseId }}>
      <div className={[styles.tabs, className].filter(Boolean).join(' ')}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabListProps {
  className?: string;
  children: React.ReactNode;
}

export function TabList({ className = '', children }: TabListProps) {
  const { variant } = useTabsContext();

  const classes = [styles.list, variant === 'pills' ? styles.pills : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} role="tablist">
      {children}
    </div>
  );
}

export interface TabProps {
  id: string;
  disabled?: boolean;
  badge?: number | string;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export function Tab({ id, disabled = false, badge, icon, className = '', children }: TabProps) {
  const { activeTab, setActiveTab, baseId } = useTabsContext();
  const isActive = activeTab === id;

  const classes = [styles.tab, isActive ? styles.active : '', className].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${id}`}
      aria-controls={`${baseId}-panel-${id}`}
      aria-selected={isActive}
      disabled={disabled}
      className={classes}
      onClick={() => setActiveTab(id)}
      tabIndex={isActive ? 0 : -1}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
      {badge !== undefined && (
        <span className={styles['tab-badge']} aria-label={`${badge} items`}>
          {badge}
        </span>
      )}
    </button>
  );
}

export interface TabPanelProps {
  id: string;
  className?: string;
  children: React.ReactNode;
}

export function TabPanel({ id, className = '', children }: TabPanelProps) {
  const { activeTab, baseId } = useTabsContext();
  const isActive = activeTab === id;

  if (!isActive) return null;

  return (
    <motion.div
      id={`${baseId}-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`${baseId}-tab-${id}`}
      className={[styles.panel, className].filter(Boolean).join(' ')}
      tabIndex={0}
      {...fadeIn}
    >
      {children}
    </motion.div>
  );
}
