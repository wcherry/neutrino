/**
 * Unit tests for ThemeEditorModal (feature/custom-themes, red phase). See
 * agent_docs/plans/feature-custom-themes.md's "ThemeEditorModal.tsx" section:
 * a Modal with a name field, light/dark base radio group, Base/Text/Accent/
 * Status tabs of `ColorPickerPopover` fields (7/5/4/8 = 24 total canonical
 * tokens), a public/private Toggle, and Save/Cancel actions that call
 * `themesApi.createTheme`/`updateTheme`. Deletion (from an owned card) must
 * go through an `AlertDialog`, never `window.confirm` — see this repo's hard
 * "never use browser dialogs" rule (feedback_no_browser_dialogs.md).
 *
 * Import path assumption: `@/components/theme/ThemeEditorModal`, props
 * `{ open, onClose, mode: 'create' | 'edit', theme?: CustomTheme, onDelete?:
 * (id: string) => void }` — the exact prop names are frontend-developer's
 * call; if they differ, keep this file's *behavioral* assertions and adjust
 * the render helpers below.
 *
 * Neither `@/components/theme/ThemeEditorModal` nor `@neutrino/api-themes`
 * exist yet — every test below fails (or fails to import) until
 * frontend-developer adds them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@neutrino/ui';

// ---------------------------------------------------------------------------
// Mock @neutrino/api-themes (package does not exist yet).
// ---------------------------------------------------------------------------

const mockCreateTheme = vi.fn();
const mockUpdateTheme = vi.fn();
const mockDeleteTheme = vi.fn();

vi.mock('@neutrino/api-themes', () => ({
  themesApi: {
    createTheme: (...args: unknown[]) => mockCreateTheme(...args),
    updateTheme: (...args: unknown[]) => mockUpdateTheme(...args),
    deleteTheme: (...args: unknown[]) => mockDeleteTheme(...args),
  },
}));

import { ThemeEditorModal } from '@/components/theme/ThemeEditorModal';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Mirrors src/themes/dto.rs's CANONICAL_THEME_TOKENS (single source of truth
// diffed against colors.css — see the plan's "Token key drift" risk note).
const CANONICAL_THEME_TOKENS = [
  '--color-bg',
  '--color-bg-subtle',
  '--color-surface',
  '--color-surface-raised',
  '--color-surface-overlay',
  '--color-border',
  '--color-border-strong',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-muted',
  '--color-text-inverse',
  '--color-text-on-accent',
  '--color-accent',
  '--color-accent-hover',
  '--color-accent-subtle',
  '--color-accent-text',
  '--color-success',
  '--color-success-subtle',
  '--color-warning',
  '--color-warning-subtle',
  '--color-error',
  '--color-error-subtle',
  '--color-info',
  '--color-info-subtle',
];

const existingTheme = {
  id: 'theme-1',
  userId: 'user-1',
  name: 'My Existing Theme',
  isPublic: false,
  isOwner: true,
  colorScheme: 'dark' as const,
  tokens: Object.fromEntries(CANONICAL_THEME_TOKENS.map((k) => [k, '#111111'])),
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function renderModal(props: Partial<React.ComponentProps<typeof ThemeEditorModal>> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <ToastProvider>
      <ThemeEditorModal open onClose={onClose} mode="create" {...props} />
    </ToastProvider>
  );
  return { onClose, ...utils };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ThemeEditorModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateTheme.mockResolvedValue({ ...existingTheme, id: 'new-theme-id' });
    mockUpdateTheme.mockResolvedValue(existingTheme);
    mockDeleteTheme.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Structure ────────────────────────────────────────────────────────

  it('renders a name field', () => {
    renderModal();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
  });

  it('renders a light/dark base selector', () => {
    renderModal();
    expect(screen.getByRole('radio', { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /dark/i })).toBeInTheDocument();
  });

  it('renders Base/Text/Accent/Status tabs', () => {
    renderModal();
    expect(screen.getByRole('tab', { name: /base/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /text/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /accent/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /status/i })).toBeInTheDocument();
  });

  it('renders a public/private visibility toggle', () => {
    renderModal();
    expect(screen.getByRole('checkbox', { name: /public|visible to everyone/i })).toBeInTheDocument();
  });

  it('groups the 24 canonical color fields into tabs of 7/5/4/8 fields', async () => {
    renderModal();
    const user = userEvent.setup();

    const expectedCounts: Record<string, number> = {
      base: 7,
      text: 5,
      accent: 4,
      status: 8,
    };

    for (const [tabName, expectedCount] of Object.entries(expectedCounts)) {
      await user.click(screen.getByRole('tab', { name: new RegExp(tabName, 'i') }));
      const panel = screen.getByRole('tabpanel');
      const fieldsWithTitle = within(panel)
        .getAllByRole('button')
        .filter((btn) => btn.hasAttribute('title'));
      expect(fieldsWithTitle.length).toBe(expectedCount);
    }
  });

  // ── Create ───────────────────────────────────────────────────────────

  it('submitting in create mode calls themesApi.createTheme with name/colorScheme/tokens/isPublic', async () => {
    renderModal({ mode: 'create' });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/name/i), 'Brand New Theme');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockCreateTheme).toHaveBeenCalledTimes(1));
    const payload = mockCreateTheme.mock.calls[0][0];
    expect(payload.name).toBe('Brand New Theme');
    expect(['light', 'dark']).toContain(payload.colorScheme);
    expect(typeof payload.isPublic).toBe('boolean');
    expect(Object.keys(payload.tokens).sort()).toEqual([...CANONICAL_THEME_TOKENS].sort());
  });

  it('does not call themesApi.updateTheme when creating', async () => {
    renderModal({ mode: 'create' });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/name/i), 'Brand New Theme');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockCreateTheme).toHaveBeenCalledTimes(1));
    expect(mockUpdateTheme).not.toHaveBeenCalled();
  });

  // ── Edit ─────────────────────────────────────────────────────────────

  it('pre-populates the name field from the theme prop in edit mode', () => {
    renderModal({ mode: 'edit', theme: existingTheme });
    expect(screen.getByLabelText(/name/i)).toHaveValue(existingTheme.name);
  });

  it('submitting in edit mode calls themesApi.updateTheme with the theme id', async () => {
    renderModal({ mode: 'edit', theme: existingTheme });
    const user = userEvent.setup();

    const nameInput = screen.getByLabelText(/name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed Theme');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdateTheme).toHaveBeenCalledTimes(1));
    const [id, payload] = mockUpdateTheme.mock.calls[0];
    expect(id).toBe(existingTheme.id);
    expect(payload.name).toBe('Renamed Theme');
    expect(mockCreateTheme).not.toHaveBeenCalled();
  });

  // ── Cancel ───────────────────────────────────────────────────────────

  it('Cancel closes the modal without calling the API', async () => {
    const { onClose } = renderModal({ mode: 'create' });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
    expect(mockCreateTheme).not.toHaveBeenCalled();
    expect(mockUpdateTheme).not.toHaveBeenCalled();
  });

  // ── Delete (AlertDialog, never window.confirm) ──────────────────────

  it('uses an AlertDialog to confirm deletion and never calls window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const onDelete = vi.fn();
    renderModal({ mode: 'edit', theme: existingTheme, onDelete });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /delete/i }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: /delete|confirm/i }));

    await waitFor(() => expect(mockDeleteTheme).toHaveBeenCalledWith(existingTheme.id));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('does not show a Delete button in create mode (nothing to delete yet)', () => {
    renderModal({ mode: 'create' });
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  // ── Color picker (issue #97) ─────────────────────────────────────────

  it('lets a colour be typed into the picker opened from a swatch', async () => {
    renderModal({ mode: 'create' });
    const user = userEvent.setup();

    // The picker renders into its own portal, outside the modal's focus trap.
    await user.click(screen.getByTitle('Background'));
    await user.click(screen.getByRole('button', { name: 'Values' }));

    const hex = screen.getByDisplayValue(/^#[0-9a-f]{6}$/i);
    await user.click(hex);
    expect(hex).toHaveFocus();

    await user.clear(hex);
    await user.type(hex, '#abcdef');
    expect(hex).toHaveValue('#abcdef');
  });
});
