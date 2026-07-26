'use client';

import React, { useState } from 'react';
import { Pencil, Trash2, Plus, Copy } from 'lucide-react';
import { AlertDialog, useToast } from '@neutrino/ui';
import { themesApi, type CustomTheme, type ThemeColorScheme } from '@neutrino/api-themes';
import { useTheme, type ThemeChoice } from '@/providers/ThemeProvider';
import { useCustomThemes } from '@/providers/CustomThemesProvider';
import { ThemeEditorModal } from './ThemeEditorModal';
import { BUILTIN_THEME_TOKENS } from './builtinThemeTokens';
import styles from './ThemeGrid.module.css';

// ---------------------------------------------------------------------------
// Built-in presets — moved here from settings/page.tsx & profile/page.tsx's
// previously-duplicated THEME_OPTIONS (see the plan's "Shared theme-grid
// component/hook" section).
// ---------------------------------------------------------------------------

export interface ThemePreset {
  value: ThemeChoice;
  label: string;
  bg: string;
  accent: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { value: 'light',       label: 'Light',       bg: '#ffffff',                                                         accent: '#2563eb' },
  { value: 'dark',        label: 'Dark',        bg: '#0f172a',                                                         accent: '#3b82f6' },
  { value: 'system',      label: 'System',      bg: 'linear-gradient(135deg, #ffffff 50%, #0f172a 50%)',               accent: '#6b7280' },
  { value: 'light-glass', label: 'Light Glass', bg: 'linear-gradient(135deg, #dbeafe 0%, #ede9fe 55%, #fce7f3 100%)', accent: '#6366f1' },
  { value: 'glass',       label: 'Glass',       bg: '#0e1621',                                                         accent: '#38bdf8' },
  { value: 'midnight',    label: 'Midnight',    bg: '#06060f',                                                         accent: '#818cf8' },
  { value: 'beach',       label: 'Beach',       bg: '#fdf8f0',                                                         accent: '#0ea5e9' },
  { value: 'forest',      label: 'Forest',      bg: '#1a2416',                                                         accent: '#4ade80' },
  { value: 'sunbeams',    label: 'Sunbeams',    bg: '#fdfaf0',                                                         accent: '#d97706' },
];

function customThemeBg(theme: CustomTheme): string {
  return theme.tokens['--color-bg'] ?? (theme.colorScheme === 'dark' ? '#0f172a' : '#ffffff');
}

function customThemeAccent(theme: CustomTheme): string {
  return theme.tokens['--color-accent'] ?? '#6366f1';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ThemeGridProps {
  /**
   * Called with the selected theme id — a built-in preset name or a
   * `custom-<id>` string. The parent owns applying (`setTheme`) and
   * persisting (`save.mutate`) the selection synchronously; ThemeGrid itself
   * never calls `setTheme`.
   */
  onSelect: (themeId: string) => void;
}

export function ThemeGrid({ onSelect }: ThemeGridProps) {
  const { theme: activeTheme } = useTheme();
  const { themes: customThemes } = useCustomThemes();
  const { success: toastSuccess, error: toastError } = useToast();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingTheme, setEditingTheme] = useState<CustomTheme | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<CustomTheme | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  function openCreate() {
    setEditorMode('create');
    setEditingTheme(undefined);
    setEditorOpen(true);
  }

  // Duplicate a built-in preset or an existing custom theme (own or someone
  // else's public one) into a brand-new private custom theme, then land the
  // user directly in the editor for the fresh copy — same mechanism openEdit
  // already uses, just fed the newly-created record instead of a list entry.
  async function handleDuplicate(
    name: string,
    colorScheme: ThemeColorScheme,
    tokens: Record<string, string>,
    e: React.SyntheticEvent,
  ) {
    e.stopPropagation();
    if (duplicating) return;
    setDuplicating(true);
    try {
      const created = await themesApi.createTheme({
        name: `${name} copy`,
        colorScheme,
        tokens,
        isPublic: false,
      });
      toastSuccess(`Duplicated "${name}"`);
      setEditorMode('edit');
      setEditingTheme(created);
      setEditorOpen(true);
    } catch {
      toastError('Failed to duplicate theme. Please try again.');
    } finally {
      setDuplicating(false);
    }
  }

  function handleDuplicatePreset(opt: ThemePreset, e: React.SyntheticEvent) {
    const preset = BUILTIN_THEME_TOKENS[opt.value];
    if (!preset) return; // 'system' has no entry — its card never renders this button
    void handleDuplicate(opt.label, preset.colorScheme, preset.tokens, e);
  }

  function handleDuplicateCustom(t: CustomTheme, e: React.SyntheticEvent) {
    void handleDuplicate(t.name, t.colorScheme, t.tokens, e);
  }

  function openEdit(theme: CustomTheme, e: React.SyntheticEvent) {
    e.stopPropagation();
    setEditorMode('edit');
    setEditingTheme(theme);
    setEditorOpen(true);
  }

  function requestDelete(theme: CustomTheme, e: React.SyntheticEvent) {
    e.stopPropagation();
    setDeleteTarget(theme);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await themesApi.deleteTheme(deleteTarget.id);
      // Deleting the currently-active custom theme must never leave the UI
      // stuck on a data-theme value with no backing stylesheet rule — fall
      // back to 'system', applied + persisted via the same onSelect contract
      // the parent already wires up for every other selection.
      if (activeTheme === `custom-${deleteTarget.id}`) {
        onSelect('system');
      }
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className={styles.grid}>
        {THEME_PRESETS.map((opt) => (
          <div
            key={opt.value}
            role="button"
            tabIndex={0}
            className={`${styles.card} ${activeTheme === opt.value ? styles.cardActive : ''}`}
            onClick={() => onSelect(opt.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(opt.value);
              }
            }}
            title={opt.label}
          >
            <span className={styles.swatch} style={{ background: opt.bg }}>
              <span className={styles.swatchAccent} style={{ background: opt.accent }} />
            </span>
            <span className={styles.cardLabel}>{opt.label}</span>
            {opt.value !== 'system' && (
              <span className={styles.cardActions}>
                <button
                  type="button"
                  aria-label={`Duplicate ${opt.label}`}
                  onClick={(e) => handleDuplicatePreset(opt, e)}
                >
                  <Copy size={12} />
                </button>
              </span>
            )}
          </div>
        ))}

        {customThemes.map((t) => {
          const themeId = `custom-${t.id}`;
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              className={`${styles.card} ${activeTheme === themeId ? styles.cardActive : ''}`}
              onClick={() => onSelect(themeId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(themeId);
                }
              }}
              title={t.name}
            >
              <span className={styles.swatch} style={{ background: customThemeBg(t) }}>
                <span className={styles.swatchAccent} style={{ background: customThemeAccent(t) }} />
              </span>
              <span className={styles.cardLabel}>{t.name}</span>
              <span className={styles.cardActions}>
                <button type="button" aria-label={`Duplicate ${t.name}`} onClick={(e) => handleDuplicateCustom(t, e)}>
                  <Copy size={12} />
                </button>
                {t.isOwner && (
                  <>
                    <button type="button" aria-label={`Edit ${t.name}`} onClick={(e) => openEdit(t, e)}>
                      <Pencil size={12} />
                    </button>
                    <button type="button" aria-label={`Delete ${t.name}`} onClick={(e) => requestDelete(t, e)}>
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </span>
            </div>
          );
        })}

        <button type="button" className={styles.card} onClick={openCreate}>
          <span className={styles.swatch} style={{ background: 'var(--color-surface-raised, #f3f4f6)' }}>
            <Plus size={18} />
          </span>
          <span className={styles.cardLabel}>Create custom theme</span>
        </button>
      </div>

      <ThemeEditorModal
        open={editorOpen}
        mode={editorMode}
        theme={editingTheme}
        onClose={() => setEditorOpen(false)}
      />

      <AlertDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={`Delete theme "${deleteTarget?.name ?? ''}"?`}
        description="This can't be undone."
        variant="error"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={confirmDelete}
        loading={deleting}
      />
    </div>
  );
}
