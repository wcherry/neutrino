/**
 * Tests for the register page's password reveal toggles and confirm-password check.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const register = vi.fn();
const login = vi.fn();
const provisionKeyring = vi.fn();
vi.mock('@/lib/api', () => ({
  authApi: {
    register: (...args: unknown[]) => register(...args),
    login: (...args: unknown[]) => login(...args),
  },
}));

vi.mock('@neutrino/auth', () => ({
  provisionKeyring: (...args: unknown[]) => provisionKeyring(...args),
  currentRecoveryKit: vi.fn(),
  enrollPasskey: vi.fn(),
}));
vi.mock('@neutrino/e2e-crypto', () => ({
  isPasskeySupported: () => false,
  storeUnderPasskey: vi.fn(),
  getSessionKeyring: () => ({ userId: 'u1', entries: [] }),
}));

import RegisterPage from '@/app/register/page';

function fill(labelText: string, value: string) {
  fireEvent.change(screen.getByLabelText(labelText), { target: { value } });
}

describe('RegisterPage password fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    register.mockResolvedValue({ id: 'u1', email: 'w@example.com', name: 'William' });
    login.mockResolvedValue(undefined);
    provisionKeyring.mockResolvedValue({ recoveryKit: 'KIT0-1234-5678' });
  });

  it('toggles each password field between hidden and visible independently', () => {
    render(<RegisterPage />);

    const password = screen.getByLabelText('Password') as HTMLInputElement;
    const confirm = screen.getByLabelText('Confirm password') as HTMLInputElement;
    expect(password.type).toBe('password');
    expect(confirm.type).toBe('password');

    fireEvent.click(screen.getAllByLabelText('Show password')[0]);
    expect(password.type).toBe('text');
    expect(confirm.type).toBe('password');

    fireEvent.click(screen.getByLabelText('Hide password'));
    expect(password.type).toBe('password');
  });

  it('flags a mismatch and blocks submission', () => {
    render(<RegisterPage />);

    fill('Name', 'William');
    fill('Email', 'w@example.com');
    fill('Password', 'correct-horse');
    fill('Confirm password', 'correct-hors');

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Create free account' });
    expect(submit).toBeDisabled();

    fireEvent.submit(submit.closest('form') as HTMLFormElement);
    expect(register).not.toHaveBeenCalled();
  });

  it('registers when both passwords match', async () => {
    render(<RegisterPage />);

    fill('Name', 'William');
    fill('Email', 'w@example.com');
    fill('Password', 'correct-horse');
    fill('Confirm password', 'correct-horse');

    expect(screen.queryByText('Passwords do not match')).not.toBeInTheDocument();
    fireEvent.submit(
      screen.getByRole('button', { name: 'Create free account' }).closest('form') as HTMLFormElement,
    );

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        name: 'William',
        email: 'w@example.com',
        password: 'correct-horse',
      }),
    );
    // The new key is wrapped to the device, not to the account password, so the
    // sign-up is never asked to unlock it later. The redirect still waits on
    // setup — see encryptionSetupDialog.test.tsx.
    await waitFor(() =>
      expect(provisionKeyring).toHaveBeenCalledWith('u1', 'w@example.com', {
        method: 'device',
      }),
    );
    await waitFor(() =>
      expect(screen.getByText('Your encryption key is ready')).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });
});
