/**
 * The register page and invites: `/register?invite=<token>` says who invited
 * you, pre-fills the invited address and sends the token with the sign-up; a
 * spent or expired link says so; and with public sign-up closed and no valid
 * invite the form gives way to an explanation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Matcher types (toBeInTheDocument, …): the setup file loads them at runtime, but tsc never sees it.
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
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
  invitesApi: {
    validate: (...args: unknown[]) => validate(...args),
  },
  provisionKeyring: vi.fn(),
  currentRecoveryKit: vi.fn(),
  enrollPasskey: vi.fn(),
}));

vi.mock('@/components/EncryptionSetupDialog', () => ({
  EncryptionSetupDialog: () => <div>Encryption setup</div>,
}));

import RegisterPage from '@/app/(public)/register/page';

const INVITE_ONLY =
  'Sign-up on this server is by invitation only. Ask someone with an account to invite you.';
const BAD_INVITE = 'This invite link has expired or was already used.';

class FakeApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function emailInvite() {
  return { kind: 'email', inviterName: 'Ada', email: 'bob@example.com', expiresAt: '2026-11-07T00:00:00Z' };
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit() {
  fireEvent.submit(
    screen.getByRole('button', { name: 'Create free account' }).closest('form') as HTMLFormElement,
  );
}

describe('RegisterPage with an invite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/register?invite=tok123');
    signupPolicy.mockResolvedValue({ publicSignup: true });
    validate.mockResolvedValue(emailInvite());
    register.mockResolvedValue({ id: 'u1', email: 'bob@example.com', name: 'Bob' });
    login.mockResolvedValue(undefined);
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('validates the token from the URL', async () => {
    render(<RegisterPage />);

    await waitFor(() => expect(validate).toHaveBeenCalledWith('tok123'));
  });

  it('says who sent the invite', async () => {
    render(<RegisterPage />);

    expect(await screen.findByText('Ada invited you to Neutrino.')).toBeInTheDocument();
  });

  it('pre-fills the invited address', async () => {
    render(<RegisterPage />);

    await waitFor(() =>
      expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('bob@example.com'),
    );
  });

  it('leaves the address empty for a personal link', async () => {
    validate.mockResolvedValue({ kind: 'link', inviterName: 'Ada', email: null, expiresAt: '2026-11-07T00:00:00Z' });
    render(<RegisterPage />);

    await screen.findByText('Ada invited you to Neutrino.');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('');
  });

  it('sends the invite token with the sign-up', async () => {
    render(<RegisterPage />);
    await screen.findByText('Ada invited you to Neutrino.');
    await waitFor(() =>
      expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('bob@example.com'),
    );

    fill('Name', 'Bob');
    fill('Password', 'correct-horse');
    fill('Confirm password', 'correct-horse');
    submit();

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({
        name: 'Bob',
        email: 'bob@example.com',
        password: 'correct-horse',
        inviteToken: 'tok123',
      }),
    );
  });

  it('lets the invited person sign up with a different address', async () => {
    render(<RegisterPage />);
    await screen.findByText('Ada invited you to Neutrino.');

    fill('Name', 'Bob');
    fill('Email', 'bob.home@example.com');
    fill('Password', 'correct-horse');
    fill('Confirm password', 'correct-horse');
    submit();

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'bob.home@example.com', inviteToken: 'tok123' }),
      ),
    );
  });

  it('says so when the link has expired or was used, and keeps the form while sign-up is open', async () => {
    validate.mockRejectedValue(new FakeApiError(410, 'INVITE_EXPIRED', 'This invite has expired'));
    render(<RegisterPage />);

    expect(await screen.findByText(BAD_INVITE)).toBeInTheDocument();
    expect(screen.queryByText('Ada invited you to Neutrino.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create free account' })).toBeInTheDocument();
  });

  it('does not send a token that failed validation', async () => {
    validate.mockRejectedValue(new FakeApiError(404, 'INVITE_NOT_FOUND', 'No such invite'));
    render(<RegisterPage />);
    await screen.findByText(BAD_INVITE);

    fill('Name', 'Bob');
    fill('Email', 'bob@example.com');
    fill('Password', 'correct-horse');
    fill('Confirm password', 'correct-horse');
    submit();

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0][0].inviteToken).toBeUndefined();
  });

  it('shows the form when sign-up is closed but the invite is valid', async () => {
    signupPolicy.mockResolvedValue({ publicSignup: false });
    render(<RegisterPage />);

    await screen.findByText('Ada invited you to Neutrino.');
    expect(screen.getByRole('button', { name: 'Create free account' })).toBeInTheDocument();
    expect(screen.queryByText(INVITE_ONLY)).not.toBeInTheDocument();
  });

  it('explains invitation-only instead of the form when sign-up is closed and the invite is bad', async () => {
    signupPolicy.mockResolvedValue({ publicSignup: false });
    validate.mockRejectedValue(new FakeApiError(410, 'INVITE_USED', 'Already used'));
    render(<RegisterPage />);

    expect(await screen.findByText(INVITE_ONLY)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create free account' })).not.toBeInTheDocument();
  });
});

describe('RegisterPage without an invite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/register');
    register.mockResolvedValue({ id: 'u1', email: 'w@example.com', name: 'William' });
    login.mockResolvedValue(undefined);
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('explains invitation-only and shows no form when sign-up is closed', async () => {
    signupPolicy.mockResolvedValue({ publicSignup: false });
    render(<RegisterPage />);

    expect(await screen.findByText(INVITE_ONLY)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create free account' })).not.toBeInTheDocument();
  });

  it('does not try to validate anything', async () => {
    signupPolicy.mockResolvedValue({ publicSignup: true });
    render(<RegisterPage />);

    await waitFor(() => expect(signupPolicy).toHaveBeenCalled());
    expect(validate).not.toHaveBeenCalled();
  });

  it('shows the ordinary form, with no invite banner, when sign-up is open', async () => {
    signupPolicy.mockResolvedValue({ publicSignup: true });
    render(<RegisterPage />);

    await waitFor(() => expect(signupPolicy).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Create free account' })).toBeInTheDocument();
    expect(screen.queryByText(INVITE_ONLY)).not.toBeInTheDocument();
    expect(screen.queryByText(/invited you to Neutrino/)).not.toBeInTheDocument();
  });

  it('sends no invite token', async () => {
    signupPolicy.mockResolvedValue({ publicSignup: true });
    render(<RegisterPage />);
    await waitFor(() => expect(signupPolicy).toHaveBeenCalled());

    fill('Name', 'William');
    fill('Email', 'w@example.com');
    fill('Password', 'correct-horse');
    fill('Confirm password', 'correct-horse');
    submit();

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0][0].inviteToken).toBeUndefined();
  });
});
