/**
 * The Invite friends panel: the personal link (copy, share, reset), the email
 * chips and the "Send N invites" button that counts them, sending and its
 * outcome, and the list of invites already sent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Matcher types (toBeInTheDocument, …): the setup file loads them at runtime, but tsc never sees it.
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const getLink = vi.fn();
const resetLink = vi.fn();
const list = vi.fn();
const send = vi.fn();
const revoke = vi.fn();
vi.mock('@neutrino/auth', () => ({
  invitesApi: {
    getLink: (...a: unknown[]) => getLink(...a),
    resetLink: (...a: unknown[]) => resetLink(...a),
    list: (...a: unknown[]) => list(...a),
    send: (...a: unknown[]) => send(...a),
    revoke: (...a: unknown[]) => revoke(...a),
    validate: vi.fn(),
  },
  inviteUrl: (token: string) => `https://app.test/register?invite=${encodeURIComponent(token)}`,
}));

import { InviteFriendsPanel, type InviteFriendsPanelProps } from '@/components/InviteFriends';

const LINK_URL = 'https://app.test/register?invite=tok-abc';
const EMAIL_LABEL = 'Or send invitations by email';

function link(token = 'tok-abc') {
  return {
    token,
    url: `https://server.test/register?invite=${token}`,
    expiresAt: '2026-11-07T00:00:00Z',
    useCount: 0,
  };
}

function invite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    email: 'pat@example.com',
    status: 'pending',
    createdAt: '2026-10-24T10:00:00Z',
    expiresAt: '2026-11-07T10:00:00Z',
    acceptedAt: null,
    ...overrides,
  };
}

function renderPanel(props: InviteFriendsPanelProps = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <InviteFriendsPanel {...props} />
    </QueryClientProvider>,
  );
}

async function emailField() {
  return (await screen.findByLabelText(EMAIL_LABEL)) as HTMLInputElement;
}

function removeChip(address: string) {
  return screen.queryByRole('button', { name: `Remove ${address}` });
}

describe('InviteFriendsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLink.mockResolvedValue(link());
    resetLink.mockResolvedValue(link('tok-new'));
    list.mockResolvedValue([]);
    send.mockResolvedValue([]);
    revoke.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete (navigator as unknown as { share?: unknown }).share;
  });

  // ── the personal link ─────────────────────────────────────────────────────

  describe('personal link', () => {
    it('shows the invite link built from the token, read-only', async () => {
      renderPanel();

      const field = (await screen.findByLabelText('Invite link')) as HTMLInputElement;
      await waitFor(() => expect(field.value).toBe(LINK_URL));
      expect(field.readOnly).toBe(true);
    });

    it('copies the link to the clipboard and says Copied', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      renderPanel();
      const field = (await screen.findByLabelText('Invite link')) as HTMLInputElement;
      await waitFor(() => expect(field.value).toBe(LINK_URL));

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK_URL));
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });

    it('offers no Share… button when the browser has no share sheet', async () => {
      renderPanel();
      await screen.findByLabelText('Invite link');

      expect(screen.queryByRole('button', { name: 'Share…' })).not.toBeInTheDocument();
    });

    it('hands the link to the native share sheet when there is one', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
      renderPanel();
      const field = (await screen.findByLabelText('Invite link')) as HTMLInputElement;
      await waitFor(() => expect(field.value).toBe(LINK_URL));

      fireEvent.click(screen.getByRole('button', { name: 'Share…' }));

      expect(share).toHaveBeenCalledWith({ title: 'Join me on Neutrino', url: LINK_URL });
    });

    it('resets the link and shows the new one', async () => {
      getLink.mockResolvedValueOnce(link()).mockResolvedValue(link('tok-new'));
      renderPanel();
      const field = (await screen.findByLabelText('Invite link')) as HTMLInputElement;
      await waitFor(() => expect(field.value).toBe(LINK_URL));

      fireEvent.click(screen.getByRole('button', { name: 'Reset link' }));

      await waitFor(() => expect(resetLink).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect((screen.getByLabelText('Invite link') as HTMLInputElement).value).toBe(
          'https://app.test/register?invite=tok-new',
        ),
      );
    });
  });

  // ── email chips ───────────────────────────────────────────────────────────

  describe('email chips', () => {
    it('turns an address into a chip on Enter without sending', async () => {
      const user = userEvent.setup();
      renderPanel();
      const field = await emailField();

      await user.type(field, 'bob@example.com{Enter}');

      expect(removeChip('bob@example.com')).toBeInTheDocument();
      expect(field.value).toBe('');
      expect(send).not.toHaveBeenCalled();
    });

    it('turns an address into a chip on a comma', async () => {
      const user = userEvent.setup();
      renderPanel();
      const field = await emailField();

      await user.type(field, 'cat@example.com,');

      expect(removeChip('cat@example.com')).toBeInTheDocument();
      expect(field.value).toBe('');
    });

    it('turns an address into a chip on blur', async () => {
      const user = userEvent.setup();
      renderPanel();
      const field = await emailField();

      await user.type(field, 'dan@example.com');
      await user.tab();

      expect(removeChip('dan@example.com')).toBeInTheDocument();
    });

    it('splits a pasted list into one chip per address', async () => {
      const user = userEvent.setup();
      renderPanel();
      const field = await emailField();

      await user.click(field);
      await user.paste('ann@example.com, ben@example.com; cal@example.com');

      expect(removeChip('ann@example.com')).toBeInTheDocument();
      expect(removeChip('ben@example.com')).toBeInTheDocument();
      expect(removeChip('cal@example.com')).toBeInTheDocument();
    });

    it('lower-cases a chip and does not add the same address twice', async () => {
      const user = userEvent.setup();
      renderPanel();
      const field = await emailField();

      await user.type(field, 'Bob@Example.com{Enter}bob@example.com{Enter}');

      expect(screen.getAllByRole('button', { name: 'Remove bob@example.com' })).toHaveLength(1);
    });

    it('removes a chip with its remove button', async () => {
      const user = userEvent.setup();
      renderPanel();
      const field = await emailField();
      await user.type(field, 'bob@example.com{Enter}');

      await user.click(removeChip('bob@example.com')!);

      expect(removeChip('bob@example.com')).not.toBeInTheDocument();
    });

    it('keeps invalid text in the field with an inline error', async () => {
      const user = userEvent.setup();
      renderPanel();
      const field = await emailField();

      await user.type(field, 'nope{Enter}');

      expect(screen.getByText("nope doesn't look like an email address")).toBeInTheDocument();
      expect(field.value).toBe('nope');
      expect(removeChip('nope')).not.toBeInTheDocument();
    });
  });

  // ── the send button ───────────────────────────────────────────────────────

  describe('send button', () => {
    it('reads "Send invites" and is disabled with no addresses', async () => {
      renderPanel();
      await emailField();

      expect(screen.getByRole('button', { name: 'Send invites' })).toBeDisabled();
    });

    it('reads "Send 1 invite" with one chip', async () => {
      const user = userEvent.setup();
      renderPanel();
      await user.type(await emailField(), 'bob@example.com{Enter}');

      expect(screen.getByRole('button', { name: 'Send 1 invite' })).toBeEnabled();
    });

    it('counts a valid address still in the field', async () => {
      const user = userEvent.setup();
      renderPanel();
      const field = await emailField();
      await user.type(field, 'bob@example.com{Enter}');

      await user.type(field, 'cat@example.com');

      expect(screen.getByRole('button', { name: 'Send 2 invites' })).toBeEnabled();
    });

    it('does not count invalid text in the field', async () => {
      const user = userEvent.setup();
      renderPanel();
      const field = await emailField();
      await user.type(field, 'bob@example.com{Enter}');

      await user.type(field, 'not-yet');

      expect(screen.getByRole('button', { name: 'Send 1 invite' })).toBeInTheDocument();
    });
  });

  // ── the note ──────────────────────────────────────────────────────────────

  describe('note', () => {
    it('is a textarea capped at 500 characters with the suggested placeholder', async () => {
      renderPanel();
      const note = (await screen.findByLabelText('A note')) as HTMLTextAreaElement;

      expect(note.tagName).toBe('TEXTAREA');
      expect(note.maxLength).toBe(500);
      expect(note.placeholder).toBe('Come and try it — the files are encrypted end to end.');
    });
  });

  // ── sending ───────────────────────────────────────────────────────────────

  describe('sending', () => {
    async function twoChipsAndANote() {
      const user = userEvent.setup();
      const field = await emailField();
      await user.type(field, 'bob@example.com{Enter}cat@example.com{Enter}');
      await user.type(screen.getByLabelText('A note'), 'Hi there');
      return user;
    }

    it('sends the chips and the note', async () => {
      send.mockResolvedValue([invite({ email: 'bob@example.com' }), invite({ id: 'i2', email: 'cat@example.com' })]);
      renderPanel();
      const user = await twoChipsAndANote();

      await user.click(screen.getByRole('button', { name: 'Send 2 invites' }));

      await waitFor(() =>
        expect(send).toHaveBeenCalledWith({
          emails: ['bob@example.com', 'cat@example.com'],
          note: 'Hi there',
        }),
      );
    });

    it('includes a valid address left in the field', async () => {
      const user = userEvent.setup();
      send.mockResolvedValue([invite()]);
      renderPanel();
      await user.type(await emailField(), 'bob@example.com');

      await user.click(screen.getByRole('button', { name: 'Send 1 invite' }));

      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send.mock.calls[0][0].emails).toEqual(['bob@example.com']);
    });

    it('leaves the note out when there is none', async () => {
      const user = userEvent.setup();
      send.mockResolvedValue([invite()]);
      renderPanel();
      await user.type(await emailField(), 'bob@example.com{Enter}');

      await user.click(screen.getByRole('button', { name: 'Send 1 invite' }));

      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send.mock.calls[0][0].note || undefined).toBeUndefined();
    });

    it('says how many were sent in a status line', async () => {
      send.mockResolvedValue([invite({ email: 'bob@example.com' }), invite({ id: 'i2', email: 'cat@example.com' })]);
      renderPanel();
      const user = await twoChipsAndANote();

      await user.click(screen.getByRole('button', { name: 'Send 2 invites' }));

      const status = await screen.findByText('Sent 2 invites.');
      expect(status.closest('[role="status"]')).not.toBeNull();
    });

    it('says "Sent 1 invite." for one', async () => {
      const user = userEvent.setup();
      send.mockResolvedValue([invite()]);
      renderPanel();
      await user.type(await emailField(), 'bob@example.com{Enter}');

      await user.click(screen.getByRole('button', { name: 'Send 1 invite' }));

      expect(await screen.findByText('Sent 1 invite.')).toBeInTheDocument();
    });

    it('clears the chips and the note afterwards', async () => {
      send.mockResolvedValue([invite(), invite({ id: 'i2', email: 'cat@example.com' })]);
      renderPanel();
      const user = await twoChipsAndANote();

      await user.click(screen.getByRole('button', { name: 'Send 2 invites' }));

      await screen.findByText('Sent 2 invites.');
      expect(removeChip('bob@example.com')).not.toBeInTheDocument();
      expect(removeChip('cat@example.com')).not.toBeInTheDocument();
      expect((screen.getByLabelText('A note') as HTMLTextAreaElement).value).toBe('');
      expect(screen.getByRole('button', { name: 'Send invites' })).toBeDisabled();
    });

    it('calls onSent with what the server returned', async () => {
      const sent = [invite({ email: 'bob@example.com' }), invite({ id: 'i2', email: 'cat@example.com' })];
      send.mockResolvedValue(sent);
      const onSent = vi.fn();
      renderPanel({ onSent });
      const user = await twoChipsAndANote();

      await user.click(screen.getByRole('button', { name: 'Send 2 invites' }));

      await waitFor(() => expect(onSent).toHaveBeenCalledWith(sent));
    });

    it('disables the button while sending', async () => {
      const user = userEvent.setup();
      let finish: (v: unknown) => void = () => {};
      send.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      renderPanel();
      await user.type(await emailField(), 'bob@example.com{Enter}');

      await user.click(screen.getByRole('button', { name: 'Send 1 invite' }));

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /send/i })).toBeDisabled(),
      );
      finish([invite()]);
      await screen.findByText('Sent 1 invite.');
    });

    it('shows a server error in an alert and keeps the chips', async () => {
      const user = userEvent.setup();
      send.mockRejectedValue(new Error('You can send at most 20 invites a day'));
      renderPanel();
      await user.type(await emailField(), 'bob@example.com{Enter}');

      await user.click(screen.getByRole('button', { name: 'Send 1 invite' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('You can send at most 20 invites a day');
      expect(removeChip('bob@example.com')).toBeInTheDocument();
    });
  });

  // ── the sent list ─────────────────────────────────────────────────────────

  describe('sent list', () => {
    const sentInvites = [
      invite({ id: 'p1', email: 'pending@example.com', status: 'pending' }),
      invite({ id: 'a1', email: 'joined@example.com', status: 'accepted', acceptedAt: '2026-10-25T00:00:00Z' }),
      invite({ id: 'e1', email: 'expired@example.com', status: 'expired' }),
      invite({ id: 'r1', email: 'revoked@example.com', status: 'revoked' }),
    ];

    it('has the heading "Invites you\'ve sent"', async () => {
      list.mockResolvedValue(sentInvites);
      renderPanel();

      expect(await screen.findByText("Invites you've sent")).toBeInTheDocument();
    });

    it('lists each address', async () => {
      list.mockResolvedValue(sentInvites);
      renderPanel();

      for (const i of sentInvites) {
        expect(await screen.findByText(i.email as string)).toBeInTheDocument();
      }
    });

    it('labels each status', async () => {
      list.mockResolvedValue(sentInvites);
      renderPanel();
      await screen.findByText('pending@example.com');

      expect(screen.getByText('Pending')).toBeInTheDocument();
      expect(screen.getByText('Joined')).toBeInTheDocument();
      expect(screen.getByText('Expired')).toBeInTheDocument();
      expect(screen.getByText('Revoked')).toBeInTheDocument();
    });

    it('offers Revoke only on pending invites', async () => {
      list.mockResolvedValue(sentInvites);
      renderPanel();
      await screen.findByText('pending@example.com');

      expect(screen.getByRole('button', { name: 'Revoke invite to pending@example.com' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Revoke invite to joined@example.com' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Revoke invite to expired@example.com' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Revoke invite to revoked@example.com' })).not.toBeInTheDocument();
    });

    it('revokes an invite by id', async () => {
      const user = userEvent.setup();
      list.mockResolvedValue(sentInvites);
      renderPanel();

      await user.click(await screen.findByRole('button', { name: 'Revoke invite to pending@example.com' }));

      await waitFor(() => expect(revoke).toHaveBeenCalledWith('p1'));
    });

    it('says when nothing has been sent', async () => {
      list.mockResolvedValue([]);
      renderPanel();

      expect(await screen.findByText('No invites sent yet.')).toBeInTheDocument();
    });

    it('is hidden with showSentList={false}', async () => {
      list.mockResolvedValue(sentInvites);
      renderPanel({ showSentList: false });
      const field = (await screen.findByLabelText('Invite link')) as HTMLInputElement;
      await waitFor(() => expect(field.value).toBe(LINK_URL));

      expect(screen.queryByText("Invites you've sent")).not.toBeInTheDocument();
      expect(screen.queryByText('pending@example.com')).not.toBeInTheDocument();
      expect(screen.queryByText('No invites sent yet.')).not.toBeInTheDocument();
    });
  });

  // ── copy ──────────────────────────────────────────────────────────────────

  it('explains that each invite works once and lasts 14 days', async () => {
    renderPanel();

    expect(await screen.findByText('Each invite link works once and expires after 14 days.')).toBeInTheDocument();
  });

  it('focuses the email field on mount with autoFocus', async () => {
    renderPanel({ autoFocus: true });
    const field = await emailField();

    await waitFor(() => expect(document.activeElement).toBe(field));
  });
});
