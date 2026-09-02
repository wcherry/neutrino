'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Spinner, Toggle, ProgressBar, useToast, DropZone } from '@neutrino/ui';
import { useAuth } from '@neutrino/auth';
import { adminApi, fontsApi } from '@neutrino/api-admin';
import { ApiClientError } from '@neutrino/api-core';
import type { ProcessInfo, DiskUsageInfo, ServiceInfo, AdminUser, UserQuota, FeatureFlag, JobResponse, CustomFont, VersionRetentionSettings } from '@neutrino/api-admin';
import { CreateUserDialog, ResetPasswordDialog, UserQuotaDialog } from './UserDialogs';
import { PasswordPolicySection } from './PasswordPolicySection';
import { WorkQueueTab } from './WorkQueueTab';
import { formatBytes, formatLimit, usagePercent } from './bytes';
import styles from './page.module.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * How long a deleted account has left before the worker erases it.
 *
 * `purgeAfter` is computed on the server from the retention policy, so the
 * countdown here cannot drift from what the worker actually enforces. It can
 * be in the past: the sweep runs hourly, and an account past its window simply
 * has not been picked up yet — "Purging now" rather than a negative number.
 */
function purgeLabel(u: AdminUser): string {
  if (!u.purgeAfter) return 'Deleted';
  const days = Math.ceil((new Date(u.purgeAfter).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'Deleted — purging now';
  return `Deleted — ${days} day${days === 1 ? '' : 's'} left`;
}

function purgeTitle(u: AdminUser): string {
  const deleted = u.deletedAt ? new Date(u.deletedAt).toLocaleString() : 'unknown';
  if (!u.purgeAfter) return `Deleted ${deleted}`;
  return `Deleted ${deleted}. Permanently erased after ${new Date(u.purgeAfter).toLocaleString()}.`;
}

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'running') return styles.statusRunning;
  if (s === 'sleeping') return styles.statusSleeping;
  return styles.statusOther;
}

// Job status codes stored in the DB: R (running), I (in progress),
// C (completed), E (error).
const JOB_STATUS_LABELS: Record<string, string> = {
  R: 'Queued',
  I: 'In progress',
  C: 'Completed',
  E: 'Error',
};

function jobStatusLabel(status: string): string {
  return JOB_STATUS_LABELS[status] ?? status;
}

function jobStatusClass(status: string): string {
  if (status === 'C') return styles.statusRunning;
  if (status === 'E') return styles.statusOther;
  return styles.statusSleeping;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProcessesTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-processes'],
    queryFn: () => adminApi.getProcesses(),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        Failed to load process information. You may not have admin permissions.
      </div>
    );
  }

  const processes: ProcessInfo[] = data ?? [];

  if (processes.length === 0) {
    return <div className={styles.empty}>No process data available.</div>;
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Running Processes</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>PID</th>
              <th>Name</th>
              <th>Status</th>
              <th>CPU %</th>
              <th>Memory (RSS KB)</th>
              <th>Open Files</th>
            </tr>
          </thead>
          <tbody>
            {processes.map((proc) => (
              <tr key={proc.pid}>
                <td>{proc.pid}</td>
                <td>{proc.name}</td>
                <td>
                  <span className={statusClass(proc.status)}>{proc.status}</span>
                </td>
                <td>{proc.cpuPercent.toFixed(1)}</td>
                <td>{proc.memoryRssKb.toLocaleString()}</td>
                <td>{proc.openFiles}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiskTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-disk'],
    queryFn: () => adminApi.getDisk(),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        Failed to load disk usage information.
      </div>
    );
  }

  const disk: DiskUsageInfo = data ?? { totalBytes: 0, usedBytes: 0, freeBytes: 0, paths: [] };
  const usedPercent =
    disk.totalBytes > 0
      ? Math.round((disk.usedBytes / disk.totalBytes) * 100)
      : 0;

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Disk Usage</h2>
      <div className={styles.diskStats}>
        <div className={styles.diskStat}>
          <span className={styles.diskStatLabel}>Total</span>
          <span className={styles.diskStatValue}>{formatBytes(disk.totalBytes)}</span>
        </div>
        <div className={styles.diskStat}>
          <span className={styles.diskStatLabel}>Used</span>
          <span className={styles.diskStatValue}>{formatBytes(disk.usedBytes)}</span>
        </div>
        <div className={styles.diskStat}>
          <span className={styles.diskStatLabel}>Free</span>
          <span className={styles.diskStatValue}>{formatBytes(disk.freeBytes)}</span>
        </div>
      </div>
      <div className={styles.diskBarWrap}>
        <div className={styles.diskBarLabel}>{usedPercent}% used</div>
        <ProgressBar
          value={usedPercent}
          max={100}
          size="lg"
          color={usedPercent >= 90 ? 'error' : usedPercent >= 75 ? 'warning' : 'accent'}
          aria-label="Disk usage"
        />
      </div>
      {disk.paths.length > 0 && (
        <>
          <h2 className={styles.sectionTitle}>Paths</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Used</th>
                  <th>% Used</th>
                </tr>
              </thead>
              <tbody>
                {disk.paths.map((p) => (
                  <tr key={p.path}>
                    <td>{p.path}</td>
                    <td>{formatBytes(p.usedBytes)}</td>
                    <td>{p.percent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ServicesTab() {
  const qc = useQueryClient();
  const { error: toastError } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-services'],
    queryFn: () => adminApi.listServices(),
  });

  const toggleEnabled = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      adminApi.updateService(name, enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-services'] });
    },
    onError: () => {
      toastError('Failed to update service. Please try again.');
    },
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        Failed to load service information.
      </div>
    );
  }

  const services: ServiceInfo[] = data ?? [];

  if (services.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Registered Services</h2>
        <div className={styles.empty}>No services registered yet.</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Registered Services</h2>
      <div className={styles.serviceList}>
        {services.map((svc) => (
          <div key={svc.name} className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <span className={styles.serviceName}>{svc.name}</span>
              <span className={styles.serviceMeta}>
                {svc.endpoint} &middot; v{svc.version}
              </span>
            </div>
            <div className={styles.serviceControls}>
              <span className={styles.serviceLabel}>
                {svc.enabled ? 'Enabled' : 'Disabled'}
              </span>
              <Toggle
                checked={svc.enabled}
                disabled={toggleEnabled.isPending}
                aria-label={`Toggle ${svc.name}`}
                onChange={() => {
                  toggleEnabled.mutate({ name: svc.name, enabled: !svc.enabled });
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The page size the Users tab lists at, and the batch its quotas are read in. */
const USERS_PAGE_SIZE = 20;

function UsersTab() {
  const { user: currentUser } = useAuth();
  const qc = useQueryClient();
  const { error: toastError, success: toastSuccess } = useToast();
  const [page, setPage] = useState(1);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [quotaUser, setQuotaUser] = useState<AdminUser | null>(null);
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);

  const { data, isLoading, error } = useQuery({
    // `showDeleted` is part of the key: the two listings have different totals,
    // so sharing one cache entry would page the wrong one.
    queryKey: ['admin-users', page, showDeleted],
    queryFn: () => adminApi.listUsers(page, USERS_PAGE_SIZE, showDeleted),
  });

  const userIds = (data?.users ?? []).map((u) => u.id);

  /**
   * The storage figures for the page on screen, in one request rather than one
   * per row. Keyed by the ids so paging refetches, and deliberately separate
   * from the listing: a slow quota read must not hold the user table back, and
   * a failed one leaves the table intact with the storage column blank.
   */
  const quotas = useQuery({
    queryKey: ['admin-user-quotas', userIds],
    queryFn: () => adminApi.listQuotas(userIds),
    enabled: userIds.length > 0,
  });

  const quotaById = new Map<string, UserQuota>((quotas.data ?? []).map((q) => [q.userId, q]));

  /**
   * Every edit an admin can make to a row goes through one mutation.
   *
   * The API applies each field independently, so the caller sends the change
   * and a sentence describing it; splitting this into a mutation per field
   * would be five copies of the same invalidate-and-toast.
   */
  const updateUser = useMutation({
    mutationFn: ({
      userId,
      changes,
    }: {
      userId: string;
      changes: Parameters<typeof adminApi.updateUser>[1];
      message: string;
    }) => adminApi.updateUser(userId, changes),
    onSuccess: (_user, variables) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toastSuccess(variables.message);
    },
    onError: () => {
      toastError('Failed to update user. Please try again.');
    },
  });

  const deleteUser = useMutation({
    mutationFn: (userId: string) => adminApi.deleteUser(userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      setConfirmDeleteId(null);
      toastSuccess('User deleted.');
    },
    onError: () => {
      toastError('Failed to delete user. Please try again.');
      setConfirmDeleteId(null);
    },
  });

  /**
   * Undoes a delete while the account is still in its retention window.
   *
   * A 404 here means the window has already closed and the worker has erased
   * the account — nothing can bring it back, so it is worth saying plainly
   * rather than inviting a retry that will fail the same way.
   */
  const restoreUser = useMutation({
    mutationFn: (userId: string) => adminApi.restoreUser(userId),
    onSuccess: (user) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toastSuccess(`${user.name} restored.`);
    },
    onError: (err) => {
      toastError(
        err instanceof ApiClientError && err.statusCode === 404
          ? 'That account has already been permanently deleted and cannot be restored.'
          : 'Failed to restore user. Please try again.',
      );
    },
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  // The two are independent reads, so a listing that failed leaves the rules
  // editable — an admin who came here to tighten the policy should not be sent
  // away because the user table happened to fail.
  if (error) {
    return (
      <>
        <div className={styles.error}>
          Failed to load users. You may not have admin permissions.
        </div>
        <PasswordPolicySection />
      </>
    );
  }

  const users: AdminUser[] = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / USERS_PAGE_SIZE);

  // The toggle has to render even with nothing in the list, or an admin whose
  // only remaining accounts are deleted ones has no way to reveal them.
  const deletedToggle = (
    <label className={styles.showDeletedRow}>
      <input
        type="checkbox"
        checked={showDeleted}
        onChange={(e) => {
          setShowDeleted(e.target.checked);
          setPage(1);
        }}
      />
      Show deleted accounts
    </label>
  );

  const header = (
    <>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>
          Users <span className={styles.userCount}>({total})</span>
        </h2>
        <button type="button" className={styles.primaryBtn} onClick={() => setCreating(true)}>
          New user
        </button>
      </div>
      {deletedToggle}
    </>
  );

  const dialogs = (
    <>
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} />
      <UserQuotaDialog user={quotaUser} onClose={() => setQuotaUser(null)} />
      <ResetPasswordDialog user={resetUser} onClose={() => setResetUser(null)} />
    </>
  );

  if (users.length === 0) {
    return (
      <>
        <div className={styles.section}>
          {header}
          <div className={styles.empty}>No users found.</div>
          {dialogs}
        </div>
        <PasswordPolicySection />
      </>
    );
  }

  return (
    <>
    <div className={styles.section}>
      {header}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Storage</th>
              <th>Status</th>
              <th>2FA</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const quota = quotaById.get(u.id);
              const percent = quota ? usagePercent(quota.usedBytes, quota.quotaBytes) : null;
              // A deleted account is on its way out, so every control that
              // writes to its row is off: the worker is about to erase it.
              const readOnly = !!u.deletedAt;
              const isSelf = u.id === currentUser?.id;
              return (
                <tr key={u.id} className={u.deletedAt ? styles.deletedRow : undefined}>
                  <td>
                    {u.name}
                    {u.deletedAt && (
                      <span className={styles.deletedBadge} title={purgeTitle(u)}>
                        {purgeLabel(u)}
                      </span>
                    )}
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      className={styles.roleSelect}
                      value={u.role}
                      // An admin demoting themselves would lose the console
                      // they are standing in, so their own row is fixed.
                      disabled={isSelf || updateUser.isPending || readOnly}
                      onChange={(e) =>
                        updateUser.mutate({
                          userId: u.id,
                          changes: { role: e.target.value },
                          message: `${u.name} is now ${e.target.value}.`,
                        })
                      }
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    {quotas.isLoading ? (
                      <span className={styles.serviceMeta}>…</span>
                    ) : quota ? (
                      <div className={styles.quotaCell}>
                        <span
                          className={`${styles.quotaText} ${
                            percent !== null && percent >= 100 ? styles.quotaOver : ''
                          }`}
                        >
                          {formatBytes(quota.usedBytes)} / {formatLimit(quota.quotaBytes)}
                        </span>
                        {percent !== null && (
                          <ProgressBar
                            value={percent}
                            max={100}
                            size="sm"
                            color={percent >= 90 ? 'error' : percent >= 75 ? 'warning' : 'accent'}
                            aria-label={`Storage used by ${u.name}`}
                          />
                        )}
                      </div>
                    ) : (
                      <span className={styles.serviceMeta}>—</span>
                    )}
                  </td>
                  <td>
                    <span className={styles.badgeRow}>
                      {u.disabledAt && (
                        <span
                          className={styles.badgeDisabled}
                          title={`Disabled ${new Date(u.disabledAt).toLocaleString()}`}
                        >
                          Disabled
                        </span>
                      )}
                      {u.lockedOutAt && (
                        <span
                          className={styles.badgeLocked}
                          title={`Locked ${new Date(
                            u.lockedOutAt,
                          ).toLocaleString()} after ${u.failedLoginAttempts} failed sign-in attempts`}
                        >
                          Locked
                        </span>
                      )}
                      {u.passwordExpired && (
                        <span
                          className={styles.badgeExpired}
                          title="Sign-in is refused until this user sets a new password"
                        >
                          Password expired
                        </span>
                      )}
                      {!u.disabledAt && !u.lockedOutAt && !u.passwordExpired && (
                        <span className={styles.badgeOk}>Active</span>
                      )}
                    </span>
                  </td>
                  <td>
                    <span className={u.totpEnabled ? styles.twoFaOn : styles.twoFaOff}>
                      {u.totpEnabled ? 'On' : 'Off'}
                    </span>
                  </td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td>
                    {u.deletedAt ? (
                      <button
                        className={styles.restoreBtn}
                        onClick={() => restoreUser.mutate(u.id)}
                        disabled={restoreUser.isPending}
                        type="button"
                      >
                        Restore
                      </button>
                    ) : (
                      <span className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.linkBtn}
                          onClick={() => setQuotaUser(u)}
                        >
                          Storage
                        </button>
                        <button
                          type="button"
                          className={styles.linkBtn}
                          onClick={() => setResetUser(u)}
                        >
                          Password
                        </button>
                        {/* Releasing a lockout only ever restores access, so
                            unlike Disable it is safe on an admin's own row —
                            though a locked admin has no session to do it from,
                            which is why it is here rather than nowhere. */}
                        {u.lockedOutAt && (
                          <button
                            type="button"
                            className={styles.linkBtn}
                            disabled={updateUser.isPending}
                            title="Clear the lockout and the failed-attempt count behind it"
                            onClick={() =>
                              updateUser.mutate({
                                userId: u.id,
                                changes: { unlock: true },
                                message: `${u.name} can sign in again.`,
                              })
                            }
                          >
                            Unlock
                          </button>
                        )}
                        {/* Locking yourself out, or expiring your own password,
                            ends the session doing it — so an admin's own row
                            offers neither. */}
                        {!isSelf && (
                          <>
                            <button
                              type="button"
                              className={styles.linkBtn}
                              disabled={updateUser.isPending || u.passwordExpired}
                              title={
                                u.passwordExpired
                                  ? 'This password is already expired'
                                  : 'Refuse sign-in until they set a new password'
                              }
                              onClick={() =>
                                updateUser.mutate({
                                  userId: u.id,
                                  changes: { expirePassword: true },
                                  message: `${u.name} must set a new password.`,
                                })
                              }
                            >
                              Expire password
                            </button>
                            <button
                              type="button"
                              className={u.disabledAt ? styles.linkBtn : styles.deleteBtn}
                              disabled={updateUser.isPending}
                              onClick={() =>
                                updateUser.mutate({
                                  userId: u.id,
                                  changes: { disabled: !u.disabledAt },
                                  message: u.disabledAt
                                    ? `${u.name} can sign in again.`
                                    : `${u.name} is locked out.`,
                                })
                              }
                            >
                              {u.disabledAt ? 'Enable' : 'Disable'}
                            </button>
                          </>
                        )}
                        {isSelf ? (
                          <span className={styles.selfLabel}>You</span>
                        ) : confirmDeleteId === u.id ? (
                          <span className={styles.confirmRow}>
                            <button
                              className={styles.confirmBtn}
                              onClick={() => deleteUser.mutate(u.id)}
                              disabled={deleteUser.isPending}
                              type="button"
                            >
                              Confirm
                            </button>
                            <button
                              className={styles.cancelBtn}
                              onClick={() => setConfirmDeleteId(null)}
                              type="button"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            className={styles.deleteBtn}
                            onClick={() => setConfirmDeleteId(u.id)}
                            type="button"
                          >
                            Remove
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            type="button"
          >
            Previous
          </button>
          <span className={styles.pageInfo}>
            Page {page} of {totalPages}
          </span>
          <button
            className={styles.pageBtn}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            type="button"
          >
            Next
          </button>
        </div>
      )}
      {dialogs}
    </div>
    <PasswordPolicySection />
    </>
  );
}

function FeatureFlagsTab() {
  const qc = useQueryClient();
  const { error: toastError, success: toastSuccess } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-feature-flags'],
    queryFn: () => adminApi.listFeatureFlags(),
  });

  const toggleFlag = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      adminApi.updateFeatureFlag(key, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-feature-flags'] });
      toastSuccess('Feature flag updated.');
    },
    onError: () => {
      toastError('Failed to update feature flag. Please try again.');
    },
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        Failed to load feature flags.
      </div>
    );
  }

  const flags: FeatureFlag[] = data ?? [];

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Feature Flags</h2>
      <div className={styles.serviceList}>
        {flags.map((flag) => (
          <div key={flag.key} className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <span className={styles.serviceName}>{flag.key}</span>
              {flag.description && (
                <span className={styles.serviceMeta}>{flag.description}</span>
              )}
            </div>
            <div className={styles.serviceControls}>
              <span className={styles.serviceLabel}>
                {flag.enabled ? 'Enabled' : 'Disabled'}
              </span>
              <Toggle
                checked={flag.enabled}
                disabled={toggleFlag.isPending}
                aria-label={`Toggle ${flag.key}`}
                onChange={() => {
                  toggleFlag.mutate({ key: flag.key, enabled: !flag.enabled });
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FontsTab() {
  const qc = useQueryClient();
  const { error: toastError, success: toastSuccess } = useToast();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-fonts'],
    queryFn: () => fontsApi.list(),
  });

  const uploadFont = useMutation({
    mutationFn: () => adminApi.uploadFont(pendingFile!, displayName.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-fonts'] });
      toastSuccess('Font uploaded.');
      setPendingFile(null);
      setDisplayName('');
    },
    onError: () => {
      toastError('Failed to upload font. Check the format (woff2/woff/ttf/otf) and size (max 50 MB).');
    },
  });

  const deleteFont = useMutation({
    mutationFn: (id: string) => adminApi.deleteFont(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-fonts'] });
      toastSuccess('Font deleted.');
    },
    onError: () => {
      toastError('Failed to delete font. Please try again.');
    },
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        Failed to load custom fonts.
      </div>
    );
  }

  const fonts: CustomFont[] = data ?? [];

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Upload a font</h2>
      <DropZone
        onFiles={(files) => setPendingFile(files[0] ?? null)}
        multiple={false}
        accept=".woff2,.woff,.ttf,.otf"
        label={pendingFile ? pendingFile.name : 'Drag & drop a font file here'}
        hint="woff2, woff, ttf, or otf — max 50 MB"
      />
      <div className={styles.serviceRow}>
        <input
          type="text"
          className={styles.roleSelect}
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <button
          className={styles.pageBtn}
          type="button"
          disabled={!pendingFile || !displayName.trim() || uploadFont.isPending}
          onClick={() => uploadFont.mutate()}
        >
          Upload
        </button>
      </div>

      <h2 className={styles.sectionTitle}>Custom Fonts</h2>
      {fonts.length === 0 ? (
        <div className={styles.empty}>No custom fonts uploaded yet.</div>
      ) : (
        <div className={styles.serviceList}>
          {fonts.map((font) => (
            <div key={font.id} className={styles.serviceRow}>
              <div className={styles.serviceInfo}>
                <span className={styles.serviceName}>{font.displayName}</span>
                <span className={styles.serviceMeta}>
                  {font.format} &middot; uploaded {new Date(font.createdAt).toLocaleDateString()}
                </span>
              </div>
              <button
                className={styles.deleteBtn}
                type="button"
                disabled={deleteFont.isPending}
                onClick={() => deleteFont.mutate(font.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The retention policy for file version history.
 *
 * The two numbers are one rule, not two independent settings, so they are
 * edited and saved together: the age window only decides among the versions
 * the floor has not already protected. The form is uncontrolled-until-loaded
 * (a `null` draft) rather than seeded with defaults, so an admin never sees
 * plausible-looking numbers that are not the ones being enforced.
 */
function VersionsTab() {
  const qc = useQueryClient();
  const { error: toastError, success: toastSuccess } = useToast();
  const [draft, setDraft] = useState<VersionRetentionSettings | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-version-retention'],
    queryFn: () => adminApi.getVersionRetention(),
  });

  // The server's answer is the starting point for editing, and re-reading it
  // after a save is what discards a draft the server clamped or rejected.
  const settings = draft ?? data ?? null;

  const save = useMutation({
    mutationFn: (next: VersionRetentionSettings) =>
      adminApi.updateVersionRetention({
        enabled: next.enabled,
        retentionDays: next.retentionDays,
        minVersions: next.minVersions,
      }),
    onSuccess: (saved) => {
      setDraft(null);
      qc.setQueryData(['admin-version-retention'], saved);
      toastSuccess('Retention policy saved.');
    },
    onError: () => {
      toastError('Failed to save the retention policy. Please try again.');
    },
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className={styles.error}>
        Failed to load the version retention policy.
      </div>
    );
  }

  const dirty =
    draft !== null &&
    data !== undefined &&
    (draft.enabled !== data.enabled ||
      draft.retentionDays !== data.retentionDays ||
      draft.minVersions !== data.minVersions);

  const patch = (changes: Partial<VersionRetentionSettings>) =>
    setDraft({ ...settings, ...changes });

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>File Version Retention</h2>
      <p className={styles.settingIntro}>
        Every version of a file is a full copy in that file&apos;s folder, current content
        included. The background worker prunes the history hourly: versions older than the
        age below are deleted, but the newest few are always kept, however old they are. A
        file&apos;s current version and any version someone named are never deleted.
      </p>

      <div className={styles.serviceList}>
        <div className={styles.serviceRow}>
          <div className={styles.serviceInfo}>
            <span className={styles.serviceName}>Prune old versions</span>
            <span className={styles.serviceMeta}>
              Off keeps every version of every file forever.
            </span>
          </div>
          <div className={styles.serviceControls}>
            <span className={styles.serviceLabel}>
              {settings.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <Toggle
              checked={settings.enabled}
              disabled={save.isPending}
              aria-label="Toggle version pruning"
              onChange={() => patch({ enabled: !settings.enabled })}
            />
          </div>
        </div>

        <div className={styles.serviceRow}>
          <div className={styles.serviceInfo}>
            <span className={styles.serviceName}>Keep versions for</span>
            <span className={styles.serviceMeta}>
              Days before a version becomes eligible for deletion.
            </span>
          </div>
          <div className={styles.serviceControls}>
            <input
              type="number"
              min={0}
              max={36500}
              className={styles.numberInput}
              value={settings.retentionDays}
              disabled={!settings.enabled || save.isPending}
              aria-label="Days to keep versions"
              onChange={(e) =>
                patch({ retentionDays: Math.max(0, Number(e.target.value) || 0) })
              }
            />
            <span className={styles.serviceLabel}>days</span>
          </div>
        </div>

        <div className={styles.serviceRow}>
          <div className={styles.serviceInfo}>
            <span className={styles.serviceName}>Always keep at least</span>
            <span className={styles.serviceMeta}>
              The newest versions of each file, kept regardless of age.
            </span>
          </div>
          <div className={styles.serviceControls}>
            <input
              type="number"
              min={0}
              max={1000}
              className={styles.numberInput}
              value={settings.minVersions}
              disabled={!settings.enabled || save.isPending}
              aria-label="Minimum versions to keep"
              onChange={(e) =>
                patch({ minVersions: Math.max(0, Number(e.target.value) || 0) })
              }
            />
            <span className={styles.serviceLabel}>versions</span>
          </div>
        </div>
      </div>

      <div className={styles.formActions}>
        <span className={styles.pageInfo}>
          Last changed {new Date(settings.updatedAt).toLocaleString()}
        </span>
        <button
          className={styles.pageBtn}
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(settings)}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function JobsTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-jobs'],
    queryFn: () => adminApi.listJobs(),
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        Failed to load jobs. You may not have admin permissions.
      </div>
    );
  }

  const jobs: JobResponse[] = data ?? [];

  if (jobs.length === 0) {
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Jobs</h2>
        <div className={styles.empty}>No jobs found.</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>
        Jobs <span className={styles.userCount}>({jobs.length})</span>
      </h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Worker</th>
              <th>Timeout</th>
              <th>Created</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.id}</td>
                <td>{job.jobType}</td>
                <td>
                  <span className={jobStatusClass(job.status)}>
                    {jobStatusLabel(job.status)}
                  </span>
                </td>
                <td>{job.workerId ?? '—'}</td>
                <td>{job.timeoutSecs}s</td>
                <td>{new Date(job.createdAt).toLocaleString()}</td>
                <td>{job.errorMessage ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab =
  | 'processes'
  | 'disk'
  | 'services'
  | 'users'
  | 'queue'
  | 'flags'
  | 'versions'
  | 'fonts'
  | 'jobs';

const TABS: { id: Tab; label: string }[] = [
  { id: 'processes', label: 'Processes' },
  { id: 'disk', label: 'Disk Space' },
  { id: 'services', label: 'Services' },
  // The password rules are a section inside Users rather than a tab of their
  // own: they are the rules the accounts in that table are held to, and an
  // admin tightening one usually wants to see who it lands on.
  { id: 'users', label: 'Users' },
  // Next to Users, because it is the queue of things users have asked for and
  // acting on one lands back in that tab's data.
  { id: 'queue', label: 'Work Queue' },
  { id: 'flags', label: 'Feature Flags' },
  { id: 'versions', label: 'Versions' },
  { id: 'fonts', label: 'Fonts' },
  { id: 'jobs', label: 'Jobs' },
];

export default function AdminPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('processes');

  // Guard: redirect non-admins
  if (!authLoading && !user?.isAdmin) {
    router.replace('/drive');
    return (
      <div className={styles.loading}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.back()} type="button">
          <ArrowLeft size={16} />
          Back
        </button>
        <h1 className={styles.heading}>Admin</h1>

        {/* ── Tab bar ─────────────────────────────────────────────────── */}
        <div className={styles.tabBar}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`${styles.tabBtn} ${activeTab === tab.id ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────────────────── */}
      <div className={styles.content}>
        {activeTab === 'processes' && <ProcessesTab />}
        {activeTab === 'disk' && <DiskTab />}
        {activeTab === 'services' && <ServicesTab />}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'queue' && <WorkQueueTab />}
        {activeTab === 'flags' && <FeatureFlagsTab />}
        {activeTab === 'versions' && <VersionsTab />}
        {activeTab === 'fonts' && <FontsTab />}
        {activeTab === 'jobs' && <JobsTab />}
      </div>
    </div>
  );
}
