'use client';

/**
 * Cleaning up after a scripted sign-up wave.
 *
 * The top half answers "where did these accounts come from?": the busiest
 * sign-up IPs and email domains in a window, each with how many never verified
 * their address. Clicking a row fills the filter below with it.
 *
 * The bottom half soft-deletes every account a filter matches. It is always two
 * steps — Preview runs the server's dry run and shows the count and a sample,
 * and only then does Delete become available, for exactly the filter that was
 * previewed. Admins and the caller are never matched, verified accounts only
 * when asked, and a deleted account can be restored from Users until it is
 * purged, like any other soft deletion. Rate limits and CAPTCHA are configured
 * on the server (`SIGNUP_*`, `TURNSTILE_*`), not here.
 */

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Spinner, useToast } from '@neutrino/ui';
import { ApiClientError } from '@neutrino/api-core';
import { signupsApi, toServerTimestamp } from '@neutrino/api-admin';
import type {
  BulkDeleteUsersRequest,
  BulkDeleteUsersResponse,
  SignupGroup,
} from '@neutrino/api-admin';
import styles from './page.module.css';

const WINDOWS = [
  { hours: 1, label: 'Last hour' },
  { hours: 24, label: 'Last 24 hours' },
  { hours: 24 * 7, label: 'Last 7 days' },
  { hours: 24 * 30, label: 'Last 30 days' },
];

interface FilterForm {
  ip: string;
  emailDomain: string;
  createdAfter: string; // datetime-local, viewer's zone
  createdBefore: string;
  includeVerified: boolean;
}

const EMPTY: FilterForm = {
  ip: '',
  emailDomain: '',
  createdAfter: '',
  createdBefore: '',
  includeVerified: false,
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiClientError && err.message ? err.message : fallback;
}

/** The request body a form describes; undefined fields are left off. */
export function toRequest(form: FilterForm): BulkDeleteUsersRequest {
  const time = (v: string) => (v ? toServerTimestamp(new Date(v)) : undefined);
  return {
    ip: form.ip.trim() || undefined,
    emailDomain: form.emailDomain.trim().replace(/^@/, '') || undefined,
    createdAfter: time(form.createdAfter),
    createdBefore: time(form.createdBefore),
    includeVerified: form.includeVerified || undefined,
  };
}

function GroupTable({
  title,
  rows,
  onPick,
}: {
  title: string;
  rows: SignupGroup[];
  onPick: (key: string) => void;
}) {
  return (
    <div>
      <h3 className={styles.formLabel}>{title}</h3>
      {rows.length === 0 ? (
        <p className={styles.formHint}>Nothing in this window.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{title === 'By IP' ? 'IP' : 'Domain'}</th>
                <th>Accounts</th>
                <th>Unverified</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.key}</td>
                  <td>{row.total}</td>
                  <td>{row.unverified}</td>
                  <td>
                    <button type="button" className={styles.linkBtn} onClick={() => onPick(row.key)}>
                      Filter
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SignupsTab() {
  const [hours, setHours] = useState(24);
  const [form, setForm] = useState<FilterForm>(EMPTY);
  // The dry run, and the exact request it answered: Delete sends that request,
  // never whatever the form says now.
  const [preview, setPreview] = useState<{
    request: BulkDeleteUsersRequest;
    result: BulkDeleteUsersResponse;
  } | null>(null);
  const qc = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();

  const summary = useQuery({
    queryKey: ['admin', 'signups', hours],
    queryFn: () => signupsApi.summary(hours),
  });

  const update = (patch: Partial<FilterForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setPreview(null);
  };

  const previewMutation = useMutation({
    mutationFn: (request: BulkDeleteUsersRequest) =>
      signupsApi.bulkDelete({ ...request, dryRun: true }).then((result) => ({ request, result })),
    onSuccess: setPreview,
    onError: (err) => toastError(errorMessage(err, 'Could not preview the match.')),
  });

  const deleteMutation = useMutation({
    mutationFn: (request: BulkDeleteUsersRequest) =>
      signupsApi.bulkDelete({ ...request, dryRun: false }),
    onSuccess: (result) => {
      toastSuccess(`Deleted ${result.deleted} account${result.deleted === 1 ? '' : 's'}.`);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => toastError(errorMessage(err, 'Could not delete the accounts.')),
  });

  const request = toRequest(form);
  const hasFilter = Boolean(request.ip || request.emailDomain || request.createdAfter);

  return (
    <div className={styles.sectionWide}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Sign-ups</h2>
        <select
          className={styles.formInput}
          style={{ width: 'auto' }}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          aria-label="Window"
        >
          {WINDOWS.map((w) => (
            <option key={w.hours} value={w.hours}>
              {w.label}
            </option>
          ))}
        </select>
      </div>

      {summary.isLoading ? (
        <div className={styles.loading}>
          <Spinner />
        </div>
      ) : summary.isError || !summary.data ? (
        <div className={styles.error}>Failed to load sign-ups.</div>
      ) : (
        <>
          <p className={styles.formHint}>
            {summary.data.total} new account{summary.data.total === 1 ? '' : 's'},{' '}
            {summary.data.unverified} unverified. IPs are recorded for sign-ups from this release on.
          </p>
          <div className={styles.dialogForm}>
            <GroupTable title="By IP" rows={summary.data.byIp} onPick={(ip) => update({ ip })} />
            <GroupTable
              title="By email domain"
              rows={summary.data.byDomain}
              onPick={(emailDomain) => update({ emailDomain })}
            />
          </div>
        </>
      )}

      <h2 className={styles.sectionTitle} style={{ marginTop: 24 }}>
        Delete accounts in bulk
      </h2>
      <form
        className={styles.dialogForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (hasFilter) previewMutation.mutate(request);
        }}
      >
        <label className={styles.formField}>
          <span className={styles.formLabel}>Sign-up IP</span>
          <input
            className={styles.formInput}
            value={form.ip}
            onChange={(e) => update({ ip: e.target.value })}
            placeholder="203.0.113.7"
          />
        </label>
        <label className={styles.formField}>
          <span className={styles.formLabel}>Email domain</span>
          <input
            className={styles.formInput}
            value={form.emailDomain}
            onChange={(e) => update({ emailDomain: e.target.value })}
            placeholder="example.com"
          />
        </label>
        <label className={styles.formField}>
          <span className={styles.formLabel}>Created after</span>
          <input
            type="datetime-local"
            className={styles.formInput}
            value={form.createdAfter}
            onChange={(e) => update({ createdAfter: e.target.value })}
          />
        </label>
        <label className={styles.formField}>
          <span className={styles.formLabel}>Created before</span>
          <input
            type="datetime-local"
            className={styles.formInput}
            value={form.createdBefore}
            onChange={(e) => update({ createdBefore: e.target.value })}
          />
        </label>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={form.includeVerified}
            onChange={(e) => update({ includeVerified: e.target.checked })}
          />
          <span>Include accounts that verified their email (a bot rarely does; a real person often has)</span>
        </label>
        <p className={styles.formHint}>
          Give at least an IP, a domain or a start time. Admin accounts and your own are never deleted.
        </p>
        <div className={styles.formActions}>
          <button
            type="submit"
            className={styles.primaryBtn}
            disabled={!hasFilter || previewMutation.isPending}
          >
            {previewMutation.isPending ? 'Checking…' : 'Preview'}
          </button>
        </div>
      </form>

      {preview && (
        <div className={styles.dialogForm} style={{ marginTop: 16 }}>
          <p className={styles.formHint}>
            <strong>{preview.result.matched}</strong> account
            {preview.result.matched === 1 ? '' : 's'} match
            {preview.result.matched > preview.result.sample.length
              ? ` (showing the newest ${preview.result.sample.length})`
              : ''}
            .
          </p>
          {preview.result.sample.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Created (UTC)</th>
                    <th>Verified</th>
                    <th>Sign-up IP</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.result.sample.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td>{u.name}</td>
                      <td>{u.createdAt.replace('T', ' ').slice(0, 19)}</td>
                      <td>{u.emailVerified ? 'Yes' : 'No'}</td>
                      <td>{u.signupIp ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.result.matched > 0 && (
            <div className={styles.formActions}>
              <button
                type="button"
                className={styles.deleteBtn}
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(preview.request)}
              >
                {deleteMutation.isPending
                  ? 'Deleting…'
                  : `Delete ${preview.result.matched} account${preview.result.matched === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
