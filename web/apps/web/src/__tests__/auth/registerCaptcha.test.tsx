/**
 * The register page and the sign-up CAPTCHA: the widget shows only when the
 * server publishes a Turnstile site key, Create is held until it yields a
 * token, the token goes with the sign-up, a failed attempt resets the widget
 * (tokens are single-use), an invite skips it, and a widget that cannot load
 * does not lock the form.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));

const register = vi.fn();
const login = vi.fn();
const signupPolicy = vi.fn();
const validate = vi.fn();
vi.mock('@neutrino/auth', () => ({
  authApi: {
    register: (...args: unknown[]) => register(...args),
    login: (...args: unknown[]) => login(...args),
    signupPolicy: (...args: unknown[]) => signupPolicy(...args),
  },
  invitesApi: { validate: (...args: unknown[]) => validate(...args) },
  provisionKeyring: vi.fn(),
  currentRecoveryKit: vi.fn(),
  enrollPasskey: vi.fn(),
}));

vi.mock('@/components/EncryptionSetupDialog', () => ({
  EncryptionSetupDialog: () => <div>Encryption setup</div>,
}));

// The widget stands in for Cloudflare: its buttons play the callbacks.
const reset = vi.fn();
vi.mock('@/components/TurnstileWidget', async () => {
  const ReactMod = await import('react');
  return {
    TurnstileWidget: ReactMod.forwardRef(function Fake(
      props: { siteKey: string; onToken: (t: string | null) => void; onLoadError?: () => void },
      ref: React.Ref<{ reset(): void }>,
    ) {
      ReactMod.useImperativeHandle(ref, () => ({
        reset() {
          reset();
          props.onToken(null);
        },
      }));
      return (
        <div data-testid="turnstile" data-sitekey={props.siteKey}>
          <button type="button" onClick={() => props.onToken('tok-ok')}>solve</button>
          <button type="button" onClick={() => props.onLoadError?.()}>fail-load</button>
        </div>
      );
    }),
  };
});

import RegisterPage from '@/app/(public)/register/page';

function fillForm() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bob' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bob@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
}

const createButton = () => screen.getByRole('button', { name: 'Create free account' });

describe('RegisterPage CAPTCHA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signupPolicy.mockResolvedValue({ publicSignup: true, turnstileSiteKey: 'site-1' });
    register.mockResolvedValue({ id: 'u1', email: 'bob@example.com', name: 'Bob' });
    login.mockResolvedValue(undefined);
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('shows no widget when the server publishes no site key', async () => {
    signupPolicy.mockResolvedValue({ publicSignup: true });
    render(<RegisterPage />);
    await waitFor(() => expect(signupPolicy).toHaveBeenCalled());
    expect(screen.queryByTestId('turnstile')).not.toBeInTheDocument();
    expect(createButton()).toBeEnabled();
  });

  it('holds Create until solved, then sends the token', async () => {
    render(<RegisterPage />);
    expect(await screen.findByTestId('turnstile')).toHaveAttribute('data-sitekey', 'site-1');
    fillForm();
    expect(createButton()).toBeDisabled();

    fireEvent.click(screen.getByText('solve'));
    expect(createButton()).toBeEnabled();
    fireEvent.submit(createButton().closest('form') as HTMLFormElement);

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'bob@example.com', turnstileToken: 'tok-ok' }),
      ),
    );
  });

  it('resets the widget after a failed sign-up', async () => {
    register.mockRejectedValue(new Error('Too many accounts'));
    render(<RegisterPage />);
    await screen.findByTestId('turnstile');
    fillForm();
    fireEvent.click(screen.getByText('solve'));
    await act(async () => {
      fireEvent.submit(createButton().closest('form') as HTMLFormElement);
    });

    expect(await screen.findByText('Too many accounts')).toBeInTheDocument();
    expect(reset).toHaveBeenCalled();
    expect(createButton()).toBeDisabled();
  });

  it('lets the form through when the widget cannot load', async () => {
    render(<RegisterPage />);
    await screen.findByTestId('turnstile');
    fillForm();
    fireEvent.click(screen.getByText('fail-load'));
    expect(createButton()).toBeEnabled();
    fireEvent.submit(createButton().closest('form') as HTMLFormElement);
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(register.mock.calls[0][0]).not.toHaveProperty('turnstileToken');
  });

  it('skips the CAPTCHA for a valid invite', async () => {
    window.history.pushState({}, '', '/register?invite=tok123');
    validate.mockResolvedValue({ kind: 'link', inviterName: 'Ada', email: null, expiresAt: '2026-12-01T00:00:00Z' });
    render(<RegisterPage />);
    await screen.findByText('Ada invited you to Neutrino.');
    expect(screen.queryByTestId('turnstile')).not.toBeInTheDocument();
  });
});
