'use client';

import React, { useState } from 'react';
import {
  Download, Cloud, Lock, Printer, Copy, Edit2,
  ChevronDown, ChevronRight, X, Folder as FolderIcon,
} from 'lucide-react';
import styles from './SaveAsDialog.module.css';

// ── Public types ────────────────────────────────────────────────────────────

export interface SaveAsOptions {
  filename: string;
  location: 'local' | 'drive';
  /** ID of the selected Drive folder; null = root (My Drive). */
  folderId?: string | null;
  password?: string;
  allowPrinting: boolean;
  allowCopying: boolean;
  allowModifying: boolean;
}

export interface SaveAsDriveFolder {
  id: string;
  name: string;
  color?: string | null;
}

export interface SaveAsBreadcrumb {
  id: string | null;
  name: string;
}

export interface SaveAsDialogProps {
  defaultFilename: string;
  /** One of: 'pdf' | 'docx' | 'html' | 'txt' — controls security section visibility and labels. */
  format: string;
  onSave: (opts: SaveAsOptions) => Promise<void>;
  onClose: () => void;

  // ── Drive folder browser (caller owns the fetch state) ──────────────────
  driveBreadcrumbs: SaveAsBreadcrumb[];
  driveFolders: SaveAsDriveFolder[];
  driveFolderLoading: boolean;
  driveFolderError: boolean;
  onDriveFolderClick: (folder: SaveAsDriveFolder) => void;
  onDriveBreadcrumbClick: (entry: SaveAsBreadcrumb, index: number) => void;
}

// ── Constants ───────────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<string, string> = {
  pdf:  'PDF Document (.pdf)',
  docx: 'Word Document (.docx)',
  html: 'HTML File (.html)',
  txt:  'Plain Text (.txt)',
};

// ── Component ───────────────────────────────────────────────────────────────

export function SaveAsDialog({
  defaultFilename,
  format,
  onSave,
  onClose,
  driveBreadcrumbs,
  driveFolders,
  driveFolderLoading,
  driveFolderError,
  onDriveFolderClick,
  onDriveBreadcrumbClick,
}: SaveAsDialogProps) {
  const [filename, setFilename] = useState(defaultFilename);
  const [location, setLocation] = useState<'local' | 'drive'>('local');
  const [showSecurity, setShowSecurity] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [allowPrinting, setAllowPrinting] = useState(true);
  const [allowCopying, setAllowCopying] = useState(true);
  const [allowModifying, setAllowModifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPdf = format === 'pdf';
  const currentFolderId = driveBreadcrumbs[driveBreadcrumbs.length - 1]?.id ?? null;

  async function handleSave() {
    console.log('[SaveAsDialog] handleSave called', { filename, location, format });
    const trimmed = filename.trim();
    if (!trimmed) { setError('Filename is required.'); return; }
    if (isPdf && password && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    setError(null);
    const opts = {
      filename: trimmed,
      location,
      folderId: location === 'drive' ? currentFolderId : undefined,
      password: isPdf && password ? password : undefined,
      allowPrinting,
      allowCopying,
      allowModifying,
    };
    console.log('[SaveAsDialog] calling onSave with', opts);
    try {
      await onSave(opts);
      console.log('[SaveAsDialog] onSave resolved successfully');
    } catch (e) {
      console.error('[SaveAsDialog] onSave threw:', e);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'An error occurred. Check the browser console for details.');
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>

        <div className={styles.header}>
          <div className={styles.headerTitle}>Save As</div>
          <p className={styles.headerDesc}>{FORMAT_LABELS[format] ?? format}</p>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            type="button"
            disabled={saving}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          {/* Filename */}
          <div className={styles.field}>
            <label className={styles.label}>Filename</label>
            <input
              className={styles.input}
              value={filename}
              onChange={e => setFilename(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !saving && handleSave()}
              autoFocus
              disabled={saving}
            />
          </div>

          {/* Location */}
          <div className={styles.field}>
            <label className={styles.label}>Save to</label>
            <div className={styles.locationTabs}>
              <button
                type="button"
                className={`${styles.locationTab} ${location === 'local' ? styles.locationTabActive : ''}`}
                onClick={() => setLocation('local')}
                disabled={saving}
              >
                <Download size={14} />
                This Device
              </button>
              <button
                type="button"
                className={`${styles.locationTab} ${location === 'drive' ? styles.locationTabActive : ''}`}
                onClick={() => setLocation('drive')}
                disabled={saving}
              >
                <Cloud size={14} />
                Neutrino Drive
              </button>
            </div>

            {location === 'drive' && (
              <div className={styles.driveBrowser}>
                {/* Breadcrumb */}
                <nav className={styles.driveBreadcrumb} aria-label="Folder path">
                  {driveBreadcrumbs.map((crumb, i) => {
                    const isCurrent = i === driveBreadcrumbs.length - 1;
                    return (
                      <React.Fragment key={crumb.id ?? '__root__'}>
                        {i > 0 && (
                          <ChevronRight size={11} className={styles.driveBreadcrumbSep} aria-hidden="true" />
                        )}
                        {isCurrent ? (
                          <span className={styles.driveBreadcrumbCurrent}>{crumb.name}</span>
                        ) : (
                          <button
                            type="button"
                            className={styles.driveBreadcrumbBtn}
                            onClick={() => onDriveBreadcrumbClick(crumb, i)}
                            disabled={saving}
                          >
                            {crumb.name}
                          </button>
                        )}
                      </React.Fragment>
                    );
                  })}
                </nav>

                {/* Folder list */}
                <div className={styles.driveFolderList} role="listbox" aria-label="Folders">
                  {driveFolderLoading && (
                    <div className={styles.driveFolderState}>Loading folders…</div>
                  )}
                  {driveFolderError && !driveFolderLoading && (
                    <div className={`${styles.driveFolderState} ${styles.driveFolderStateError}`}>
                      Could not load folders.
                    </div>
                  )}
                  {!driveFolderLoading && !driveFolderError && driveFolders.length === 0 && (
                    <div className={styles.driveFolderState}>No subfolders</div>
                  )}
                  {!driveFolderLoading && !driveFolderError && driveFolders.map(folder => (
                    <button
                      key={folder.id}
                      type="button"
                      className={styles.driveFolderItem}
                      role="option"
                      aria-selected={false}
                      onClick={() => onDriveFolderClick(folder)}
                      disabled={saving}
                    >
                      <FolderIcon
                        size={14}
                        color={folder.color ?? '#d97706'}
                        fill={folder.color ?? '#d97706'}
                        fillOpacity={0.2}
                        className={styles.driveFolderIcon}
                      />
                      <span className={styles.driveFolderItemName}>{folder.name}</span>
                      <ChevronRight size={12} className={styles.driveFolderItemChevron} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Security — PDF only */}
          {isPdf && (
            <div className={styles.securitySection}>
              <button
                type="button"
                className={styles.securityToggle}
                onClick={() => setShowSecurity(s => !s)}
                disabled={saving}
              >
                {showSecurity ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Lock size={12} />
                Security options
              </button>

              {showSecurity && (
                <div className={styles.securityBody}>
                  <div className={styles.field}>
                    <label className={styles.label}>Open password</label>
                    <input
                      className={styles.input}
                      type="password"
                      placeholder="No password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      disabled={saving}
                      autoComplete="new-password"
                    />
                  </div>

                  {password && (
                    <div className={styles.field}>
                      <label className={styles.label}>Confirm password</label>
                      <input
                        className={styles.input}
                        type="password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        disabled={saving}
                        autoComplete="new-password"
                      />
                    </div>
                  )}

                  <div className={styles.permissionsGroup}>
                    <div className={styles.permissionsLabel}>Permissions</div>
                    <label className={`${styles.checkboxRow} ${!password ? styles.checkboxRowDisabled : ''}`}>
                      <input
                        type="checkbox"
                        checked={allowPrinting}
                        onChange={e => setAllowPrinting(e.target.checked)}
                        disabled={saving || !password}
                      />
                      <Printer size={13} />
                      Allow printing
                    </label>
                    <label className={`${styles.checkboxRow} ${!password ? styles.checkboxRowDisabled : ''}`}>
                      <input
                        type="checkbox"
                        checked={allowCopying}
                        onChange={e => setAllowCopying(e.target.checked)}
                        disabled={saving || !password}
                      />
                      <Copy size={13} />
                      Allow copying text
                    </label>
                    <label className={`${styles.checkboxRow} ${!password ? styles.checkboxRowDisabled : ''}`}>
                      <input
                        type="checkbox"
                        checked={allowModifying}
                        onChange={e => setAllowModifying(e.target.checked)}
                        disabled={saving || !password}
                      />
                      <Edit2 size={13} />
                      Allow modifying
                    </label>
                    {!password && (
                      <p className={styles.permissionsHint}>Set a password to enforce permissions.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && <p className={styles.errorMsg}>{error}</p>}
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose} type="button" disabled={saving}>
            Cancel
          </button>
          <button
            className={styles.saveBtn}
            onClick={handleSave}
            type="button"
            disabled={saving || !filename.trim()}
          >
            {saving ? 'Saving…' : location === 'drive' ? 'Save to Drive' : 'Download'}
          </button>
        </div>

      </div>
    </div>
  );
}
