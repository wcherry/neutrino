import { request } from '@neutrino/api-core';

// ---------------------------------------------------------------------------
// Friend invites (onboarding phase 5)
// ---------------------------------------------------------------------------

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

/** One emailed invite the signed-in user has sent. Timestamps are RFC 3339 UTC. */
export interface Invite {
  id: string;
  email: string;
  status: InviteStatus;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

/** The signed-in user's reusable sign-up link. */
export interface PersonalInviteLink {
  token: string;
  /** Built by the server from its configured base URL; the web uses `inviteUrl(token)` instead. */
  url: string;
  expiresAt: string;
  useCount: number;
}

/** What `/register?invite=…` learns about a token before sign-up. */
export interface InviteValidation {
  kind: 'email' | 'link';
  inviterName: string;
  /** The invited address for an emailed invite; `null` for a personal link. */
  email: string | null;
  expiresAt: string;
}

export interface SendInvitesRequest {
  emails: string[];
  note?: string;
}

interface InvitesEnvelope {
  invites: Invite[];
}

export const invitesApi = {
  getLink(): Promise<PersonalInviteLink> {
    return request<PersonalInviteLink>('/api/v1/invites/link');
  },

  /** Retire the current personal link and mint a new one. */
  resetLink(): Promise<PersonalInviteLink> {
    return request<PersonalInviteLink>('/api/v1/invites/link/reset', { method: 'POST' });
  },

  async list(): Promise<Invite[]> {
    const { invites } = await request<InvitesEnvelope>('/api/v1/invites');
    return invites;
  },

  async send(body: SendInvitesRequest): Promise<Invite[]> {
    const { invites } = await request<InvitesEnvelope>('/api/v1/invites', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return invites;
  },

  revoke(id: string): Promise<void> {
    return request<void>(`/api/v1/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /** Unauthenticated: who sent this token and, for an emailed invite, to which address. */
  validate(token: string): Promise<InviteValidation> {
    return request<InviteValidation>('/api/v1/invites/validate', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },
};

/** The sign-up link for an invite token, on this page's origin unless one is given. */
export function inviteUrl(token: string, origin?: string): string {
  const base = origin ?? window.location.origin;
  return `${base}/register?invite=${encodeURIComponent(token)}`;
}
