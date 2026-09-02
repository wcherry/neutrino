'use client';

/**
 * "Request Additional" on the sidebar's storage meter (issue #144).
 *
 * The ask is a new *total* limit rather than an increment, because that is what
 * the admin will set and what the queue has to show them; the field is
 * pre-filled with double what they have now, which is the answer nine times out
 * of ten and saves the arithmetic.
 *
 * Nothing here changes the quota. The request lands in the admin console's work
 * queue and stays pending until someone acts on it, which is why an outstanding
 * request replaces the form rather than letting a second one be filed.
 */

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, ModalBody, ModalFooter, ModalHeader, Spinner, useToast } from '@neutrino/ui';
import { ApiClientError } from '@neutrino/api-core';
import { storageApi } from '@/lib/api';
import type { QuotaInfo } from '@/lib/api';

const GB = 1024 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(2)} GB`;
}

export interface RequestStorageDialogProps {
  open: boolean;
  onClose: () => void;
  /** The quota the shell has already loaded, so the dialog opens with numbers. */
  quota?: QuotaInfo | null;
}

export function RequestStorageDialog({ open, onClose, quota }: RequestStorageDialogProps) {
  const qc = useQueryClient();
  const { success: toastSuccess } = useToast();
  const [requested, setRequested] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Only fetched while the dialog is open: an outstanding request is the one
  // thing that changes what this dialog should say, and nothing else needs it.
  const mine = useQuery({
    queryKey: ['my-quota-requests'],
    queryFn: () => storageApi.listQuotaRequests(),
    enabled: open,
  });

  const pending = (mine.data ?? []).find((r) => r.status === 'pending');
  const lastDecided = (mine.data ?? []).find((r) => r.status !== 'pending');

  // Double what they have, or 10 GB where there is no limit to double.
  const suggested = quota?.quotaBytes ? (quota.quotaBytes * 2) / GB : 10;
  const value = requested ?? String(Number(suggested.toFixed(2)));

  const submit = useMutation({
    mutationFn: () => {
      const gb = Number(value);
      return storageApi.requestQuotaIncrease(Math.round(gb * GB), reason.trim() || undefined);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-quota-requests'] });
      toastSuccess('Request sent. An administrator will review it.');
      close();
    },
    onError: (err) => {
      setError(
        err instanceof ApiClientError && err.message
          ? err.message
          : 'Could not send the request. Please try again.',
      );
    },
  });

  function close() {
    setRequested(null);
    setReason('');
    setError(null);
    onClose();
  }

  const gb = Number(value);
  const valid = Number.isFinite(gb) && gb > 0;

  return (
    <Modal open={open} onClose={close} size="sm">
      <ModalHeader>Request more storage</ModalHeader>
      <ModalBody>
        {mine.isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <Spinner size="md" />
          </div>
        ) : pending ? (
          // A second ask while the first is unanswered is the same ask sent
          // twice; the server refuses it, so the dialog does not offer it.
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
            You have already asked for <strong>{formatBytes(pending.requestedBytes)}</strong>. An
            administrator has not answered yet — you will see the new limit here as soon as they
            do.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
              {quota ? (
                <>
                  You are using <strong>{formatBytes(quota.usedBytes)}</strong> of{' '}
                  <strong>
                    {quota.quotaBytes === null ? 'an unlimited quota' : formatBytes(quota.quotaBytes)}
                  </strong>
                  .{' '}
                </>
              ) : null}
              Ask an administrator for a new limit. Nothing changes until they approve it.
            </p>
            {lastDecided?.decisionNote && (
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, opacity: 0.75 }}>
                Last time: “{lastDecided.decisionNote}”
              </p>
            )}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>New limit (GB)</span>
              <input
                type="number"
                min={0}
                step="0.5"
                value={value}
                disabled={submit.isPending}
                onChange={(e) => setRequested(e.target.value)}
                style={{ fontSize: 13, padding: '7px 10px', borderRadius: 6 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Why (optional)</span>
              <input
                type="text"
                value={reason}
                placeholder="What you need the room for"
                disabled={submit.isPending}
                onChange={(e) => setReason(e.target.value)}
                style={{ fontSize: 13, padding: '7px 10px', borderRadius: 6 }}
              />
            </label>
            {error && <p style={{ margin: 0, fontSize: 12, color: '#b91c1c' }}>{error}</p>}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={close} disabled={submit.isPending}>
          {pending ? 'Close' : 'Cancel'}
        </button>
        {!pending && !mine.isLoading && (
          <button
            type="button"
            disabled={!valid || submit.isPending}
            onClick={() => {
              setError(null);
              submit.mutate();
            }}
          >
            {submit.isPending ? 'Sending…' : 'Send request'}
          </button>
        )}
      </ModalFooter>
    </Modal>
  );
}
