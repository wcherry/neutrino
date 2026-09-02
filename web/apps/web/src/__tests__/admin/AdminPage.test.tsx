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
    createUser: vi.fn(),
    deleteUser: vi.fn(),
    restoreUser: vi.fn(),
    // The Users tab reads the storage column for the whole page in one call.
    listQuotas: vi.fn(() => Promise.resolve([])),
    getUserQuota: vi.fn(() =>
      Promise.resolve({
        userId: 'u2',
        usedBytes: 0,
        quotaBytes: null,
        dailyCapBytes: null,
        dailyUploadBytes: 0,
      })
    ),
    setUserQuota: vi.fn(),
    listQuotaRequests: vi.fn(() => Promise.resolve([])),
    approveQuotaRequest: vi.fn(),
    denyQuotaRequest: vi.fn(),
    getPasswordPolicy: vi.fn(() =>
      Promise.resolve({
        minLength: 8,
        requireUppercase: false,
        requireLowercase: false,
        requireNumber: false,
        requireSymbol: false,
        maxAgeDays: 0,
        updatedAt: '2026-09-01T00:00:00Z',
        forbiddenCharacters: '',
        lockoutThreshold: 0,
        historyCount: 0,
      })
    ),
    updatePasswordPolicy: vi.fn(),
    getVersionRetention: vi.fn(() =>
      Promise.resolve({
        enabled: true,
        retentionDays: 30,
        minVersions: 10,
        updatedAt: '2026-08-30T00:00:00Z',
      })
    ),
    updateVersionRetention: vi.fn(),
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
  // The user dialogs live behind these; an open Modal renders its children,
  // a closed one renders nothing, which is the whole of what the tests read.
  Modal: ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  ModalHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ModalBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
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
import type { AdminUser, PasswordPolicy } from '@neutrino/api-admin';

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

/**
 * A live account, for spreading the one field under test over.
 *
 * `AdminUser` carries the lock-out and password-expiry state as well as the
 * deletion window now, and every one of those fields is required — so the
 * fixture lives in one place rather than being spelled out per test.
 */
function userFixture(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'u2',
    email: 'bob@example.com',
    name: 'Bob',
    role: 'user',
    totpEnabled: false,
    createdAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    purgeAfter: null,
    disabledAt: null,
    passwordChangedAt: '2026-01-01T00:00:00Z',
    passwordExpired: false,
    passwordExpiresAt: null,
    lockedOutAt: null,
    failedLoginAttempts: 0,
    ...overrides,
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

  it('switches to Versions tab and shows the retention policy', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^versions$/i }));

    const days = await screen.findByLabelText(/days to keep versions/i);
    expect(days).toHaveValue(30);
    expect(screen.getByLabelText(/minimum versions to keep/i)).toHaveValue(10);
    // Nothing edited yet, so there is nothing to save.
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  /**
   * The two numbers are saved together as one rule, so editing either one is
   * what arms the button — and what is sent is the whole policy, not a diff.
   */
  it('saves an edited retention policy', async () => {
    const { adminApi } = await import('@neutrino/api-admin');
    vi.mocked(adminApi.updateVersionRetention).mockResolvedValueOnce({
      enabled: true,
      retentionDays: 90,
      minVersions: 10,
      updatedAt: '2026-08-30T01:00:00Z',
    });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^versions$/i }));

    const days = await screen.findByLabelText(/days to keep versions/i);
    fireEvent.change(days, { target: { value: '90' } });

    const save = screen.getByRole('button', { name: /^save$/i });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => {
      expect(adminApi.updateVersionRetention).toHaveBeenCalledWith({
        enabled: true,
        retentionDays: 90,
        minVersions: 10,
      });
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
      users: [userFixture()],
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

/**
 * Deleting an account only soft-deletes it; the worker erases it 30 days later.
 * The admin console is the only place that window is visible or reversible, so
 * these cover getting the deleted accounts on screen and undoing the delete.
 */
describe('AdminPage — deleted accounts', () => {
  const DELETED_USER = userFixture({
    id: 'u9',
    email: 'gone@example.com',
    name: 'Gone',
    deletedAt: '2026-08-01T00:00:00Z',
    purgeAfter: '2026-08-31T00:00:00Z',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(adminUser());
  });

  async function openUsersWithDeleted() {
    const { adminApi } = await import('@neutrino/api-admin');
    vi.mocked(adminApi.listUsers).mockImplementation((_page, _size, includeDeleted) =>
      Promise.resolve({
        users: includeDeleted ? [DELETED_USER] : [],
        total: includeDeleted ? 1 : 0,
        page: 1,
        pageSize: 20,
      }),
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^users$/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/show deleted accounts/i)).toBeInTheDocument();
    });
    return adminApi;
  }

  it('hides deleted accounts until asked for, then lists them', async () => {
    const adminApi = await openUsersWithDeleted();

    // The default listing is the live one — a deleted account is invisible
    // everywhere else in the product and the console is no exception.
    await waitFor(() => expect(screen.getByText(/no users found/i)).toBeInTheDocument());
    expect(adminApi.listUsers).toHaveBeenCalledWith(1, 20, false);

    fireEvent.click(screen.getByLabelText(/show deleted accounts/i));

    await waitFor(() => {
      expect(screen.getByText('gone@example.com')).toBeInTheDocument();
    });
    expect(adminApi.listUsers).toHaveBeenCalledWith(1, 20, true);
  });

  it('shows how long is left before the account is purged', async () => {
    await openUsersWithDeleted();
    fireEvent.click(screen.getByLabelText(/show deleted accounts/i));

    // Counted from the server's `purgeAfter`, so the number on screen is the
    // one the worker will actually act on.
    await waitFor(() => {
      expect(screen.getByText(/deleted —/i)).toBeInTheDocument();
    });
  });

  it('restores a deleted account and refreshes the list', async () => {
    const adminApi = await openUsersWithDeleted();
    vi.mocked(adminApi.restoreUser).mockResolvedValue({
      ...DELETED_USER,
      deletedAt: null,
      purgeAfter: null,
    });

    fireEvent.click(screen.getByLabelText(/show deleted accounts/i));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /restore/i }));

    await waitFor(() => {
      expect(adminApi.restoreUser).toHaveBeenCalledWith('u9');
    });
  });

  it('offers Restore instead of Remove on a deleted row', async () => {
    await openUsersWithDeleted();
    fireEvent.click(screen.getByLabelText(/show deleted accounts/i));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
    });
    // Deleting something already deleted has nothing to do, and the row is
    // about to be erased regardless.
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });
});

/**
 * Account administration: creating an account, setting its storage limit,
 * locking it out and expiring its password.
 *
 * The through-line in these is that each control writes only the field it is
 * named for — the API applies them independently, and a Disable that quietly
 * also expired a password would be a lock-out an admin could not undo by
 * pressing Enable.
 */
describe('AdminPage — account administration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(adminUser());
  });

  async function openUsers(users: AdminUser[]) {
    const { adminApi } = await import('@neutrino/api-admin');
    vi.mocked(adminApi.listUsers).mockResolvedValue({
      users,
      total: users.length,
      page: 1,
      pageSize: 20,
    });
    vi.mocked(adminApi.listQuotas).mockResolvedValue(
      users.map((u) => ({
        userId: u.id,
        usedBytes: 512 * 1024 * 1024,
        quotaBytes: 1024 * 1024 * 1024,
        dailyCapBytes: null,
        dailyUploadBytes: 0,
      })),
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^users$/i }));
    await waitFor(() => {
      expect(screen.getByText(users[0].email)).toBeInTheDocument();
    });
    return adminApi;
  }

  it('shows what each account is using and what it is allowed', async () => {
    await openUsers([userFixture()]);
    await waitFor(() => {
      expect(screen.getByText('512.0 MB / 1.00 GB')).toBeInTheDocument();
    });
  });

  it('reads the storage column for the whole page in one request', async () => {
    const adminApi = await openUsers([
      userFixture({ id: 'a', email: 'a@example.com' }),
      userFixture({ id: 'b', email: 'b@example.com' }),
    ]);
    await waitFor(() => {
      expect(adminApi.listQuotas).toHaveBeenCalledWith(['a', 'b']);
    });
    expect(vi.mocked(adminApi.listQuotas).mock.calls).toHaveLength(1);
  });

  it('locks an account out and offers to let it back in', async () => {
    const adminApi = await openUsers([userFixture()]);
    vi.mocked(adminApi.updateUser).mockResolvedValue(userFixture({ disabledAt: 'now' }));

    fireEvent.click(screen.getByRole('button', { name: /^disable$/i }));

    await waitFor(() => {
      expect(adminApi.updateUser).toHaveBeenCalledWith('u2', { disabled: true });
    });
  });

  it('offers Enable, not Disable, on an account already locked out', async () => {
    await openUsers([userFixture({ disabledAt: '2026-08-01T00:00:00Z' })]);
    expect(screen.getByRole('button', { name: /^enable$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^disable$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/^disabled$/i)).toBeInTheDocument();
  });

  /**
   * A lockout the failed-sign-in threshold applied is a different state from an
   * account an admin disabled, and is undone by a different control.
   */
  it('shows a locked account and offers to release it', async () => {
    const adminApi = await openUsers([
      userFixture({ lockedOutAt: '2026-09-01T00:00:00Z', failedLoginAttempts: 5 }),
    ]);
    expect(screen.getByText(/^locked$/i)).toBeInTheDocument();
    vi.mocked(adminApi.updateUser).mockResolvedValue(userFixture());

    fireEvent.click(screen.getByRole('button', { name: /^unlock$/i }));

    await waitFor(() => {
      expect(adminApi.updateUser).toHaveBeenCalledWith('u2', { unlock: true });
    });
  });

  it('offers no Unlock on an account that is not locked', async () => {
    await openUsers([userFixture()]);
    expect(screen.queryByRole('button', { name: /^unlock$/i })).not.toBeInTheDocument();
  });

  it('expires a password without touching anything else', async () => {
    const adminApi = await openUsers([userFixture()]);
    vi.mocked(adminApi.updateUser).mockResolvedValue(userFixture({ passwordExpired: true }));

    fireEvent.click(screen.getByRole('button', { name: /expire password/i }));

    await waitFor(() => {
      expect(adminApi.updateUser).toHaveBeenCalledWith('u2', { expirePassword: true });
    });
  });

  /** Expiring an already-expired password would say nothing and do nothing. */
  it('will not expire a password that is already expired', async () => {
    await openUsers([userFixture({ passwordExpired: true })]);
    expect(screen.getByRole('button', { name: /expire password/i })).toBeDisabled();
    expect(screen.getByText(/password expired/i)).toBeInTheDocument();
  });

  /**
   * Both controls end the session pressing them, so an admin's own row offers
   * neither — the role select is already fixed for the same reason.
   */
  it('does not offer to lock out or expire the signed-in admin', async () => {
    await openUsers([userFixture({ id: '1', email: 'admin@example.com', name: 'Admin' })]);
    expect(screen.queryByRole('button', { name: /^disable$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /expire password/i })).not.toBeInTheDocument();
    expect(screen.getByText(/^you$/i)).toBeInTheDocument();
  });

  it('creates a fully registered account', async () => {
    const adminApi = await openUsers([userFixture()]);
    vi.mocked(adminApi.createUser).mockResolvedValue({
      id: 'u3',
      email: 'new@example.com',
      name: 'New',
    });

    fireEvent.click(screen.getByRole('button', { name: /new user/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'a-good-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create user$/i }));

    await waitFor(() => {
      expect(adminApi.createUser).toHaveBeenCalledWith({
        email: 'new@example.com',
        name: 'New',
        password: 'a-good-password',
        role: 'user',
        // On by default: the admin knows the password they just typed.
        requirePasswordChange: true,
      });
    });
  });

  /**
   * The policy names the rule that was broken, and repeating it is the only way
   * the person setting the password learns what the policy is.
   */
  it('shows the policy message when a password is refused', async () => {
    const adminApi = await openUsers([userFixture()]);
    const { ApiClientError } = await import('@neutrino/api-core');
    vi.mocked(adminApi.createUser).mockRejectedValue(
      new ApiClientError(400, 'PASSWORD_POLICY', 'Password must be at least 14 characters'),
    );

    fireEvent.click(screen.getByRole('button', { name: /new user/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /^create user$/i }));

    await waitFor(() => {
      expect(screen.getByText(/at least 14 characters/i)).toBeInTheDocument();
    });
  });

  it('sets a storage limit from the numbers already in force', async () => {
    const adminApi = await openUsers([userFixture()]);
    vi.mocked(adminApi.getUserQuota).mockResolvedValue({
      userId: 'u2',
      usedBytes: 512 * 1024 * 1024,
      quotaBytes: 1024 * 1024 * 1024,
      dailyCapBytes: null,
      dailyUploadBytes: 0,
    });
    vi.mocked(adminApi.setUserQuota).mockResolvedValue({
      userId: 'u2',
      usedBytes: 512 * 1024 * 1024,
      quotaBytes: 5 * 1024 * 1024 * 1024,
      dailyCapBytes: null,
      dailyUploadBytes: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: /^storage$/i }));

    // The form opens on the limit actually in force, not on a placeholder: a
    // PUT replaces both fields, so a guess saved by accident is a real change.
    await waitFor(() => {
      expect(screen.getByLabelText(/storage limit/i)).toHaveValue(1);
    });

    fireEvent.change(screen.getByLabelText(/storage limit/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(adminApi.setUserQuota).toHaveBeenCalledWith('u2', {
        quotaBytes: 5 * 1024 * 1024 * 1024,
        // Left empty, which is what unlimited looks like in the form.
        dailyCapBytes: null,
      });
    });
  });
});

/**
 * The work queue — storage requests users have filed from their storage meter
 * (issue #144), and the two things an admin can do about one.
 */
describe('AdminPage — work queue', () => {
  const PENDING = {
    id: 'r1',
    userId: 'u2',
    requestedBytes: 5 * 1024 * 1024 * 1024,
    reason: 'Photo library',
    status: 'pending' as const,
    grantedBytes: null,
    decisionNote: null,
    decidedAt: null,
    createdAt: '2026-09-01T00:00:00Z',
    userEmail: 'bob@example.com',
    userName: 'Bob',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(adminUser());
  });

  async function openQueue(requests = [PENDING]) {
    const { adminApi } = await import('@neutrino/api-admin');
    vi.mocked(adminApi.listQuotaRequests).mockResolvedValue(requests);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /work queue/i }));
    // Waits on the heading rather than on a row, so an empty queue is a state
    // this helper can open on rather than a timeout.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /work queue/i })).toBeInTheDocument();
    });
    return adminApi;
  }

  it('opens on the pending requests, which are the only ones that are work', async () => {
    const adminApi = await openQueue();
    await waitFor(() => {
      expect(adminApi.listQuotaRequests).toHaveBeenCalledWith('pending');
    });
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    expect(screen.getByText(/photo library/i)).toBeInTheDocument();
  });

  it('says so plainly when there is nothing waiting', async () => {
    await openQueue([]);
    await waitFor(() => {
      expect(screen.getByText(/nothing waiting for you/i)).toBeInTheDocument();
    });
  });

  it('approves a request for the amount asked for', async () => {
    const adminApi = await openQueue();
    vi.mocked(adminApi.approveQuotaRequest).mockResolvedValue({
      ...PENDING,
      status: 'approved',
      grantedBytes: PENDING.requestedBytes,
    });

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    // The dialog opens on what was asked for, since granting it in full is the
    // common case.
    await waitFor(() => {
      expect(screen.getByLabelText(/grant/i)).toHaveValue(5);
    });
    // [0] is the row's button, which opened the dialog; [1] confirms it.
    fireEvent.click(screen.getAllByRole('button', { name: /^approve$/i })[1]);

    await waitFor(() => {
      expect(adminApi.approveQuotaRequest).toHaveBeenCalledWith('r1', {
        grantedBytes: 5 * 1024 * 1024 * 1024,
        note: undefined,
      });
    });
  });

  it('can grant less than was asked for', async () => {
    const adminApi = await openQueue();
    vi.mocked(adminApi.approveQuotaRequest).mockResolvedValue({
      ...PENDING,
      status: 'approved',
      grantedBytes: 2 * 1024 * 1024 * 1024,
    });

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    await waitFor(() => expect(screen.getByLabelText(/grant/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/grant/i), { target: { value: '2' } });
    fireEvent.click(screen.getAllByRole('button', { name: /^approve$/i })[1]);

    await waitFor(() => {
      expect(adminApi.approveQuotaRequest).toHaveBeenCalledWith('r1', {
        grantedBytes: 2 * 1024 * 1024 * 1024,
        note: undefined,
      });
    });
  });

  it('denies a request with the note the user will see', async () => {
    const adminApi = await openQueue();
    vi.mocked(adminApi.denyQuotaRequest).mockResolvedValue({
      ...PENDING,
      status: 'denied',
      decisionNote: 'Clear your trash first',
    });

    fireEvent.click(screen.getByRole('button', { name: /^deny$/i }));
    await waitFor(() => expect(screen.getByLabelText(/^note/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^note/i), {
      target: { value: 'Clear your trash first' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /^deny$/i })[1]);

    await waitFor(() => {
      expect(adminApi.denyQuotaRequest).toHaveBeenCalledWith('r1', {
        note: 'Clear your trash first',
      });
    });
  });

  /** Two admins working the queue must not both grant the same storage. */
  it('reports a request someone else has already decided', async () => {
    const adminApi = await openQueue();
    const { ApiClientError } = await import('@neutrino/api-core');
    vi.mocked(adminApi.approveQuotaRequest).mockRejectedValue(
      new ApiClientError(409, 'CONFLICT', 'This request has already been decided'),
    );

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    await waitFor(() => expect(screen.getByLabelText(/grant/i)).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /^approve$/i })[1]);

    await waitFor(() => {
      expect(screen.getByText(/already decided this request/i)).toBeInTheDocument();
    });
  });
});

/**
 * The password rules, which live in the Users tab rather than in a tab of their
 * own. Saved as one thing, so a half-typed rule is never in force while the
 * rest of the form is still being filled in.
 */
describe('AdminPage — password rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue(adminUser());
  });

  /** The saved policy the mock returns, so a test only spells out what it changed. */
  function savedPolicy(overrides: Partial<PasswordPolicy> = {}): PasswordPolicy {
    return {
      minLength: 8,
      requireUppercase: false,
      requireLowercase: false,
      requireNumber: false,
      requireSymbol: false,
      maxAgeDays: 0,
      updatedAt: '2026-09-02T00:00:00Z',
      forbiddenCharacters: '',
      lockoutThreshold: 0,
      historyCount: 0,
      ...overrides,
    };
  }

  async function openPolicy() {
    const { adminApi } = await import('@neutrino/api-admin');
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^users$/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/minimum password length/i)).toBeInTheDocument();
    });
    return adminApi;
  }

  /** The rules are the rules the table above is held to, not a separate place. */
  it('sits in the Users tab rather than in a tab of its own', async () => {
    renderPage();
    expect(
      screen.queryByRole('button', { name: /password policy/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^users$/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /password rules/i })).toBeInTheDocument();
    });
  });

  it('shows the rules currently in force', async () => {
    const adminApi = await openPolicy();
    expect(adminApi.getPasswordPolicy).toHaveBeenCalled();
    expect(screen.getByLabelText(/minimum password length/i)).toHaveValue(8);
    expect(screen.getByLabelText(/days before a password expires/i)).toHaveValue(0);
    expect(screen.getByLabelText(/forbidden characters/i)).toHaveValue('');
    expect(screen.getByLabelText(/failed sign-ins before the account locks/i)).toHaveValue(0);
    expect(screen.getByLabelText(/previous passwords that cannot be reused/i)).toHaveValue(0);
  });

  it('saves nothing until Save is pressed, then saves the whole policy', async () => {
    const adminApi = await openPolicy();
    vi.mocked(adminApi.updatePasswordPolicy).mockResolvedValue(
      savedPolicy({ minLength: 12, maxAgeDays: 90, lockoutThreshold: 5, historyCount: 3 }),
    );

    fireEvent.change(screen.getByLabelText(/minimum password length/i), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByLabelText(/days before a password expires/i), {
      target: { value: '90' },
    });
    fireEvent.change(screen.getByLabelText(/failed sign-ins before the account locks/i), {
      target: { value: '5' },
    });
    fireEvent.change(screen.getByLabelText(/previous passwords that cannot be reused/i), {
      target: { value: '3' },
    });
    expect(adminApi.updatePasswordPolicy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /save rules/i }));

    await waitFor(() => {
      expect(adminApi.updatePasswordPolicy).toHaveBeenCalledWith({
        minLength: 12,
        requireUppercase: false,
        requireLowercase: false,
        requireNumber: false,
        requireSymbol: false,
        maxAgeDays: 90,
        forbiddenCharacters: '',
        lockoutThreshold: 5,
        historyCount: 3,
      });
    });
  });

  /**
   * The stored value is a set of characters however it was typed, and the chips
   * are what says so before the admin presses Save.
   */
  it('reduces the forbidden characters to a set and shows them back', async () => {
    const adminApi = await openPolicy();
    vi.mocked(adminApi.updatePasswordPolicy).mockResolvedValue(
      savedPolicy({ forbiddenCharacters: '<>&' }),
    );

    fireEvent.change(screen.getByLabelText(/forbidden characters/i), {
      target: { value: '< > & <' },
    });
    expect(screen.getByLabelText(/forbidden characters/i)).toHaveValue('<>&');

    const chips = screen.getByLabelText(/forbidden character list/i);
    expect(chips.textContent).toBe('<>&');

    fireEvent.click(screen.getByRole('button', { name: /save rules/i }));
    await waitFor(() => {
      expect(adminApi.updatePasswordPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ forbiddenCharacters: '<>&' }),
      );
    });
  });

  /** A rule the server would refuse must not be reachable from the form. */
  it('holds the counts inside the ranges the server accepts', async () => {
    await openPolicy();
    fireEvent.change(screen.getByLabelText(/minimum password length/i), {
      target: { value: '2' },
    });
    expect(screen.getByLabelText(/minimum password length/i)).toHaveValue(8);

    fireEvent.change(screen.getByLabelText(/previous passwords that cannot be reused/i), {
      target: { value: '99' },
    });
    expect(screen.getByLabelText(/previous passwords that cannot be reused/i)).toHaveValue(24);
  });

  /** Nothing has changed, so there is nothing to save. */
  it('leaves Save disabled until something changes', async () => {
    await openPolicy();
    expect(screen.getByRole('button', { name: /save rules/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/minimum password length/i), {
      target: { value: '20' },
    });
    expect(screen.getByRole('button', { name: /save rules/i })).toBeEnabled();
  });
});
