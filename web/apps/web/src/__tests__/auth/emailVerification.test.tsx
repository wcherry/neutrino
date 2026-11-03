/**
 * Email verification on the web: `/verify-email?token=<token>` follows the link as soon as it
 * opens, a sign-in refused for an unverified address offers a fresh link, and the shell's banner
 * nags only where the server sends links, with what is held back and by when.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Matcher types (toBeInTheDocument, …): the setup file loads them at runtime, but tsc never sees it.
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ApiClientError } from '@neutrino/api-core';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));

const login = vi.fn();
const verifyEmail = vi.fn();
const getEmailVerification = vi.fn();
const resendEmailVerification = vi.fn();
const requestEmailVerification = vi.fn();
vi.mock('@neutrino/auth', () => ({
  authApi: {
    login: (...args: unknown[]) => login(...args),
    verifyEmail: (...args: unknown[]) => verifyEmail(...args),
    getEmailVerification: (...args: unknown[]) => getEmailVerification(...args),
    resendEmailVerification: (...args: unknown[]) => resendEmailVerification(...args),
    requestEmailVerification: (...args: unknown[]) => requestEmailVerification(...args),
  },
}));

import SignInPage from '@/app/(public)/sign-in/page';
import VerifyEmailPage from '@/app/(public)/verify-email/page';
import { EmailVerificationBanner } from '@/components/EmailVerificationBanner';

function withQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function status(over: Record<string, unknown> = {}) {
  return {
    email: 'ada@example.com',
    verified: false,
    verifiedAt: null,
    mode: 'soft',
    blockAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('VerifyEmailPage', () => {
  it('follows the link and says the address is verified', async () => {
    window.history.pushState({}, '', '/verify-email?token=tok123');
    verifyEmail.mockResolvedValue({ email: 'ada@example.com' });
    render(<VerifyEmailPage />);

    expect(await screen.findByRole('heading', { name: 'Email address verified' })).toBeInTheDocument();
    expect(verifyEmail).toHaveBeenCalledWith('tok123');
    expect(screen.getByRole('status')).toHaveTextContent('ada@example.com is verified');
    expect(screen.getByRole('link', { name: 'Continue to Neutrino' })).toHaveAttribute('href', '/drive');
  });

  it('treats a used link as already verified', async () => {
    window.history.pushState({}, '', '/verify-email?token=tok123');
    verifyEmail.mockRejectedValue(new ApiClientError(410, 'VERIFY_USED', 'used'));
    render(<VerifyEmailPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('your email address is verified');
    expect(screen.getByRole('link', { name: 'Continue to Neutrino' })).toBeInTheDocument();
  });

  it('sends an expired link to sign in for a new one', async () => {
    window.history.pushState({}, '', '/verify-email?token=tok123');
    verifyEmail.mockRejectedValue(new ApiClientError(410, 'VERIFY_EXPIRED', 'expired'));
    render(<VerifyEmailPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('has expired');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });

  it('explains a link with no token without calling the server', async () => {
    window.history.pushState({}, '', '/verify-email');
    render(<VerifyEmailPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent("isn't complete");
    expect(verifyEmail).not.toHaveBeenCalled();
  });
});

describe('sign-in refused for an unverified address', () => {
  it('offers a fresh verification link for the address typed', async () => {
    login.mockRejectedValue(
      new ApiClientError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address to keep using this account.'),
    );
    requestEmailVerification.mockResolvedValue(undefined);
    render(<SignInPage />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form') as HTMLFormElement);

    expect(await screen.findByText('Verify your email address to keep using this account.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send a new verification link' }));
    await waitFor(() => expect(requestEmailVerification).toHaveBeenCalledWith('ada@example.com'));
    expect(await screen.findByRole('status')).toHaveTextContent('A new verification link is on its way to ada@example.com');
  });

  it('offers nothing for an ordinary wrong password', async () => {
    login.mockRejectedValue(new ApiClientError(401, 'UNAUTHORIZED', 'Invalid email or password'));
    render(<SignInPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form') as HTMLFormElement);

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send a new verification link' })).not.toBeInTheDocument();
  });
});

describe('EmailVerificationBanner', () => {
  it('shows nothing once verified, or where the server sends no links', async () => {
    getEmailVerification.mockResolvedValue(status({ verified: true }));
    const { container, unmount } = render(withQuery(<EmailVerificationBanner />));
    await waitFor(() => expect(getEmailVerification).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();

    getEmailVerification.mockResolvedValue(status({ mode: 'off' }));
    const off = render(withQuery(<EmailVerificationBanner />));
    await waitFor(() => expect(getEmailVerification).toHaveBeenCalledTimes(2));
    expect(off.container).toBeEmptyDOMElement();
  });

  it('nags softly, resends and can be put off for the session', async () => {
    getEmailVerification.mockResolvedValue(status());
    resendEmailVerification.mockResolvedValue(undefined);
    render(withQuery(<EmailVerificationBanner />));

    const banner = await screen.findByRole('region', { name: 'Verify your email address' });
    expect(banner).toHaveTextContent('We sent a link to ada@example.com.');
    expect(banner).not.toHaveTextContent('share files');

    fireEvent.click(screen.getByRole('button', { name: 'Resend email' }));
    expect(await screen.findByRole('button', { name: 'Email sent' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region', { name: 'Verify your email address' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem('neutrino.emailVerification.dismissed')).toBe('1');
  });

  it('under enforcement says what is held back and by when', async () => {
    const blockAt = new Date(Date.now() + 20 * 86_400_000).toISOString().replace('Z', '');
    getEmailVerification.mockResolvedValue(status({ mode: 'enforce', blockAt }));
    render(withQuery(<EmailVerificationBanner />));

    const banner = await screen.findByRole('region', { name: 'Verify your email address' });
    expect(banner).toHaveTextContent('you can’t share files or reset your password');
    expect(banner).toHaveTextContent('to keep signing in');
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  it('cannot be put off in the last three days', async () => {
    sessionStorage.setItem('neutrino.emailVerification.dismissed', '1');
    const blockAt = new Date(Date.now() + 2 * 86_400_000).toISOString().replace('Z', '');
    getEmailVerification.mockResolvedValue(status({ mode: 'enforce', blockAt }));
    render(withQuery(<EmailVerificationBanner />));

    expect(await screen.findByRole('region', { name: 'Verify your email address' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument();
  });

  it('reports a resend refused for being too frequent', async () => {
    getEmailVerification.mockResolvedValue(status());
    resendEmailVerification.mockRejectedValue(
      new ApiClientError(429, 'TOO_MANY_REQUESTS', 'Several verification emails were sent in the last hour.'),
    );
    render(withQuery(<EmailVerificationBanner />));
    fireEvent.click(await screen.findByRole('button', { name: 'Resend email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Several verification emails');
  });
});
