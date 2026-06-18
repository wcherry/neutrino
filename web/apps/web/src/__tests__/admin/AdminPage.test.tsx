/**
 * Tests for the admin page — auth guard, tab rendering, redirect behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports of the module under test
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, back: vi.fn() }),
  usePathname: () => '/admin',
}));

const mockUseAuth = vi.fn();
vi.mock('@neutrino/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@neutrino/api-admin', () => ({
  adminApi: {
    getProcesses: vi.fn(() => Promise.resolve([])),
    getDisk: vi.fn(() =>
      Promise.resolve({ totalBytes: 0, usedBytes: 0, freeBytes: 0, paths: [] })
    ),
    listServices: vi.fn(() => Promise.resolve([])),
    updateService: vi.fn(),
    listUsers: vi.fn(() =>
      Promise.resolve({ users: [], total: 0, page: 1, pageSize: 20 })
    ),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
  },
}));

vi.mock('@/providers/FeatureFlagsProvider', () => ({
  useFeatureFlags: () => ({ adminDashboard: true }),
  useFeatureFlagsLoaded: () => true,
}));

// Mock the UI package to avoid CSS module loading issues in jsdom
vi.mock('@neutrino/ui', () => ({
  Spinner: ({ size }: { size?: string }) => (
    <div data-testid="spinner" data-size={size} />
  ),
  Toggle: ({
    checked,
    onChange,
    disabled,
  }: {
    checked: boolean;
    onChange: () => void;
    disabled?: boolean;
  }) => (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      data-testid="toggle"
    />
  ),
  ProgressBar: ({ value, max }: { value: number; max: number }) => (
    <div role="progressbar" aria-valuenow={value} aria-valuemax={max} />
  ),
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Static import of the module under test — after all vi.mock() calls
// ---------------------------------------------------------------------------

import AdminPage from '@/app/(apps)/admin/page';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function adminUser() {
  return {
    user: {
      id: '1',
      email: 'admin@example.com',
      name: 'Admin',
      isAdmin: true,
      createdAt: '',
    },
    isLoading: false,
    isAuthenticated: true,
    refresh: vi.fn(),
    signOut: vi.fn(),
  };
}

function regularUser() {
  return {
    user: {
      id: '2',
      email: 'user@example.com',
      name: 'User',
      isAdmin: false,
      createdAt: '',
    },
    isLoading: false,
    isAuthenticated: true,
    refresh: vi.fn(),
    signOut: vi.fn(),
  };
}

function makeQC() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
    },
  });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeQC()}>
      <AdminPage />
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(adminUser());
  });

  it('renders the Admin heading for admin users', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /admin/i })).toBeInTheDocument();
  });

  it('shows the Processes tab button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /processes/i })).toBeInTheDocument();
  });

  it('renders Disk Space and Services tab buttons', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /disk space/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /services/i })).toBeInTheDocument();
  });

  it('redirects non-admin users to /drive', () => {
    mockUseAuth.mockReturnValue(regularUser());
    renderPage();
    expect(mockReplace).toHaveBeenCalledWith('/drive');
  });

  it('shows a spinner while auth is loading', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: true,
      isAuthenticated: false,
      refresh: vi.fn(),
      signOut: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('switches to Disk Space tab on click and shows disk content', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /disk space/i }));
    await waitFor(() => {
      expect(screen.getByText(/disk usage/i)).toBeInTheDocument();
    });
  });

  it('renders the Users tab button', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /^users$/i })).toBeInTheDocument();
  });

  it('switches to Users tab and shows empty state when no users', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^users$/i }));
    await waitFor(() => {
      expect(screen.getByText(/no users found/i)).toBeInTheDocument();
    });
  });

  it('shows a user row with role select and Remove button', async () => {
    const { adminApi } = await import('@neutrino/api-admin');
    vi.mocked(adminApi.listUsers).mockResolvedValueOnce({
      users: [
        {
          id: 'u2',
          email: 'bob@example.com',
          name: 'Bob',
          role: 'user',
          totpEnabled: false,
          createdAt: '2026-01-01T00:00:00Z',
          deletedAt: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^users$/i }));
    await waitFor(() => {
      expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });
});
