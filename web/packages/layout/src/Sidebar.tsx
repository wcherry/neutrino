'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Cloud, Upload, ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useShell } from './AppShell';
import styles from './Sidebar.module.css';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  badge?: number | string;
}

export interface NavSection {
  id: string;
  label?: string;
  items: NavItem[];
}

export interface StorageQuota {
  usedBytes: number;
  totalBytes: number;
}

export interface SidebarProps {
  logoText?: string;
  logoHref?: string;
  sections?: NavSection[];
  quota?: StorageQuota;
  /**
   * Opens whatever the embedder uses to ask an admin for more storage
   * (issue #144). Given, the meter offers "Request Additional"; omitted, it
   * offers nothing — this package has no API dependencies, so the ask itself
   * belongs to the app.
   */
  onRequestStorage?: () => void;
  onUpload?: (files: FileList) => void;
  className?: string;
  /**
   * Shown in the sidebar footer, e.g. `v0.1.0`. Omitted when absent rather than
   * rendered empty, so an embedder with no version to report shows no footer.
   */
  version?: string;
  /** Longer form for the footer's tooltip, e.g. `v0.1.0 (a1b2c3d)`. */
  versionTitle?: string;
}

/** How long the checkmark stands in for the copy icon after a copy. */
const COPIED_FEEDBACK_MS = 3000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function Sidebar({
  logoText = 'Neutrino',
  logoHref = '/',
  sections = [],
  quota,
  onRequestStorage,
  onUpload,
  className = '',
  version,
  versionTitle,
}: SidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { sidebarCollapsed, toggleSidebarCollapsed } = useShell();
  const quotaPercent =
    quota && quota.totalBytes > 0
      ? Math.min(100, (quota.usedBytes / quota.totalBytes) * 100)
      : 0;

  const quotaBarClass =
    quotaPercent >= 90
      ? styles.danger
      : quotaPercent >= 75
      ? styles.warning
      : '';

  const collapsed = sidebarCollapsed;
  const sidebarClass = [styles.sidebar, collapsed ? styles.collapsed : '', className]
    .filter(Boolean)
    .join(' ');

  // The timer outlives a fast unmount — collapsing the sidebar unmounts the
  // footer — and setting state afterwards would warn about an unmounted tree.
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  /**
   * Copy the *long* form — `v0.1.42 (a1b2c3d)` where the footer only has room
   * for `v0.1.42`. Someone copying a version is about to paste it into a bug
   * report, and the commit is the half that identifies the build.
   */
  async function copyVersion() {
    const text = versionTitle ?? version;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard (insecure origin, permission refused). Leave the icon as
      // it was rather than showing a checkmark for a copy that did not happen.
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }

  return (
    <aside className={sidebarClass} aria-label="Application navigation">
      {/* Logo row + collapse toggle */}
      <div className={styles['logo-row']}>
        <Link className={styles.logo} href={logoHref} aria-label={`${logoText} home`} title={collapsed ? logoText : undefined}>
          <span className={styles['logo-icon']} aria-hidden="true">
            <Cloud size={20} />
          </span>
          {!collapsed && <span className={styles['logo-text']}>{logoText}</span>}
        </Link>
        <button
          type="button"
          className={styles['collapse-btn']}
          onClick={toggleSidebarCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Upload */}
      {onUpload && (
        <div className={styles['upload-area']}>
          <button
            type="button"
            className={[styles['upload-btn'], dragOver ? styles['drag-over'] : ''].filter(Boolean).join(' ')}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length > 0) onUpload(e.dataTransfer.files);
            }}
            title={collapsed ? 'Upload files' : undefined}
          >
            <Upload size={16} aria-hidden="true" />
            {!collapsed && 'Upload files'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onUpload(e.target.files);
                e.target.value = '';
              }
            }}
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>
      )}

      {/* Navigation */}
      <nav className={styles.nav} aria-label="Primary navigation">
        {sections.map((section) => (
          <div key={section.id} className={styles['nav-section']}>
            {section.label && !collapsed && (
              <p className={styles['nav-section-label']} aria-hidden="true">
                {section.label}
              </p>
            )}
            {section.items.map((item) => {
              const IconComponent = item.icon;
              const classes = [styles['nav-item'], item.active ? styles.active : '']
                .filter(Boolean)
                .join(' ');

              if (item.href) {
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={classes}
                    aria-current={item.active ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className={styles['nav-icon']} aria-hidden="true">
                      <IconComponent size={18} strokeWidth={1.75} />
                    </span>
                    {!collapsed && <span className={styles['nav-label']}>{item.label}</span>}
                    {!collapsed && item.badge !== undefined && (
                      <span className={styles['nav-badge']} aria-label={`${item.badge} items`}>
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  className={classes}
                  onClick={item.onClick}
                  aria-current={item.active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                >
                  <span className={styles['nav-icon']} aria-hidden="true">
                    <IconComponent size={18} strokeWidth={1.75} />
                  </span>
                  {!collapsed && <span className={styles['nav-label']}>{item.label}</span>}
                  {!collapsed && item.badge !== undefined && (
                    <span className={styles['nav-badge']} aria-label={`${item.badge} items`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Storage quota */}
      {quota && !collapsed && (
        <div className={styles.quota}>
          <div className={styles['quota-header']}>
            <span className={styles['quota-label']}>Storage</span>
            <span className={styles['quota-value']}>{Math.round(quotaPercent)}%</span>
          </div>
          <div
            className={styles['quota-track']}
            role="progressbar"
            aria-valuenow={Math.round(quotaPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Storage usage"
          >
            <div
              className={[styles['quota-bar'], quotaBarClass].filter(Boolean).join(' ')}
              style={{ width: `${quotaPercent}%` }}
            />
          </div>
          <p className={styles['quota-sub']}>
            {formatBytes(quota.usedBytes)} of {formatBytes(quota.totalBytes)} used
            {/* This used to link to /settings/storage, a page that does not
                exist — the meter's link went nowhere, which is issue #144.
                What someone who has run out of room actually wants is more
                room, so the link asks for it. */}
            {onRequestStorage && (
              <button
                type="button"
                onClick={onRequestStorage}
                className={styles['quota-link']}
              >
                Request Additional
              </button>
            )}
          </p>
        </div>
      )}

      {/* Version — the one place the running build names itself without the
          user having to open Settings. Hidden when collapsed, as the quota is:
          the rail is too narrow to read it in. */}
      {version && !collapsed && (
        <div className={styles.version}>
          <span className={styles['version-label']} title={versionTitle ?? version}>
            {version}
          </span>
          {/* Both icons are always mounted and cross-fade on opacity — swapping
              one for the other would pop, and the ask is a fade back. */}
          <button
            type="button"
            className={[styles['version-copy'], copied ? styles.copied : ''].filter(Boolean).join(' ')}
            onClick={copyVersion}
            title={copied ? 'Copied' : 'Copy version'}
            aria-label={copied ? 'Version copied' : 'Copy version'}
          >
            <Copy className={styles['copy-icon']} size={14} aria-hidden="true" />
            <Check className={styles['check-icon']} size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </aside>
  );
}
