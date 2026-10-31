'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
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
  /**
   * The running build's short label (`v0.1.42`), shown at the foot. Omitted or empty renders
   * nothing, so a build with no version to report shows none.
   */
  version?: string;
  /** The long form for the tooltip and the copy button, e.g. `Neutrino v0.1.42 (a1b2c3d)`. */
  versionTitle?: string;
}

/** How long the copy button shows its checkmark before fading back. */
const COPIED_FEEDBACK_MS = 3000;

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
  version,
  versionTitle,
}: ShellSidebarProps) {
  const { sidebarCollapsed: collapsed, toggleSidebarCollapsed } = useShell();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Collapsing unmounts the version, and the timer must not set state after that.
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  /** Copies the long form: the commit is the half of it that identifies the build in a bug report. */
  async function copyVersion() {
    const text = versionTitle ?? version;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard (insecure origin, permission refused): no checkmark for a copy that didn't happen.
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }

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
          {/* The running build, without opening Settings. Hidden on the rail, as the quota is. */}
          {version && !collapsed && (
            <div className={styles.version}>
              <span className={styles['version-label']} title={versionTitle ?? version}>
                {version}
              </span>
              <button
                type="button"
                className={styles['version-copy']}
                data-copied={copied || undefined}
                onClick={copyVersion}
                title={copied ? 'Copied' : 'Copy version'}
                aria-label={copied ? 'Version copied' : 'Copy version'}
              >
                <Copy className={styles['copy-icon']} size={13} aria-hidden="true" />
                <Check className={styles['check-icon']} size={13} aria-hidden="true" />
              </button>
            </div>
          )}
          {footer}
          {(!showBrand || collapsed) && collapse}
        </div>
      </div>
    </aside>
  );
}
