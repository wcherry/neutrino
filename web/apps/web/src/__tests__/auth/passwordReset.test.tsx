/**
 * Forgot password: the sign-in page links to it, `/forgot-password` confirms the same way whatever
 * the address, and `/reset-password?token=<token>` checks the link before asking for a password,
 * asks for a two-factor code only when the account has one, and turns a dead link into a way to
 * get a new one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Matcher types (toBeInTheDocument, …): the setup file loads them at runtime, but tsc never sees it.
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { ApiClientError } from '@neutrino/api-core';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));

const forgotPassword = vi.fn();
const checkPasswordReset = vi.fn();
const resetPassword = vi.fn();
vi.mock('@neutrino/auth', () => ({
  authApi: {
    login: vi.fn(),
    forgotPassword: (...args: unknown[]) => forgotPassword(...args),
    checkPasswordReset: (...args: unknown[]) => checkPasswordReset(...args),
    resetPassword: (...args: unknown[]) => resetPassword(...args),
  },
}));

import SignInPage from '@/app/(public)/sign-in/page';
import ForgotPasswordPage from '@/app/(public)/forgot-password/page';
import ResetPasswordPage from '@/app/(public)/reset-password/page';

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit(name: string) {
  fireEvent.submit(screen.getByRole('button', { name }).closest('form') as HTMLFormElement);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('sign-in', () => {
  it('links to the forgot-password page', () => {
    render(<SignInPage />);
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});

describe('ForgotPasswordPage', () => {
  it('asks for a link and confirms without saying whether the account exists', async () => {
    forgotPassword.mockResolvedValue(undefined);
    render(<ForgotPasswordPage />);
    fill('Email', ' ada@example.com ');
    submit('Send reset link');

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('If ada@example.com has an account'));
    expect(forgotPassword).toHaveBeenCalledWith('ada@example.com');
  });

  it('can start over with another address', async () => {
    forgotPassword.mockResolvedValue(undefined);
    render(<ForgotPasswordPage />);
    fill('Email', 'ada@example.com');
    submit('Send reset link');
    fireEvent.click(await screen.findByRole('button', { name: 'Try another address' }));
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('shows a failure to send', async () => {
    forgotPassword.mockRejectedValue(new Error('Network down'));
    render(<ForgotPasswordPage />);
    fill('Email', 'ada@example.com');
    submit('Send reset link');
    expect(await screen.findByText('Network down')).toBeInTheDocument();
  });
});

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/reset-password?token=tok123');
  });

  it('checks the link, then sets the password with it', async () => {
    checkPasswordReset.mockResolvedValue({ email: 'ada@example.com', requiresTwoFactor: false });
    resetPassword.mockResolvedValue(undefined);
    render(<ResetPasswordPage />);

    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
    expect(checkPasswordReset).toHaveBeenCalledWith('tok123');
    expect(screen.queryByLabelText('Two-factor code')).not.toBeInTheDocument();

    fill('New password', 'new-password-2');
    fill('Confirm new password', 'new-password-2');
    submit('Set new password');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Password changed' })).toBeInTheDocument());
    expect(resetPassword).toHaveBeenCalledWith({
      token: 'tok123',
      newPassword: 'new-password-2',
      totpCode: undefined,
    });
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });

  it('asks for a two-factor code when the account has it', async () => {
    checkPasswordReset.mockResolvedValue({ email: 'ada@example.com', requiresTwoFactor: true });
    resetPassword.mockResolvedValue(undefined);
    render(<ResetPasswordPage />);

    await screen.findByLabelText('Two-factor code');
    fill('Two-factor code', '123456');
    fill('New password', 'new-password-2');
    fill('Confirm new password', 'new-password-2');
    submit('Set new password');

    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith(expect.objectContaining({ totpCode: '123456' })),
    );
  });

  it('refuses two passwords that differ without calling the server', async () => {
    checkPasswordReset.mockResolvedValue({ email: 'ada@example.com', requiresTwoFactor: false });
    render(<ResetPasswordPage />);
    await screen.findByText('ada@example.com');

    fill('New password', 'new-password-2');
    fill('Confirm new password', 'something-else');
    submit('Set new password');

    expect(screen.getByText('The two passwords do not match')).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('keeps the form up when the password breaks the policy', async () => {
    checkPasswordReset.mockResolvedValue({ email: 'ada@example.com', requiresTwoFactor: false });
    resetPassword.mockRejectedValue(new ApiClientError(400, 'BAD_REQUEST', 'Password must be at least 12 characters'));
    render(<ResetPasswordPage />);
    await screen.findByText('ada@example.com');

    fill('New password', 'short');
    fill('Confirm new password', 'short');
    submit('Set new password');

    expect(await screen.findByText('Password must be at least 12 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  it('turns an expired link into a way to get a new one', async () => {
    checkPasswordReset.mockRejectedValue(new ApiClientError(410, 'RESET_EXPIRED', 'expired'));
    render(<ResetPasswordPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('This reset link has expired.');
    expect(screen.getByRole('link', { name: 'Send a new link' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('says so when the link is used up between opening the page and submitting it', async () => {
    checkPasswordReset.mockResolvedValue({ email: 'ada@example.com', requiresTwoFactor: false });
    resetPassword.mockRejectedValue(new ApiClientError(410, 'RESET_USED', 'used'));
    render(<ResetPasswordPage />);
    await screen.findByText('ada@example.com');

    fill('New password', 'new-password-2');
    fill('Confirm new password', 'new-password-2');
    submit('Set new password');

    expect(await screen.findByRole('alert')).toHaveTextContent('already been used');
  });

  it('explains a link with no token', async () => {
    window.history.pushState({}, '', '/reset-password');
    render(<ResetPasswordPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent("isn't complete");
    expect(checkPasswordReset).not.toHaveBeenCalled();
  });
});
