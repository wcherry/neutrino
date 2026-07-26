/**
 * Unit tests for the shared theme-grid component (feature/custom-themes, red
 * phase). See agent_docs/plans/feature-custom-themes.md's "Shared theme-grid
 * component/hook" section: `ThemeGrid` renders the 9 built-in preset cards
 * (moved out of settings/page.tsx's `THEME_OPTIONS`) plus a "Custom themes"
 * section built from `useCustomThemes()`, plus a trailing "Create custom
 * theme" card that opens `ThemeEditorModal`.
 *
 * Import path assumption: `@/components/theme/ThemeGrid` — the plan leaves
 * the final file location/split (component vs. component + hook) to
 * frontend-developer; if the real path differs, frontend-developer should
 * move this test file alongside it rather than change the contract tested
 * here.
 *
 * Contract assumed (per the plan's "onSelect(themeId)" description): the
 * parent page owns applying (`setTheme`) and persisting (`save.mutate`) a
 * selection; `ThemeGrid` itself only reports *which* card was clicked via a
 * single `onSelect(themeId: string)` prop. It reads the currently-active
 * theme via `useTheme()` (mocked below) purely to highlight the active card
 * — it must NOT call `setTheme` itself.
 *
 * None of `@/components/theme/ThemeGrid`, `@/components/theme/ThemeEditorModal`,
 * or `@/providers/CustomThemesProvider` exist yet — every test below fails
 * (or fails to import) until frontend-developer adds them.
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

vi.mock('@/providers/CustomThemesProvider', () => ({
  useCustomThemes: () => mockUseCustomThemes(),
}));

// Duplicate uses themesApi.createTheme directly (see ThemeGrid.tsx's
// handleDuplicate) — mock it so no real HTTP call happens.
const mockCreateTheme = vi.fn();

vi.mock('@neutrino/api-themes', () => ({
  themesApi: {
    createTheme: (...args: unknown[]) => mockCreateTheme(...args),
    updateTheme: vi.fn(),
    deleteTheme: vi.fn(),
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

const ownedCustomTheme = {
  id: 'theme-owned',
  userId: 'user-1',
  name: 'My Owned Theme',
  isPublic: false,
  isOwner: true,
  colorScheme: 'dark' as const,
  tokens: { '--color-bg': '#111111', '--color-accent': '#4f46e5' },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ThemeGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTheme.mockReturnValue({
      theme: 'light',
      setTheme: mockSetTheme,
      resolvedTheme: 'light',
    });
    mockUseCustomThemes.mockReturnValue({ themes: [], loaded: true });
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
    mockUseCustomThemes.mockReturnValue({ themes: [ownedCustomTheme], loaded: true });
    renderGrid();
    expect(screen.getByText('My Owned Theme')).toBeInTheDocument();
  });

  it('clicking a custom theme card calls onSelect with its custom-<id>', async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedCustomTheme], loaded: true });
    const { onSelect } = renderGrid();
    await userEvent.click(screen.getByText('My Owned Theme'));
    expect(onSelect).toHaveBeenCalledWith('custom-theme-owned');
  });

  it('shows Edit and Delete controls on a custom theme card when isOwner is true', () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedCustomTheme], loaded: true });
    renderGrid();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('does not show Edit/Delete controls on a custom theme card when isOwner is false', () => {
    mockUseCustomThemes.mockReturnValue({ themes: [othersPublicTheme], loaded: true });
    renderGrid();
    expect(screen.getByText("Someone Else's Theme")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
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

  // ── Duplicate ─────────────────────────────────────────────────────────

  it('duplicating a built-in preset calls createTheme with a "<Label> copy" name and that preset\'s tokens', async () => {
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

    await userEvent.click(screen.getByRole('button', { name: 'Duplicate Dark' }));

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
  });

  it('does not show a Duplicate action on the System card (meta-choice, not a real palette)', () => {
    renderGrid();
    expect(screen.queryByRole('button', { name: 'Duplicate System' })).not.toBeInTheDocument();
  });

  it('duplicating a custom theme — including someone else\'s public theme (isOwner: false) — calls createTheme with its own tokens/colorScheme and isPublic: false', async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [othersPublicTheme], loaded: true });
    mockCreateTheme.mockResolvedValue({
      ...othersPublicTheme,
      id: 'new-2',
      name: `${othersPublicTheme.name} copy`,
      isPublic: false,
      isOwner: true,
    });
    renderGrid();

    await userEvent.click(screen.getByRole('button', { name: `Duplicate ${othersPublicTheme.name}` }));

    await waitFor(() => expect(mockCreateTheme).toHaveBeenCalledTimes(1));
    const payload = mockCreateTheme.mock.calls[0][0];
    expect(payload.name).toBe(`${othersPublicTheme.name} copy`);
    expect(payload.colorScheme).toBe(othersPublicTheme.colorScheme);
    expect(payload.tokens).toEqual(othersPublicTheme.tokens);
    expect(payload.isPublic).toBe(false);
  });

  it('duplicating a custom theme card does not call onSelect (it is not a selection)', async () => {
    mockUseCustomThemes.mockReturnValue({ themes: [ownedCustomTheme], loaded: true });
    mockCreateTheme.mockResolvedValue({ ...ownedCustomTheme, id: 'new-3', name: 'My Owned Theme copy', isPublic: false });
    const { onSelect } = renderGrid();

    await userEvent.click(screen.getByRole('button', { name: `Duplicate ${ownedCustomTheme.name}` }));

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

    await userEvent.click(screen.getByRole('button', { name: 'Duplicate Dark' }));

    await waitFor(() => {
      const modal = screen.getByTestId('theme-editor-modal');
      expect(modal.dataset.open).toBe('true');
      expect(modal.dataset.mode).toBe('edit');
    });

    const lastProps = editorModalProps.mock.calls[editorModalProps.mock.calls.length - 1][0];
    expect(lastProps.theme).toEqual(created);
  });
});
