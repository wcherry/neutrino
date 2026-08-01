'use client';

import React, { useState } from 'react';
import { MoreVertical, Plus } from 'lucide-react';
import { AlertDialog, useToast } from '@neutrino/ui';
import { themesApi, type CustomTheme, type ThemeColorScheme } from '@neutrino/api-themes';
import { useTheme, type ThemeChoice } from '@/providers/ThemeProvider';
import { useCustomThemes } from '@/providers/CustomThemesProvider';
import { ThemeEditorModal } from './ThemeEditorModal';
import { ThemeContextMenu } from './ThemeContextMenu';
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
// Context-menu target
// ---------------------------------------------------------------------------

type MenuTarget =
  | { kind: 'preset'; preset: ThemePreset; x: number; y: number }
  | { kind: 'custom'; theme: CustomTheme; x: number; y: number };

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
  const { themes: customThemes, refetch } = useCustomThemes();
  const { success: toastSuccess, error: toastError } = useToast();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingTheme, setEditingTheme] = useState<CustomTheme | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<CustomTheme | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);

  function openCreate() {
    setEditorMode('create');
    setEditingTheme(undefined);
    setEditorOpen(true);
  }

  // Duplicate a built-in preset or an existing custom theme (own or someone
  // else's public one) into a brand-new private custom theme, then land the
  // user directly in the editor for the fresh copy — same mechanism openEdit
  // already uses, just fed the newly-created record instead of a list entry.
  //
  // No standalone "Edit" entry point exists in this iteration — the only way
  // into ThemeEditorModal's edit mode is via this Duplicate flow. See
  // ThemeContextMenu.tsx for the corresponding note.
  async function handleDuplicate(name: string, colorScheme: ThemeColorScheme, tokens: Record<string, string>) {
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
      await refetch();
      setEditorMode('edit');
      setEditingTheme(created);
      setEditorOpen(true);
    } catch {
      toastError('Failed to duplicate theme. Please try again.');
    } finally {
      setDuplicating(false);
    }
  }

  function handleDuplicatePreset(opt: ThemePreset) {
    const preset = BUILTIN_THEME_TOKENS[opt.value];
    if (!preset) return; // 'system' has no entry — its card never renders a menu
    void handleDuplicate(opt.label, preset.colorScheme, preset.tokens);
  }

  function handleDuplicateCustom(t: CustomTheme) {
    void handleDuplicate(t.name, t.colorScheme, t.tokens);
  }

  function requestDelete(theme: CustomTheme) {
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
      await refetch();
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleMakePublic(theme: CustomTheme) {
    try {
      await themesApi.updateTheme(theme.id, { isPublic: true });
      toastSuccess(`"${theme.name}" is now public`);
      await refetch();
    } catch {
      toastError('Failed to update theme. Please try again.');
    }
  }

  function handleMenuOpen(
    target: { kind: 'preset'; preset: ThemePreset } | { kind: 'custom'; theme: CustomTheme },
    e: React.MouseEvent,
  ) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.right, window.innerWidth - 200);
    const y = Math.min(rect.bottom, window.innerHeight - 300);
    setMenuTarget({ ...target, x, y } as MenuTarget);
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
            // Without this the card's accessible name absorbs the nested
            // "More options for …" button, e.g. "Light More options for Light".
            aria-label={opt.label}
            title={opt.label}
          >
            <span className={styles.swatch} style={{ background: opt.bg }}>
              <span className={styles.swatchAccent} style={{ background: opt.accent }} />
            </span>
            <span className={styles.cardLabel}>{opt.label}</span>
            {opt.value !== 'system' && (
              <button
                type="button"
                className={styles.itemMenuBtn}
                aria-label={`More options for ${opt.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleMenuOpen({ kind: 'preset', preset: opt }, e);
                }}
              >
                <MoreVertical size={14} />
              </button>
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
              aria-label={t.name}
              title={t.name}
            >
              <span className={styles.swatch} style={{ background: customThemeBg(t) }}>
                <span className={styles.swatchAccent} style={{ background: customThemeAccent(t) }} />
              </span>
              <span className={styles.cardLabel}>{t.name}</span>
              <button
                type="button"
                className={styles.itemMenuBtn}
                aria-label={`More options for ${t.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleMenuOpen({ kind: 'custom', theme: t }, e);
                }}
              >
                <MoreVertical size={14} />
              </button>
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

      {menuTarget && (
        <ThemeContextMenu
          x={menuTarget.x}
          y={menuTarget.y}
          onClose={() => setMenuTarget(null)}
          onDuplicate={
            menuTarget.kind === 'preset'
              ? () => handleDuplicatePreset(menuTarget.preset)
              : () => handleDuplicateCustom(menuTarget.theme)
          }
          onMakePublic={
            menuTarget.kind === 'custom' && !menuTarget.theme.isPublic
              ? () => void handleMakePublic(menuTarget.theme)
              : undefined
          }
          onDelete={
            menuTarget.kind === 'custom' && !menuTarget.theme.isPublic
              ? () => requestDelete(menuTarget.theme)
              : undefined
          }
        />
      )}

      <ThemeEditorModal
        open={editorOpen}
        mode={editorMode}
        theme={editingTheme}
        onClose={() => setEditorOpen(false)}
        onSaved={() => { void refetch(); }}
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
