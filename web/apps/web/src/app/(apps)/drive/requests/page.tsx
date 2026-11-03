'use client';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@neutrino/auth';
import { Button, EmptyState, Heading, Text } from '@neutrino/ui';
import { Inbox } from 'lucide-react';
import { accessRequestsApi, type AccessRequest } from '@/lib/api';
import { approveAccessRequest, describeAccessApproval } from '@/lib/accessRequests';
import styles from './page.module.css';

const REQUESTS_KEY = ['access-requests'] as const;

/** "view", "comment on", "edit": finishes "asked to … the file". */
function roleVerb(role: string): string {
  if (role === 'editor' || role === 'owner') return 'edit';
  if (role === 'commenter') return 'comment on';
  return 'view';
}

/**
 * Requests for access to the caller's files and folders, where the "is asking for access" email
 * and notification lead. Approving grants the role asked for and hands an encrypted file's key
 * over; declining tells the requester. Either takes the request off the list.
 */
export default function AccessRequestsPage() {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const userId = auth.user?.id;
  /** What became of each request answered on this visit, by id, so the row says so. */
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: REQUESTS_KEY,
    queryFn: () => accessRequestsApi.listPending(),
  });

  const answer = useMutation({
    mutationFn: async ({ request, approve }: { request: AccessRequest; approve: boolean }) => {
      if (!approve) {
        await accessRequestsApi.deny(request.id);
        return `Declined. ${request.requesterName} has been told.`;
      }
      return describeAccessApproval(await approveAccessRequest(request, userId), request.requesterName);
    },
    onSuccess: (outcome, { request }) => {
      setOutcomes((o) => ({ ...o, [request.id]: outcome }));
      setErrors(({ [request.id]: _, ...rest }) => rest);
    },
    onError: (err, { request }) => {
      setErrors((e) => ({ ...e, [request.id]: err instanceof Error ? err.message : 'Something went wrong' }));
    },
  });

  // Answered rows stay until the next visit, so the outcome can be read.
  const requests = data?.requests ?? [];
  const pending = requests.filter((r) => !outcomes[r.id]).length;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">Access requests</Heading>
        {!isLoading && !isError && (
          <Text size="sm" color="muted">{pending} waiting</Text>
        )}
      </div>

      {isError ? (
        <EmptyState title="Could not load requests" description="There was an error loading access requests." />
      ) : isLoading ? (
        <Text color="muted">Loading…</Text>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No requests"
          description="When someone asks for access to one of your files or folders, it appears here."
        />
      ) : (
        <ul className={styles.list}>
          {requests.map((r) => {
            const kind = r.resourceType === 'folder' ? 'folder' : 'file';
            const name = r.resourceName ? `the ${kind} “${r.resourceName}”` : `a ${kind}`;
            const busy = answer.isPending && answer.variables?.request.id === r.id;
            return (
              <li key={r.id} className={styles.row}>
                <div className={styles.what}>
                  <span className={styles.who}>
                    <strong>{r.requesterName}</strong> ({r.requesterEmail}) asked to {roleVerb(r.requestedRole)} {name}.
                  </span>
                  {r.message && <span className={styles.message}>“{r.message}”</span>}
                  {errors[r.id] && (
                    <span role="alert">
                      <Text size="sm" color="error">{errors[r.id]}</Text>
                    </span>
                  )}
                </div>
                {outcomes[r.id] ? (
                  <span className={styles.outcome} role="status">{outcomes[r.id]}</span>
                ) : (
                  <div className={styles.actions}>
                    <Button
                      size="sm"
                      onClick={() => answer.mutate({ request: r, approve: true })}
                      loading={busy && answer.variables?.approve === true}
                      disabled={busy}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => answer.mutate({ request: r, approve: false })}
                      loading={busy && answer.variables?.approve === false}
                      disabled={busy}
                    >
                      Decline
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {Object.keys(outcomes).length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => {
          setOutcomes({});
          void queryClient.invalidateQueries({ queryKey: REQUESTS_KEY });
        }}>
          Clear answered requests
        </Button>
      )}
    </div>
  );
}
