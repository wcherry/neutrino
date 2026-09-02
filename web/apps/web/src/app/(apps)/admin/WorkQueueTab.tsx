'use client';

/**
 * The work queue — things a person has asked an admin for and is waiting on.
 *
 * Today that is storage-increase requests (issue #144) and nothing else, but
 * the tab is named for the shape rather than the contents: the queue is where
 * anything needing a human decision belongs, and a second kind of request
 * should join this table rather than earning a tab of its own.
 *
 * Pending is the default view because pending is the only part that is work.
 */

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, ModalBody, ModalFooter, ModalHeader, Spinner, useToast } from '@neutrino/ui';
import { adminApi } from '@neutrino/api-admin';
import { ApiClientError } from '@neutrino/api-core';
import type { QuotaRequest, QuotaRequestStatus } from '@neutrino/api-admin';
import { bytesToGigabytes, formatBytes, gigabytesToBytes } from './bytes';
import styles from './page.module.css';

type Filter = QuotaRequestStatus | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'denied', label: 'Denied' },
  { id: 'all', label: 'All' },
];

function statusClass(status: QuotaRequestStatus): string {
  if (status === 'approved') return styles.statusApproved;
  if (status === 'denied') return styles.statusDenied;
  return styles.statusPending;
}

/**
 * A request being decided, and how.
 *
 * Approve and Deny share one dialog because they share the note, and because an
 * admin reading a request has not necessarily decided which button they are
 * about to press.
 */
type Decision = { request: QuotaRequest; action: 'approve' | 'deny' };

export function WorkQueueTab() {
  const [filter, setFilter] = useState<Filter>('pending');
  const [deciding, setDeciding] = useState<Decision | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-quota-requests', filter],
    queryFn: () => adminApi.listQuotaRequests(filter),
    // Someone else's browser is filling this queue, so it goes stale on its own.
    refetchInterval: 60_000,
  });

  const pendingCount = useQuery({
    queryKey: ['admin-quota-requests', 'pending'],
    queryFn: () => adminApi.listQuotaRequests('pending'),
    refetchInterval: 60_000,
  }).data?.length;

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return <div className={styles.error}>Failed to load the work queue.</div>;
  }

  const requests: QuotaRequest[] = data ?? [];

  const filterRow = (
    <div className={styles.queueFilter}>
      <span>Show</span>
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`${styles.tabBtn} ${filter === f.id ? styles.tabBtnActive : ''}`}
          onClick={() => setFilter(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`${styles.section} ${styles.sectionWide}`}>
      <h2 className={styles.sectionTitle}>
        Work Queue{' '}
        {pendingCount !== undefined && (
          <span className={styles.userCount}>({pendingCount} pending)</span>
        )}
      </h2>
      <p className={styles.settingIntro}>
        Storage increases users have asked for from their storage meter. Approving one sets that
        user&apos;s limit to what you grant — you can grant less than was asked for. Denying
        leaves their limit exactly as it is.
      </p>
      {filterRow}

      {requests.length === 0 ? (
        <div className={styles.empty}>
          {filter === 'pending' ? 'Nothing waiting for you.' : 'No requests to show.'}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Requested by</th>
                <th>Asked for</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Filed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr key={req.id}>
                  <td>
                    <span className={styles.queueEmphasis}>{req.userName ?? req.userId}</span>
                    <br />
                    <span className={styles.serviceMeta}>{req.userEmail}</span>
                  </td>
                  <td>
                    {formatBytes(req.requestedBytes)}
                    {req.grantedBytes !== null && req.grantedBytes !== req.requestedBytes && (
                      <>
                        <br />
                        <span className={styles.serviceMeta}>
                          granted {formatBytes(req.grantedBytes)}
                        </span>
                      </>
                    )}
                  </td>
                  <td className={styles.queueReason}>{req.reason ?? '—'}</td>
                  <td>
                    <span className={statusClass(req.status)}>{req.status}</span>
                    {req.decisionNote && (
                      <>
                        <br />
                        <span className={styles.serviceMeta}>{req.decisionNote}</span>
                      </>
                    )}
                  </td>
                  <td>{new Date(req.createdAt).toLocaleDateString()}</td>
                  <td>
                    {req.status === 'pending' ? (
                      <span className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.linkBtn}
                          onClick={() => setDeciding({ request: req, action: 'approve' })}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className={styles.deleteBtn}
                          onClick={() => setDeciding({ request: req, action: 'deny' })}
                        >
                          Deny
                        </button>
                      </span>
                    ) : (
                      <span className={styles.serviceMeta}>
                        {req.decidedAt ? new Date(req.decidedAt).toLocaleDateString() : '—'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DecisionDialog decision={deciding} onClose={() => setDeciding(null)} />
    </div>
  );
}

function DecisionDialog({
  decision,
  onClose,
}: {
  decision: Decision | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { success: toastSuccess } = useToast();
  const [granted, setGranted] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Seeded from the request rather than in an effect: the common case is
  // granting exactly what was asked for, so the field opens on that.
  const grantedGb =
    granted ?? (decision ? bytesToGigabytes(decision.request.requestedBytes) : '');

  const decide = useMutation({
    mutationFn: () => {
      const { request, action } = decision!;
      if (action === 'deny') {
        return adminApi.denyQuotaRequest(request.id, { note: note.trim() || undefined });
      }
      const bytes = gigabytesToBytes(grantedGb);
      return adminApi.approveQuotaRequest(request.id, {
        grantedBytes: bytes ?? request.requestedBytes,
        note: note.trim() || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-quota-requests'] });
      // The approval moved a quota, so any storage figure on screen is stale.
      qc.invalidateQueries({ queryKey: ['admin-user-quotas'] });
      toastSuccess(decision?.action === 'approve' ? 'Request approved.' : 'Request denied.');
      close();
    },
    onError: (err) => {
      setError(
        err instanceof ApiClientError && err.statusCode === 409
          ? 'Someone else has already decided this request.'
          : 'Could not record the decision. Please try again.',
      );
      qc.invalidateQueries({ queryKey: ['admin-quota-requests'] });
    },
  });

  function close() {
    setGranted(null);
    setNote('');
    setError(null);
    onClose();
  }

  const approving = decision?.action === 'approve';

  return (
    <Modal open={!!decision} onClose={close} size="sm">
      <ModalHeader>{approving ? 'Approve request' : 'Deny request'}</ModalHeader>
      <ModalBody>
        <div className={styles.dialogForm}>
          <p className={styles.formHint}>
            {decision?.request.userName} asked for{' '}
            <strong>{decision ? formatBytes(decision.request.requestedBytes) : ''}</strong>
            {decision?.request.reason ? ` — “${decision.request.reason}”` : '.'}
          </p>
          {approving && (
            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="granted-gb">
                Grant (GB)
              </label>
              <input
                id="granted-gb"
                type="number"
                min={0}
                step="0.1"
                className={styles.formInput}
                value={grantedGb}
                disabled={decide.isPending}
                onChange={(e) => setGranted(e.target.value)}
              />
              <p className={styles.formHint}>
                Becomes their new storage limit. Their daily upload cap is untouched.
              </p>
            </div>
          )}
          <div className={styles.formField}>
            <label className={styles.formLabel} htmlFor="decision-note">
              Note {approving ? '(optional)' : ''}
            </label>
            <input
              id="decision-note"
              className={styles.formInput}
              value={note}
              placeholder={approving ? 'Anything they should know' : 'Why not, in one line'}
              disabled={decide.isPending}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error && <p className={styles.formError}>{error}</p>}
        </div>
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={close}
          disabled={decide.isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className={approving ? styles.primaryBtn : styles.confirmBtn}
          disabled={decide.isPending}
          onClick={() => {
            setError(null);
            decide.mutate();
          }}
        >
          {decide.isPending ? 'Saving…' : approving ? 'Approve' : 'Deny'}
        </button>
      </ModalFooter>
    </Modal>
  );
}
