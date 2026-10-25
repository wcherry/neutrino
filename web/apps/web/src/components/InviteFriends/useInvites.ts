'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invitesApi, inviteUrl, type Invite, type PersonalInviteLink } from '@neutrino/auth';

export const INVITES_KEY = ['invites'] as const;
export const INVITE_LINK_KEY = ['invites', 'link'] as const;

export interface UseInvitesResult {
  link: PersonalInviteLink | undefined;
  /** The sign-up link on this page's origin, built from the link's token. */
  linkUrl: string | undefined;
  invites: Invite[] | undefined;
  isLoading: boolean;
  send(emails: string[], note?: string): Promise<Invite[]>;
  sending: boolean;
  revoke(id: string): Promise<void>;
  resetLink(): Promise<void>;
}

/**
 * The signed-in user's personal invite link and the invites they have sent,
 * with the three things they can do about them. Needs a `QueryClientProvider`.
 */
export function useInvites(opts: { enabled?: boolean } = {}): UseInvitesResult {
  const enabled = opts.enabled ?? true;
  const qc = useQueryClient();

  const linkQuery = useQuery({
    queryKey: INVITE_LINK_KEY,
    queryFn: () => invitesApi.getLink(),
    enabled,
  });
  const listQuery = useQuery({
    queryKey: INVITES_KEY,
    queryFn: () => invitesApi.list(),
    enabled,
  });

  // `['invites']` is a prefix of the link's key, so this refreshes both.
  const invalidate = () => qc.invalidateQueries({ queryKey: INVITES_KEY });

  const sendMutation = useMutation({
    mutationFn: ({ emails, note }: { emails: string[]; note?: string }) =>
      invitesApi.send(note ? { emails, note } : { emails }),
    onSuccess: invalidate,
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => invitesApi.revoke(id),
    onSuccess: invalidate,
  });
  const resetMutation = useMutation({
    mutationFn: () => invitesApi.resetLink(),
    onSuccess: (fresh) => {
      qc.setQueryData(INVITE_LINK_KEY, fresh);
      return invalidate();
    },
  });

  const link = linkQuery.data;
  return {
    link,
    linkUrl: link ? inviteUrl(link.token) : undefined,
    invites: listQuery.data,
    isLoading: linkQuery.isLoading || listQuery.isLoading,
    send: (emails, note) => sendMutation.mutateAsync({ emails, note }),
    sending: sendMutation.isPending,
    revoke: (id) => revokeMutation.mutateAsync(id),
    resetLink: async () => {
      await resetMutation.mutateAsync();
    },
  };
}
