'use client';

import React from 'react';
import Link from 'next/link';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useShell } from '../AppShell';
import type { NavItem, NavSection, StorageQuota } from '../Sidebar';
import { BrandMark, type ShellBrand } from './BrandMark';
import styles from './ShellSidebar.module.css';

export interface ShellSidebarProps {
  sections: NavSection[];
  /** The "New" control, at the top. */
  newButton?: React.ReactNode;
  quota?: StorageQuota;
  onRequestStorage?: () => void;
  /**
   * The brand and collapse control as the sidebar's first row — the editor frame, which has no
   * top bar to carry them.
   */
  brand?: ShellBrand;
  logoHref?: string;
  showBrand?: boolean;
  /** Below everything — in the editor frame, the search, notification and account buttons. */
  footer?: React.ReactNode;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function NavEntry({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  const glyph = item.swatch ? (
    <span className={styles.swatch} style={{ background: item.swatch.color }} aria-hidden="true">
      {item.swatch.text}
    </span>
  ) : (
    <Icon
      size={17}
      strokeWidth={1.8}
      aria-hidden="true"
      // Apps wear their identity colour; Drive's views are muted, the active one the accent.
      style={{ color: item.color ?? (item.active ? 'var(--brand-accent)' : 'var(--text-3)') }}
    />
  );
  const content = (
    <>
      <span className={styles.glyph}>{glyph}</span>
      {!collapsed && <span className={styles.label}>{item.label}</span>}
      {!collapsed && item.badge !== undefined && <span className={styles.badge}>{item.badge}</span>}
    </>
  );
  const props = {
    className: item.nested ? `${styles.item} ${styles.itemNested}` : styles.item,
    'aria-current': item.active ? ('page' as const) : undefined,
    title: collapsed ? item.label : undefined,
  };
  if (item.href && item.external) {
    return <a href={item.href} target="_blank" rel="noopener noreferrer" {...props}>{content}</a>;
  }
  return item.href ? (
    <Link href={item.href} {...props}>{content}</Link>
  ) : (
    <button type="button" onClick={item.onClick} {...props}>{content}</button>
  );
}

/**
 * The new shell's sidebar (look-and-feel roadmap §2): New, then Drive's views, then **Apps**, then
 * Teams, tags and administration — the sections the app passes — and the storage meter. A card in
 * Quiet Precision; part of the page in the flows. Collapses to a rail of icons.
 */
export function ShellSidebar({
  sections,
  newButton,
  quota,
  onRequestStorage,
  brand,
  logoHref = '/drive',
  showBrand = false,
  footer,
}: ShellSidebarProps) {
  const { sidebarCollapsed: collapsed, toggleSidebarCollapsed } = useShell();
  const percent = quota && quota.totalBytes > 0 ? Math.min(100, (quota.usedBytes / quota.totalBytes) * 100) : 0;
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const collapse = (
    <button
      type="button"
      className={styles['collapse-btn']}
      onClick={toggleSidebarCollapsed}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      <CollapseIcon size={16} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );

  return (
    <aside className={styles.sidebar} data-collapsed={collapsed || undefined} aria-label="Application navigation">
      {showBrand && (
        <div className={styles['brand-row']}>
          <BrandMark brand={brand} href={logoHref} compact={collapsed} />
          {!collapsed && collapse}
        </div>
      )}
      {newButton && <div className={styles.new}>{newButton}</div>}
      <nav className={styles.nav} aria-label="Primary navigation">
        {sections.map((section) => (
          <div key={section.id} className={styles.section}>
            {section.label && !collapsed && <p className={styles['section-label']}>{section.label}</p>}
            {section.items.map((item) => (
              <NavEntry key={item.id} item={item} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </nav>
      <div className={styles.foot}>
        {quota && !collapsed && (
          <div className={styles.quota} data-tour="storage">
            <div className={styles['quota-row']}>
              <span>Storage</span>
              <span className={styles.mono}>
                {formatBytes(quota.usedBytes)} / {formatBytes(quota.totalBytes)}
              </span>
            </div>
            <div
              className={styles.track}
              role="progressbar"
              aria-valuenow={Math.round(percent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Storage usage"
            >
              <div className={styles.fill} data-level={percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : undefined} style={{ width: `${percent}%` }} />
            </div>
            {onRequestStorage && (
              <button type="button" className={styles['quota-link']} onClick={onRequestStorage}>
                Request more storage
              </button>
            )}
          </div>
        )}
        <div className={styles['foot-row']}>
          {footer}
          {(!showBrand || collapsed) && collapse}
        </div>
      </div>
    </aside>
  );
}
