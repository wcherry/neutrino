'use client';

/**
 * The three forms the Users tab opens: create an account, set its storage
 * limits, and reset its password.
 *
 * They live here rather than in `page.tsx` because each is a small stateful
 * form with its own validation, and the users table is long enough already.
 * None of them fetch on mount except the quota editor, which has to read the
 * current limits before it can offer to replace them — a PUT that replaces both
 * fields cannot be built from a form seeded with guesses.
 */

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, ModalBody, ModalFooter, ModalHeader, Spinner, useToast } from '@neutrino/ui';
import { adminApi } from '@neutrino/api-admin';
import { ApiClientError } from '@neutrino/api-core';
import type { AdminUser } from '@neutrino/api-admin';
import { bytesToGigabytes, formatBytes, formatLimit, gigabytesToBytes } from './bytes';
import styles from './page.module.css';

/**
 * What the server said, when it said something worth repeating.
 *
 * The password rules and the quota bounds are enforced server-side and their
 * messages already name the rule that was broken ("Password must be at least 14
 * characters"), so showing them beats replacing them with a generic failure —
 * the whole point of a policy is that the person setting a password learns what
 * it is.
 */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiClientError && err.message) return err.message;
  return fallback;
}

// ---------------------------------------------------------------------------
// Create user
// ---------------------------------------------------------------------------

export function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { success: toastSuccess } = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  // On by default: the admin typed this password, so they know it. Leaving it
  // as the account's lasting password means two people know it.
  const [requireChange, setRequireChange] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail('');
    setName('');
    setPassword('');
    setRole('user');
    setRequireChange(true);
    setError(null);
  }

  const create = useMutation({
    mutationFn: () =>
      adminApi.createUser({
        email: email.trim(),
        name: name.trim(),
        password,
        role,
        requirePasswordChange: requireChange,
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toastSuccess(`${created.name} created.`);
      reset();
      onClose();
    },
    onError: (err) => {
      setError(errorMessage(err, 'Could not create the account. Please try again.'));
    },
  });

  const ready = email.trim() !== '' && name.trim() !== '' && password !== '';

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      size="sm"
    >
      <ModalHeader>New user</ModalHeader>
      <ModalBody>
        <form
          className={styles.dialogForm}
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <div className={styles.formField}>
            <label className={styles.formLabel} htmlFor="new-user-name">
              Name
            </label>
            <input
              id="new-user-name"
              className={styles.formInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={create.isPending}
              autoComplete="off"
            />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel} htmlFor="new-user-email">
              Email
            </label>
            <input
              id="new-user-email"
              type="email"
              className={styles.formInput}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={create.isPending}
              autoComplete="off"
            />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel} htmlFor="new-user-password">
              Password
            </label>
            <input
              id="new-user-password"
              type="password"
              className={styles.formInput}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={create.isPending}
              autoComplete="new-password"
            />
            <p className={styles.formHint}>
              Checked against the workspace password policy. Give it to the new user over a
              channel they can read and you can forget.
            </p>
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel} htmlFor="new-user-role">
              Role
            </label>
            <select
              id="new-user-role"
              className={styles.formInput}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={create.isPending}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={requireChange}
              onChange={(e) => setRequireChange(e.target.checked)}
              disabled={create.isPending}
            />
            <span>
              Require a password change at first sign-in — the password above stops working as
              soon as they set their own.
            </span>
          </label>
          {error && <p className={styles.formError}>{error}</p>}
        </form>
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={() => {
            reset();
            onClose();
          }}
          disabled={create.isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={!ready || create.isPending}
          onClick={() => {
            setError(null);
            create.mutate();
          }}
        >
          {create.isPending ? 'Creating…' : 'Create user'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Storage quota
// ---------------------------------------------------------------------------

export function UserQuotaDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { success: toastSuccess } = useToast();
  // `null` until the current quota arrives: the form replaces both limits, so
  // it must not open on placeholder numbers an admin could save by accident.
  const [draft, setDraft] = useState<{ quota: string; daily: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-user-quota', user?.id],
    queryFn: () => adminApi.getUserQuota(user!.id),
    enabled: !!user,
  });

  // Seeded from the server's answer rather than in an effect, so the first
  // render after the fetch already shows the real numbers.
  const form =
    draft ??
    (data
      ? {
          quota: bytesToGigabytes(data.quotaBytes),
          daily: bytesToGigabytes(data.dailyCapBytes),
        }
      : null);

  const save = useMutation({
    mutationFn: () =>
      adminApi.setUserQuota(user!.id, {
        quotaBytes: gigabytesToBytes(form!.quota),
        dailyCapBytes: gigabytesToBytes(form!.daily),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(['admin-user-quota', user!.id], saved);
      qc.invalidateQueries({ queryKey: ['admin-user-quotas'] });
      toastSuccess('Storage limits saved.');
      setDraft(null);
      onClose();
    },
    onError: (err) => setError(errorMessage(err, 'Could not save the limits. Please try again.')),
  });

  function close() {
    setDraft(null);
    setError(null);
    onClose();
  }

  return (
    <Modal open={!!user} onClose={close} size="sm">
      <ModalHeader>Storage for {user?.name}</ModalHeader>
      <ModalBody>
        {isLoading || !form || !data ? (
          <div className={styles.loading}>
            <Spinner size="md" />
          </div>
        ) : (
          <div className={styles.dialogForm}>
            <p className={styles.formHint}>
              Using <strong>{formatBytes(data.usedBytes)}</strong> of{' '}
              <strong>{formatLimit(data.quotaBytes)}</strong>. Leave a field empty for no limit.
            </p>
            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="quota-limit">
                Storage limit (GB)
              </label>
              <input
                id="quota-limit"
                type="number"
                min={0}
                step="0.1"
                className={styles.formInput}
                value={form.quota}
                placeholder="Unlimited"
                disabled={save.isPending}
                onChange={(e) => setDraft({ ...form, quota: e.target.value })}
              />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="quota-daily">
                Daily upload cap (GB)
              </label>
              <input
                id="quota-daily"
                type="number"
                min={0}
                step="0.1"
                className={styles.formInput}
                value={form.daily}
                placeholder="Unlimited"
                disabled={save.isPending}
                onChange={(e) => setDraft({ ...form, daily: e.target.value })}
              />
              <p className={styles.formHint}>
                How much they may upload in a day. Separate from the limit above, and reset
                daily.
              </p>
            </div>
            {/* A limit under what they already store is legitimate — it stops
                further uploads without deleting anything — but it is worth
                saying out loud before it is saved. */}
            {gigabytesToBytes(form.quota) !== null &&
              gigabytesToBytes(form.quota)! < data.usedBytes && (
                <p className={styles.formHint}>
                  This is below the {formatBytes(data.usedBytes)} they already store. Nothing is
                  deleted, but they cannot upload again until they are back under the limit.
                </p>
              )}
            {error && <p className={styles.formError}>{error}</p>}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button type="button" className={styles.cancelBtn} onClick={close} disabled={save.isPending}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={!form || save.isPending}
          onClick={() => {
            setError(null);
            save.mutate();
          }}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: AdminUser | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { success: toastSuccess } = useToast();
  const [password, setPassword] = useState('');
  const [requireChange, setRequireChange] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reset = useMutation({
    mutationFn: () =>
      adminApi.updateUser(user!.id, { password, expirePassword: requireChange }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toastSuccess('Password reset. Every session has been signed out.');
      close();
    },
    onError: (err) => setError(errorMessage(err, 'Could not reset the password.')),
  });

  function close() {
    setPassword('');
    setRequireChange(true);
    setError(null);
    onClose();
  }

  return (
    <Modal open={!!user} onClose={close} size="sm">
      <ModalHeader>Reset password for {user?.name}</ModalHeader>
      <ModalBody>
        <div className={styles.dialogForm}>
          <p className={styles.formHint}>
            This signs {user?.name} out everywhere. Send them the new password over a channel
            they can read and you can forget.
          </p>
          <div className={styles.formField}>
            <label className={styles.formLabel} htmlFor="reset-password">
              New password
            </label>
            <input
              id="reset-password"
              type="password"
              className={styles.formInput}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={reset.isPending}
              autoComplete="new-password"
            />
          </div>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={requireChange}
              onChange={(e) => setRequireChange(e.target.checked)}
              disabled={reset.isPending}
            />
            <span>Require a change at next sign-in, so this password is only ever temporary.</span>
          </label>
          {error && <p className={styles.formError}>{error}</p>}
        </div>
      </ModalBody>
      <ModalFooter>
        <button type="button" className={styles.cancelBtn} onClick={close} disabled={reset.isPending}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={password === '' || reset.isPending}
          onClick={() => {
            setError(null);
            reset.mutate();
          }}
        >
          {reset.isPending ? 'Resetting…' : 'Reset password'}
        </button>
      </ModalFooter>
    </Modal>
  );
}
