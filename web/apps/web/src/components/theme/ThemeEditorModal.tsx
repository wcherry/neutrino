'use client';

import React, { useEffect, useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  TextInput,
  RadioGroup,
  Radio,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  ColorPickerPopover,
  Checkbox,
  Button,
  AlertDialog,
  useToast,
} from '@neutrino/ui';
import {
  themesApi,
  type CustomTheme,
  type CanonicalThemeToken,
  type ThemeColorScheme,
} from '@neutrino/api-themes';
import styles from './ThemeEditorModal.module.css';

// ---------------------------------------------------------------------------
// Default token seeds — mirrors colors.css's `:root` / `[data-theme="dark"]`
// canonical values (aliases excluded; those are derived, not user-editable —
// see CustomThemesProvider's alias-mirroring rule).
// ---------------------------------------------------------------------------

const LIGHT_BASE_DEFAULTS: Record<CanonicalThemeToken, string> = {
  '--color-bg': '#ffffff',
  '--color-bg-subtle': '#f9fafb',
  '--color-surface': '#ffffff',
  '--color-surface-raised': '#f9fafb',
  '--color-surface-overlay': '#ffffff',
  '--color-border': '#e5e7eb',
  '--color-border-strong': '#d1d5db',
  '--color-text-primary': '#111827',
  '--color-text-secondary': '#4b5563',
  '--color-text-muted': '#9ca3af',
  '--color-text-inverse': '#ffffff',
  '--color-text-on-accent': '#ffffff',
  '--color-accent': '#2563eb',
  '--color-accent-hover': '#1d4ed8',
  '--color-accent-subtle': '#eff6ff',
  '--color-accent-text': '#1e40af',
  '--color-success': '#16a34a',
  '--color-success-subtle': '#f0fdf4',
  '--color-warning': '#d97706',
  '--color-warning-subtle': '#fffbeb',
  '--color-error': '#dc2626',
  '--color-error-subtle': '#fef2f2',
  '--color-info': '#0284c7',
  '--color-info-subtle': '#f0f9ff',
};

const DARK_BASE_DEFAULTS: Record<CanonicalThemeToken, string> = {
  '--color-bg': '#0f172a',
  '--color-bg-subtle': '#1e293b',
  '--color-surface': '#1e293b',
  '--color-surface-raised': '#334155',
  '--color-surface-overlay': '#1e293b',
  '--color-border': '#334155',
  '--color-border-strong': '#475569',
  '--color-text-primary': '#f1f5f9',
  '--color-text-secondary': '#94a3b8',
  '--color-text-muted': '#64748b',
  '--color-text-inverse': '#0f172a',
  '--color-text-on-accent': '#ffffff',
  '--color-accent': '#3b82f6',
  '--color-accent-hover': '#60a5fa',
  '--color-accent-subtle': '#1e3a5f',
  '--color-accent-text': '#93c5fd',
  '--color-success': '#22c55e',
  '--color-success-subtle': '#052e16',
  '--color-warning': '#f59e0b',
  '--color-warning-subtle': '#1c1003',
  '--color-error': '#ef4444',
  '--color-error-subtle': '#1c0a0a',
  '--color-info': '#38bdf8',
  '--color-info-subtle': '#082f49',
};

const FIELD_LABELS: Record<CanonicalThemeToken, string> = {
  '--color-bg': 'Background',
  '--color-bg-subtle': 'Background (subtle)',
  '--color-surface': 'Surface',
  '--color-surface-raised': 'Surface (raised)',
  '--color-surface-overlay': 'Surface (overlay)',
  '--color-border': 'Border',
  '--color-border-strong': 'Border (strong)',
  '--color-text-primary': 'Text (primary)',
  '--color-text-secondary': 'Text (secondary)',
  '--color-text-muted': 'Text (muted)',
  '--color-text-inverse': 'Text (inverse)',
  '--color-text-on-accent': 'Text (on accent)',
  '--color-accent': 'Accent',
  '--color-accent-hover': 'Accent (hover)',
  '--color-accent-subtle': 'Accent (subtle)',
  '--color-accent-text': 'Accent (text)',
  '--color-success': 'Success',
  '--color-success-subtle': 'Success (subtle)',
  '--color-warning': 'Warning',
  '--color-warning-subtle': 'Warning (subtle)',
  '--color-error': 'Error',
  '--color-error-subtle': 'Error (subtle)',
  '--color-info': 'Info',
  '--color-info-subtle': 'Info (subtle)',
};

type TabId = 'base' | 'text' | 'accent' | 'status';

const TOKEN_GROUPS: { id: TabId; label: string; keys: CanonicalThemeToken[] }[] = [
  {
    id: 'base',
    label: 'Base',
    keys: [
      '--color-bg',
      '--color-bg-subtle',
      '--color-surface',
      '--color-surface-raised',
      '--color-surface-overlay',
      '--color-border',
      '--color-border-strong',
    ],
  },
  {
    id: 'text',
    label: 'Text',
    keys: [
      '--color-text-primary',
      '--color-text-secondary',
      '--color-text-muted',
      '--color-text-inverse',
      '--color-text-on-accent',
    ],
  },
  {
    id: 'accent',
    label: 'Accent',
    keys: ['--color-accent', '--color-accent-hover', '--color-accent-subtle', '--color-accent-text'],
  },
  {
    id: 'status',
    label: 'Status',
    keys: [
      '--color-success',
      '--color-success-subtle',
      '--color-warning',
      '--color-warning-subtle',
      '--color-error',
      '--color-error-subtle',
      '--color-info',
      '--color-info-subtle',
    ],
  },
];

function defaultsFor(colorScheme: ThemeColorScheme): Record<CanonicalThemeToken, string> {
  return colorScheme === 'dark' ? { ...DARK_BASE_DEFAULTS } : { ...LIGHT_BASE_DEFAULTS };
}

function seedTokens(theme: CustomTheme | undefined): Record<string, string> {
  if (theme) {
    // Fill in any canonical keys missing from a legacy/partial record with
    // that theme's own base defaults, so the editor always has all 24 fields.
    return { ...defaultsFor(theme.colorScheme), ...theme.tokens };
  }
  return defaultsFor('light');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ThemeEditorModalProps {
  open: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  theme?: CustomTheme;
  onSaved?: (theme: CustomTheme) => void;
  onDelete?: (themeId: string) => void;
}

export function ThemeEditorModal({ open, onClose, mode, theme, onSaved, onDelete }: ThemeEditorModalProps) {
  const { success: toastSuccess, error: toastError } = useToast();

  const [name, setName] = useState(theme?.name ?? '');
  const [colorScheme, setColorScheme] = useState<ThemeColorScheme>(theme?.colorScheme ?? 'light');
  const [tokens, setTokens] = useState<Record<string, string>>(() => seedTokens(theme));
  const [isPublic, setIsPublic] = useState(theme?.isPublic ?? false);
  const [activeTab, setActiveTab] = useState<TabId>('base');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // ThemeEditorModal is rendered unconditionally by ThemeGrid (only its
  // `open` prop toggles Modal's own internal visibility) — this same
  // component instance is reused across every create/edit session for as
  // long as ThemeGrid stays mounted, so the `useState(theme?.name ?? '')`
  // initializers above only ever run once, on ThemeGrid's first render.
  // Without this resync, reopening the editor with a different `theme` (e.g.
  // the fresh copy produced by Duplicate, right after having already used
  // the "Create custom theme" flow once) would keep showing whatever fields
  // were set during the *previous* open. Re-seed every time the modal
  // transitions into the open state so it always reflects the current
  // `theme`/`mode` props.
  useEffect(() => {
    if (!open) return;
    setName(theme?.name ?? '');
    setColorScheme(theme?.colorScheme ?? 'light');
    setTokens(seedTokens(theme));
    setIsPublic(theme?.isPublic ?? false);
    setActiveTab('base');
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Switching base re-seeds every color field to that base preset's defaults
  // — but only before the user has touched any field, so we never clobber
  // in-progress edits (see the plan's "ThemeEditorModal.tsx" section).
  function handleBaseChange(next: ThemeColorScheme) {
    setColorScheme(next);
    if (!touched) {
      setTokens(defaultsFor(next));
    }
  }

  function handleTokenChange(key: CanonicalThemeToken, value: string) {
    setTouched(true);
    setTokens((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toastError('Please enter a name for this theme.');
      return;
    }
    setSaving(true);
    try {
      const payload = { name: trimmedName, colorScheme, tokens, isPublic };
      const saved =
        mode === 'edit' && theme
          ? await themesApi.updateTheme(theme.id, payload)
          : await themesApi.createTheme(payload);
      toastSuccess(mode === 'edit' ? 'Theme updated' : 'Theme created');
      onSaved?.(saved);
      onClose();
    } catch {
      toastError('Failed to save theme. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!theme) return;
    setDeleting(true);
    try {
      await themesApi.deleteTheme(theme.id);
      toastSuccess('Theme deleted');
      setConfirmDeleteOpen(false);
      onDelete?.(theme.id);
      onClose();
    } catch {
      toastError('Failed to delete theme. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} size="lg">
        <ModalHeader title={mode === 'edit' ? 'Edit theme' : 'Create custom theme'} onClose={onClose} />
        <ModalBody>
          <div className={styles.form}>
            <TextInput
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My custom theme"
              required
            />

            <div className={styles.baseRow}>
              <span className={styles.baseLabel}>Base</span>
              <RadioGroup name="colorScheme" direction="row">
                <Radio
                  label="Light"
                  checked={colorScheme === 'light'}
                  onChange={() => handleBaseChange('light')}
                />
                <Radio
                  label="Dark"
                  checked={colorScheme === 'dark'}
                  onChange={() => handleBaseChange('dark')}
                />
              </RadioGroup>
            </div>

            <Tabs value={activeTab} onChange={(id) => setActiveTab(id as TabId)}>
              <TabList>
                {TOKEN_GROUPS.map((group) => (
                  <Tab key={group.id} id={group.id}>
                    {group.label}
                  </Tab>
                ))}
              </TabList>
              {TOKEN_GROUPS.map((group) => (
                <TabPanel key={group.id} id={group.id}>
                  <div className={styles.fieldGrid}>
                    {group.keys.map((key) => (
                      <div key={key} className={styles.field}>
                        <ColorPickerPopover
                          color={tokens[key] ?? '#000000'}
                          onChange={(hex) => handleTokenChange(key, hex)}
                          title={FIELD_LABELS[key]}
                        />
                        <span className={styles.fieldLabel}>{FIELD_LABELS[key]}</span>
                      </div>
                    ))}
                  </div>
                </TabPanel>
              ))}
            </Tabs>

            <div className={styles.visibilityRow}>
              <Checkbox
                label="Make this theme visible to everyone"
                description="Other users will be able to select this theme, but only you can edit or delete it."
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          {mode === 'edit' && theme && (
            <div className={styles.footerLeft}>
              <Button
                variant="ghost"
                className={styles.deleteBtn}
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={saving}
              >
                Delete
              </Button>
            </div>
          )}
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Save
          </Button>
        </ModalFooter>
      </Modal>

      {mode === 'edit' && theme && (
        <AlertDialog
          open={confirmDeleteOpen}
          onClose={() => setConfirmDeleteOpen(false)}
          title={`Delete theme "${theme.name}"?`}
          description="This can't be undone."
          variant="error"
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={handleConfirmDelete}
          loading={deleting}
        />
      )}
    </>
  );
}
