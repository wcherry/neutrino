/**
 * Unit tests for the shared theme-grid component (feature/custom-themes).
 * See agent_docs/plans/feature-custom-themes.md's "Shared theme-grid
 * component/hook" section: `ThemeGrid` renders the 9 built-in preset cards
 * (moved out of settings/page.tsx's `THEME_OPTIONS`) plus a "Custom themes"
 * section built from `useCustomThemes()`, plus a trailing "Create custom
 * theme" card that opens `ThemeEditorModal`.
 *
 * Per-card actions (Duplicate / Make public / Delete) are surfaced through a
 * single kebab ("...") button per card that opens `ThemeContextMenu` — the
 * same pattern Drive's file cards use (`FileGrid`'s `item-menu-btn` +
 * `FileContextMenu`) — rather than a row of always-visible icon buttons.
 * `ThemeContextMenu` is rendered for real here (not mocked) since it's a
 * small, self-contained component and doing so exercises the full
 * open-menu -> click-item -> API-call path.
 *
 * Contract assumed (per the plan's "onSelect(themeId)" description): the
 * parent page owns applying (`setTheme`) and persisting (`save.mutate`) a
 * selection; `ThemeGrid` itself only reports *which* card was clicked via a
 * single `onSelect(themeId: string)` prop. It reads the currently-active
 * theme via `useTheme()` (mocked below) purely to highlight the active card
 * — it must NOT call `setTheme` itself.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@neutrino/ui';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSetTheme = vi.fn();
const mockUseTheme = vi.fn();

vi.mock('@/providers/ThemeProvider', () => ({
  useTheme: () => mockUseTheme(),
}));

const mockUseCustomThemes = vi.fn();
const mockRefetch = vi.fn().mockResolvedValue(undefined);

vi.mock('@/providers/CustomThemesProvider', () => ({
  useCustomThemes: () => mockUseCustomThemes(),
}));

// Duplicate/Make-public/Delete all go through themesApi directly (see
// ThemeGrid.tsx's handleDuplicate/handleMakePublic/confirmDelete) — mock it
// so no real HTTP call happens.
const mockCreateTheme = vi.fn();
const mockUpdateTheme = vi.fn();
const mockDeleteTheme = vi.fn();

vi.mock('@neutrino/api-themes', () => ({
  themesApi: {
    createTheme: (...args: unknown[]) => mockCreateTheme(...args),
    updateTheme: (...args: unknown[]) => mockUpdateTheme(...args),
    deleteTheme: (...args: unknown[]) => mockDeleteTheme(...args),
    listThemes: vi.fn(),
  },
}));

// Stub the editor modal so this file can test the "opens the editor" contract
// without depending on ThemeEditorModal's own internals (covered separately
// in ThemeEditorModal.test.tsx).
const editorModalProps = vi.fn();
vi.mock('@/components/theme/ThemeEditorModal', () => ({
  ThemeEditorModal: (props: Record<string, unknown>) => {
    editorModalProps(props);
    return <div data-testid="theme-editor-modal" data-open={String(props.open)} data-mode={String(props.mode)} />;
  },
}));

import { ThemeGrid } from '@/components/theme/ThemeGrid';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ownedPrivateTheme = {
  id: 'theme-owned-private',
  userId: 'user-1',
  name: 'My Owned Theme',
  isPublic: false,
  isOwner: true,
  colorScheme: 'dark' as const,
  tokens: { '--color-bg': '#111111', '--color-accent': '#4f46e5' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const ownedPublicTheme = {
  id: 'theme-owned-public',
  userId: 'user-1',
  name: 'My Public Theme',
  isPublic: true,
  isOwner: true,
  colorScheme: 'light' as const,
  tokens: { '--color-bg': '#fafafa' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const othersPublicTheme = {
  id: 'theme-others',
  userId: 'user-2',
  name: "Someone Else's Theme",
  isPublic: true,
  isOwner: false,
  colorScheme: 'light' as const,
  tokens: { '--color-bg': '#fefefe' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function renderGrid(onSelect = vi.fn()) {
  const utils = render(
    <ToastProvider>
      <ThemeGrid onSelect={onSelect} />
    </ToastProvider>
  );
  return { onSelect, ...utils };
}

async function openMenuFor(name: string) {
  await userEvent.click(screen.getByRole('button', { name: `More options for ${name}` }));
  return screen.getByRole('menu');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ThemeGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetch.mockClear().mockResolvedValue(undefined);
    mockUseTheme.mockReturnValue({
      theme: 'light',
      setTheme: mockSetTheme,
      resolvedTheme: 'light',
    });
    mockUseCustomThemes.mockReturnValue({ themes: [], loaded: true, refetch: mockRefetch });
  });

  // ── Built-in presets ──────────────────────────────────────────────────

  it('renders all 9 built-in preset cards', () => {
    renderGrid();
    for (const label of [
      'Light',
      'Dark',
      'System',
      'Light Glass',
      'Glass',
      'Midnight',
      'Beach',
      'Forest',
      'Sunbeams',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('clicking a built-in preset card calls onSelect with that preset id', async () => {
    const { onSelect } = renderGrid();
    await userEvent.click(screen.getByText('Dark'));
    expect(onSelect).toHaveBeenCalledWith('dark');
  });

  it('clicking a built-in preset card does not call setTheme directly (parent owns apply+persist)', async () => {
    renderGrid();
    await userEvent.click(screen.getByText('Dark'));
    expect(mockSetTheme).not.toHaveBeenCalled();
  });

  // ── Custom themes ─────────────────────────────────────────────────────

  it('renders custom themes from useCustomThemes() as additional cards', () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedPrivateTheme], loaded: true, refetch: mockRefetch });
    renderGrid();
    expect(screen.getByText('My Owned Theme')).toBeInTheDocument();
  });

  it('clicking a custom theme card calls onSelect with its custom-<id>', async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedPrivateTheme], loaded: true, refetch: mockRefetch });
    const { onSelect } = renderGrid();
    await userEvent.click(screen.getByText('My Owned Theme'));
    expect(onSelect).toHaveBeenCalledWith('custom-theme-owned-private');
  });

  // ── Create custom theme ───────────────────────────────────────────────

  it('renders a trailing "Create custom theme" card', () => {
    renderGrid();
    expect(screen.getByText(/create custom theme/i)).toBeInTheDocument();
  });

  it('clicking the "Create custom theme" card opens the editor in create mode', async () => {
    renderGrid();
    await userEvent.click(screen.getByText(/create custom theme/i));
    const modal = screen.getByTestId('theme-editor-modal');
    expect(modal.dataset.open).toBe('true');
    expect(modal.dataset.mode).toBe('create');
  });

  // ── Kebab menu presence ────────────────────────────────────────────────

  it('renders a kebab "More options" button on every built-in preset card except System', () => {
    renderGrid();
    expect(screen.getByRole('button', { name: 'More options for Dark' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More options for Light' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More options for System' })).not.toBeInTheDocument();
  });

  it('renders a kebab "More options" button on every custom theme card', () => {
    mockUseCustomThemes.mockReturnValue({
      themes: [ownedPrivateTheme, othersPublicTheme],
      loaded: true,
      refetch: mockRefetch,
    });
    renderGrid();
    expect(screen.getByRole('button', { name: 'More options for My Owned Theme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "More options for Someone Else's Theme" })).toBeInTheDocument();
  });

  it('does not render the old inline Copy/Pencil/Trash2 buttons (actions live in the kebab menu only)', () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedPrivateTheme], loaded: true, refetch: mockRefetch });
    renderGrid();
    expect(screen.queryByRole('button', { name: /^duplicate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete/i })).not.toBeInTheDocument();
  });

  // ── Menu contents per theme kind ─────────────────────────────────────

  it('built-in preset menu contains only Duplicate', async () => {
    renderGrid();
    const menu = await openMenuFor('Dark');
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Duplicate');
    expect(menu).toBeInTheDocument();
  });

  it('public custom theme menu (isOwner: true) contains Edit and Duplicate, but not Make public/Delete', async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedPublicTheme], loaded: true, refetch: mockRefetch });
    renderGrid();
    await openMenuFor('My Public Theme');
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Edit');
    expect(items[1]).toHaveTextContent('Duplicate');
  });

  it("public custom theme menu (someone else's, isOwner: false) contains only Duplicate, no Edit", async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [othersPublicTheme], loaded: true, refetch: mockRefetch });
    renderGrid();
    await openMenuFor("Someone Else's Theme");
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Duplicate');
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('private custom theme menu contains Edit, Duplicate, Make public, then Delete (in that order)', async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedPrivateTheme], loaded: true, refetch: mockRefetch });
    renderGrid();
    await openMenuFor('My Owned Theme');
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Edit');
    expect(items[1]).toHaveTextContent('Duplicate');
    expect(items[2]).toHaveTextContent('Make public');
    expect(items[3]).toHaveTextContent('Delete');
  });

  it('built-in preset menu never contains an Edit item (presets are not user-created)', async () => {
    renderGrid();
    await openMenuFor('Dark');
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('Edit is gated on isOwner alone, independent of isPublic — an owned public theme gets Edit but not Make public/Delete', async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedPublicTheme], loaded: true, refetch: mockRefetch });
    renderGrid();
    await openMenuFor('My Public Theme');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Make public' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('clicking Edit on an owned theme opens the editor directly in edit mode without calling createTheme', async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedPrivateTheme], loaded: true, refetch: mockRefetch });
    renderGrid();
    await openMenuFor('My Owned Theme');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));

    await waitFor(() => {
      const modal = screen.getByTestId('theme-editor-modal');
      expect(modal.dataset.open).toBe('true');
      expect(modal.dataset.mode).toBe('edit');
    });
    expect(mockCreateTheme).not.toHaveBeenCalled();

    const lastProps = editorModalProps.mock.calls[editorModalProps.mock.calls.length - 1][0];
    expect(lastProps.theme).toEqual(ownedPrivateTheme);
  });

  // ── Menu open/close behavior ──────────────────────────────────────────

  it('closes the menu on outside click', async () => {
    renderGrid();
    await openMenuFor('Dark');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes the menu on Escape', async () => {
    renderGrid();
    await openMenuFor('Dark');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  // ── Duplicate ─────────────────────────────────────────────────────────

  it('duplicating a built-in preset calls createTheme with a "<Label> copy" name and that preset\'s tokens, then refetches', async () => {
    mockCreateTheme.mockResolvedValue({
      id: 'new-1',
      userId: 'user-1',
      name: 'Dark copy',
      isPublic: false,
      isOwner: true,
      colorScheme: 'dark',
      tokens: {},
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    renderGrid();
    await openMenuFor('Dark');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));

    await waitFor(() => expect(mockCreateTheme).toHaveBeenCalledTimes(1));
    const payload = mockCreateTheme.mock.calls[0][0];
    expect(payload.name).toBe('Dark copy');
    expect(payload.colorScheme).toBe('dark');
    expect(payload.isPublic).toBe(false);
    // Spot-check a couple of the dark preset's canonical values (see
    // builtinThemeTokens.ts, mirrored from colors.css's [data-theme="dark"] block).
    expect(payload.tokens['--color-bg']).toBe('#0f172a');
    expect(payload.tokens['--color-accent']).toBe('#3b82f6');
    expect(payload.tokens['--color-text-primary']).toBe('#f1f5f9');

    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
  });

  it('does not show a Duplicate action on the System card (meta-choice, not a real palette)', () => {
    renderGrid();
    expect(screen.queryByRole('button', { name: 'More options for System' })).not.toBeInTheDocument();
  });

  it('duplicating a custom theme — including someone else\'s public theme (isOwner: false) — calls createTheme with its own tokens/colorScheme and isPublic: false', async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [othersPublicTheme], loaded: true, refetch: mockRefetch });
    mockCreateTheme.mockResolvedValue({
      ...othersPublicTheme,
      id: 'new-2',
      name: `${othersPublicTheme.name} copy`,
      isPublic: false,
      isOwner: true,
    });
    renderGrid();
    await openMenuFor("Someone Else's Theme");

    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));

    await waitFor(() => expect(mockCreateTheme).toHaveBeenCalledTimes(1));
    const payload = mockCreateTheme.mock.calls[0][0];
    expect(payload.name).toBe(`${othersPublicTheme.name} copy`);
    expect(payload.colorScheme).toBe(othersPublicTheme.colorScheme);
    expect(payload.tokens).toEqual(othersPublicTheme.tokens);
    expect(payload.isPublic).toBe(false);
  });

  it('duplicating a custom theme card does not call onSelect (it is not a selection)', async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedPrivateTheme], loaded: true, refetch: mockRefetch });
    mockCreateTheme.mockResolvedValue({ ...ownedPrivateTheme, id: 'new-3', name: 'My Owned Theme copy', isPublic: false });
    const { onSelect } = renderGrid();
    await openMenuFor('My Owned Theme');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));

    await waitFor(() => expect(mockCreateTheme).toHaveBeenCalledTimes(1));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('opens the editor in edit mode with the newly-created theme after a successful duplicate', async () => {
    const created = {
      id: 'new-1',
      userId: 'user-1',
      name: 'Dark copy',
      isPublic: false,
      isOwner: true,
      colorScheme: 'dark' as const,
      tokens: { '--color-bg': '#0f172a' },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    mockCreateTheme.mockResolvedValue(created);
    renderGrid();
    await openMenuFor('Dark');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));

    await waitFor(() => {
      const modal = screen.getByTestId('theme-editor-modal');
      expect(modal.dataset.open).toBe('true');
      expect(modal.dataset.mode).toBe('edit');
    });

    const lastProps = editorModalProps.mock.calls[editorModalProps.mock.calls.length - 1][0];
    expect(lastProps.theme).toEqual(created);
  });

  // ── Make public ───────────────────────────────────────────────────────

  it('clicking Make public calls updateTheme with isPublic: true and refetches', async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedPrivateTheme], loaded: true, refetch: mockRefetch });
    mockUpdateTheme.mockResolvedValue({ ...ownedPrivateTheme, isPublic: true });
    renderGrid();
    await openMenuFor('My Owned Theme');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Make public' }));

    await waitFor(() => expect(mockUpdateTheme).toHaveBeenCalledWith(ownedPrivateTheme.id, { isPublic: true }));
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
  });

  it('Make public closes the menu after firing', async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedPrivateTheme], loaded: true, refetch: mockRefetch });
    mockUpdateTheme.mockResolvedValue({ ...ownedPrivateTheme, isPublic: true });
    renderGrid();
    await openMenuFor('My Owned Theme');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Make public' }));

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  // ── Delete ────────────────────────────────────────────────────────────

  it('clicking Delete opens the confirmation AlertDialog rather than deleting immediately', async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedPrivateTheme], loaded: true, refetch: mockRefetch });
    renderGrid();
    await openMenuFor('My Owned Theme');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(mockDeleteTheme).not.toHaveBeenCalled();
    expect(screen.getByText(`Delete theme "${ownedPrivateTheme.name}"?`)).toBeInTheDocument();
  });

  it('confirming the delete dialog calls deleteTheme and refetches', async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedPrivateTheme], loaded: true, refetch: mockRefetch });
    mockDeleteTheme.mockResolvedValue(undefined);
    renderGrid();
    await openMenuFor('My Owned Theme');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockDeleteTheme).toHaveBeenCalledWith(ownedPrivateTheme.id));
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
  });

  it('falls back to system if the deleted theme was the active theme', async () => {
    mockUseTheme.mockReturnValue({
      theme: `custom-${ownedPrivateTheme.id}`,
      setTheme: mockSetTheme,
      resolvedTheme: 'dark',
    });
    mockUseCustomThemes.mockReturnValue({ themes: [ownedPrivateTheme], loaded: true, refetch: mockRefetch });
    mockDeleteTheme.mockResolvedValue(undefined);
    const { onSelect } = renderGrid();
    await openMenuFor('My Owned Theme');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('system'));
  });
});
