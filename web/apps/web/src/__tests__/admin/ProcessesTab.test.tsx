/**
 * Tests for the Processes tab of the admin page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin',
}));

vi.mock('@neutrino/auth', () => ({
  useAuth: () => ({
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
  }),
}));

vi.mock('@/providers/FeatureFlagsProvider', () => ({
  useFeatureFlags: () => ({ adminDashboard: true }),
  useFeatureFlagsLoaded: () => true,
}));

vi.mock('@neutrino/ui', () => ({
  Spinner: () => <div data-testid="spinner" />,
  Toggle: () => <button role="switch" />,
  ProgressBar: () => <div role="progressbar" />,
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@neutrino/api-admin', () => ({
  adminApi: {
    getProcesses: vi.fn(() => Promise.resolve([])),
    getDisk: vi.fn(() =>
      Promise.resolve({ totalBytes: 0, usedBytes: 0, freeBytes: 0, paths: [] })
    ),
    listServices: vi.fn(() => Promise.resolve([])),
    updateService: vi.fn(() => Promise.resolve({})),
  },
}));

// ---------------------------------------------------------------------------
// Static import (after vi.mock declarations)
// ---------------------------------------------------------------------------

import AdminPage from '@/app/(apps)/admin/page';
import { adminApi } from '@neutrino/api-admin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

describe('AdminPage — Processes tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a loading spinner while processes are loading', () => {
    // Return a promise that never resolves to keep the loading state
    vi.mocked(adminApi.getProcesses).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('renders process name and PID after data loads', async () => {
    vi.mocked(adminApi.getProcesses).mockResolvedValue([
      {
        pid: 999,
        name: 'neutrino-drive',
        status: 'Running',
        cpuPercent: 1.5,
        memoryRssKb: 16384,
        openFiles: 8,
      },
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('neutrino-drive')).toBeInTheDocument();
    });
    expect(screen.getByText('999')).toBeInTheDocument();
  });

  it('renders an error message when the query fails', async () => {
    vi.mocked(adminApi.getProcesses).mockRejectedValue(new Error('Forbidden'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/failed to load process/i)).toBeInTheDocument();
    });
  });
});
