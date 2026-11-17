/**
 * Settings → Calendar → Calendar & Reminders apps: app passwords for CalDAV clients. A password
 * is shown once, with what the iPhone asks for, and each device's can be revoked on its own.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const auth = vi.hoisted(() => ({
  listAppPasswords: vi.fn(),
  createAppPassword: vi.fn(),
  revokeAppPassword: vi.fn(),
}));

vi.mock('@neutrino/auth', () => ({
  authApi: auth,
  useAuth: () => ({ user: { id: 'u1', email: 'ada@example.com' } }),
}));

vi.mock('@neutrino/ui', () => ({
  Spinner: () => <span>Loading</span>,
  Button: ({ children, onClick, type, disabled }: {
    children: React.ReactNode;
    onClick?: () => void;
    type?: 'button' | 'submit';
    disabled?: boolean;
  }) => (
    <button type={type ?? 'button'} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  AlertDialog: ({ open, title, confirmLabel, onConfirm, onClose }: {
    open: boolean;
    title: string;
    confirmLabel?: string;
    onConfirm?: () => void;
    onClose: () => void;
  }) =>
    open ? (
      <div role="alertdialog" aria-label={title}>
        <button onClick={onClose}>Cancel</button>
        <button onClick={onConfirm}>{confirmLabel}</button>
      </div>
    ) : null,
}));

import { CalendarAppsSection } from '@/app/(apps)/settings/CalendarAppsSection';

const iphone = { id: 'p1', name: 'iPhone', createdAt: '2026-11-16T10:00:00Z', lastUsedAt: null };

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CalendarAppsSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.listAppPasswords.mockResolvedValue([iphone]);
  auth.revokeAppPassword.mockResolvedValue(undefined);
});

describe('CalendarAppsSection', () => {
  it('lists the devices that have a password', async () => {
    renderSection();
    const row = await screen.findByTestId('app-password-row');
    expect(within(row).getByText('iPhone')).toBeTruthy();
    expect(within(row).getByText(/not used yet/)).toBeTruthy();
  });

  it('shows a new password once, with the server and user name the iPhone asks for', async () => {
    auth.createAppPassword.mockResolvedValue({
      appPassword: { ...iphone, id: 'p2', name: 'Mac' },
      password: 'abcd-efgh-ijkm-nopq',
    });
    renderSection();
    fireEvent.change(screen.getByLabelText('Device name'), { target: { value: ' Mac ' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Add a device'));
    });
    expect(auth.createAppPassword).toHaveBeenCalledWith('Mac');
    const created = await screen.findByTestId('app-password-created');
    expect(within(created).getByText('abcd-efgh-ijkm-nopq')).toBeTruthy();
    expect(within(created).getByText('ada@example.com')).toBeTruthy();
    expect(within(created).getByText(window.location.host)).toBeTruthy();
    expect(within(created).getByText(/Add CalDAV Account/)).toBeTruthy();
    fireEvent.click(within(created).getByText('Done'));
    expect(screen.queryByText('abcd-efgh-ijkm-nopq')).toBeNull();
  });

  it('does not add a device with no name', () => {
    renderSection();
    expect((screen.getByText('Add a device') as HTMLButtonElement).disabled).toBe(true);
  });

  it('revokes a device after asking', async () => {
    renderSection();
    const row = await screen.findByTestId('app-password-row');
    fireEvent.click(within(row).getByLabelText('Revoke iPhone'));
    const dialog = screen.getByRole('alertdialog', { name: 'Revoke the password for iPhone?' });
    expect(auth.revokeAppPassword).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByText('Revoke'));
    });
    await waitFor(() => expect(auth.revokeAppPassword).toHaveBeenCalledWith('p1'));
  });
});
