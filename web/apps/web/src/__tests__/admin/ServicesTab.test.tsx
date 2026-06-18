/**
 * Tests for the Services tab of the admin page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
  Toggle: ({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange: () => void;
  }) => (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      data-testid="service-toggle"
    />
  ),
  ProgressBar: () => <div role="progressbar" />,
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

// Use a module-level mock so we can spy on the methods directly
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

const sampleService = {
  name: 'neutrino-auth',
  endpoint: 'http://localhost:9000',
  version: '1.0.0',
  healthCheckUrl: 'http://localhost:9000/health',
  registeredAt: '2026-01-01T00:00:00Z',
  enabled: true,
  autoUpdate: false,
};

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

describe('AdminPage — Services tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.listServices).mockResolvedValue([sampleService]);
    vi.mocked(adminApi.updateService).mockResolvedValue({
      ...sampleService,
      enabled: false,
    });
  });

  it('renders the service name after navigating to the Services tab', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /services/i }));
    await waitFor(() => {
      expect(screen.getByText('neutrino-auth')).toBeInTheDocument();
    });
  });

  it('toggle calls adminApi.updateService with the negated enabled value', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /services/i }));
    await waitFor(() => {
      expect(screen.getByText('neutrino-auth')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('service-toggle'));
    await waitFor(() => {
      expect(adminApi.updateService).toHaveBeenCalledWith('neutrino-auth', false);
    });
  });

  it('shows empty state when no services are registered', async () => {
    vi.mocked(adminApi.listServices).mockResolvedValue([]);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /services/i }));
    await waitFor(() => {
      expect(screen.getByText(/no services registered/i)).toBeInTheDocument();
    });
  });
});
