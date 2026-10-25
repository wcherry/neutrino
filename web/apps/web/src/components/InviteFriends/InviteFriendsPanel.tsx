'use client';

/**
 * Invite friends — the reusable body of every invite surface: the account menu's
 * "Invite friends" dialog, the standalone `/invite` page, and the welcome
 * wizard's "Invite friends" step, which embeds this panel as it is (with
 * `showSentList={false}` and `onSent` to move the wizard on).
 *
 * It has three parts: the user's personal sign-up link (copy, share, reset),
 * a chip field that turns typed or pasted addresses into one-time emailed
 * invites, and the list of invites already sent, with Revoke on pending ones.
 * Sharing an encrypted file needs the other person to hold a key, which is why
 * this exists at all: an invite turns "they can't open it" into an account.
 *
 * Needs a react-query `QueryClientProvider` above it; the app shell has one.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Check, X } from 'lucide-react';
import { Button } from '@neutrino/ui';
import type { Invite, InviteStatus } from '@neutrino/auth';
import { parseEmails } from './parseEmails';
import { useInvites } from './useInvites';
import styles from './InviteFriends.module.css';

export interface InviteFriendsPanelProps {
  /** Called after a batch is sent. */
  onSent?: (invites: Invite[]) => void;
  /** Show the list of invites already sent (default true). */
  showSentList?: boolean;
  /** Focus the email field on mount. */
  autoFocus?: boolean;
  className?: string;
}

const COPIED_FOR_MS = 2000;
const NOTE_MAX = 500;
const SEPARATOR = /[,;\s]/;

const STATUS_LABEL: Record<InviteStatus, string> = {
  pending: 'Pending',
  accepted: 'Joined',
  expired: 'Expired',
  revoked: 'Revoked',
};

const STATUS_CLASS: Record<InviteStatus, string | undefined> = {
  pending: styles.statusPending,
  accepted: styles.statusAccepted,
  expired: styles.statusExpired,
  revoked: styles.statusRevoked,
};

function plural(n: number): string {
  return n === 1 ? '1 invite' : `${n} invites`;
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export function InviteFriendsPanel({
  onSent,
  showSentList = true,
  autoFocus = false,
  className,
}: InviteFriendsPanelProps) {
  const { linkUrl, invites, send, sending, revoke, resetLink } = useInvites();

  const emailId = useId();
  const noteId = useId();
  const errorId = useId();
  const emailRef = useRef<HTMLInputElement>(null);

  const [chips, setChips] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Decided after mount: `navigator` does not exist during the server render,
  // and deciding it there would make the first client render disagree.
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (autoFocus) emailRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  /** Add the valid addresses in `text` as chips; return what was not an address. */
  function addChips(text: string): string[] {
    const { valid, invalid } = parseEmails(text);
    if (valid.length) {
      setChips((prev) => [...prev, ...valid.filter((address) => !prev.includes(address))]);
    }
    return invalid;
  }

  /** Turn the whole field into chips, leaving any non-address in it with an error. */
  function commitDraft(text: string = draft): void {
    const invalid = addChips(text);
    const rest = invalid.join(' ');
    setDraft(rest);
    setFieldError(invalid.length ? `${rest} doesn't look like an email address` : null);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setFieldError(null);
    // A separator commits everything before it; whatever follows is still being typed.
    let lastSep = value.length - 1;
    while (lastSep >= 0 && !SEPARATOR.test(value[lastSep])) lastSep -= 1;
    if (lastSep < 0) {
      setDraft(value);
      return;
    }
    const head = value.slice(0, lastSep);
    const tail = value.slice(lastSep + 1);
    const invalid = addChips(head);
    if (invalid.length) {
      const rest = invalid.join(' ');
      setDraft(tail ? `${rest} ${tail}` : rest);
      setFieldError(`${rest} doesn't look like an email address`);
    } else {
      setDraft(tail);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && draft === '' && chips.length) {
      setChips((prev) => prev.slice(0, -1));
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text');
    if (!SEPARATOR.test(pasted)) return; // one address: let it land and be edited
    e.preventDefault();
    commitDraft(`${draft} ${pasted}`);
  }

  function removeChip(address: string) {
    setChips((prev) => prev.filter((c) => c !== address));
    emailRef.current?.focus();
  }

  // What Send would send: the chips, plus a finished address still in the field.
  const pendingInField = parseEmails(draft).valid.filter((address) => !chips.includes(address));
  const toSend = [...chips, ...pendingInField];
  const count = toSend.length;

  async function handleSend() {
    if (count === 0 || sending) return;
    setStatus('');
    setError(null);
    // Leave any invalid text in the field, as Enter would.
    commitDraft();
    const trimmed = note.trim();
    try {
      const sent = await send(toSend, trimmed || undefined);
      setChips([]);
      setDraft('');
      setFieldError(null);
      setNote('');
      setStatus(`Sent ${plural(sent.length)}.`);
      onSent?.(sent);
    } catch (err) {
      setError(messageOf(err, 'Could not send the invites. Please try again.'));
    }
  }

  async function handleCopy() {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
    } catch {
      setError('Could not copy the link. Select it and copy it yourself.');
    }
  }

  async function handleShare() {
    if (!linkUrl) return;
    try {
      await navigator.share({ title: 'Join me on Neutrino', url: linkUrl });
    } catch (err) {
      // Closing the share sheet is a choice, not an error.
      if (!isAbort(err)) setError(messageOf(err, 'Could not share the link.'));
    }
  }

  async function handleReset() {
    setError(null);
    setResetting(true);
    try {
      await resetLink();
    } catch (err) {
      setError(messageOf(err, 'Could not reset the link. Please try again.'));
    } finally {
      setResetting(false);
    }
  }

  async function handleRevoke(id: string) {
    setError(null);
    try {
      await revoke(id);
    } catch (err) {
      setError(messageOf(err, 'Could not revoke the invite. Please try again.'));
    }
  }

  const chipFieldClass = [
    styles.chipField,
    focused ? styles.chipFieldFocused : '',
    fieldError ? styles.chipFieldInvalid : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={[styles.panel, className].filter(Boolean).join(' ')}>
      {/* ── personal link ─────────────────────────────────────────────── */}
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Your invite link</span>
        <div className={styles.linkRow}>
          <input
            type="text"
            readOnly
            aria-label="Invite link"
            className={styles.linkInput}
            value={linkUrl ?? ''}
            placeholder="Loading…"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            variant="secondary"
            size="md"
            className={styles.copyButton}
            onClick={handleCopy}
            disabled={!linkUrl}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          {canShare && (
            <Button
              variant="primary"
              size="md"
              className={styles.shareButton}
              onClick={handleShare}
              disabled={!linkUrl}
            >
              Share…
            </Button>
          )}
        </div>
        <button
          type="button"
          className={styles.resetLink}
          onClick={handleReset}
          disabled={resetting || !linkUrl}
        >
          Reset link
        </button>
      </div>

      {/* ── emailed invites ───────────────────────────────────────────── */}
      <div className={styles.section}>
        <label htmlFor={emailId} className={styles.sectionLabel}>
          Or send invitations by email
        </label>
        {/* Clicking the empty part of the field lands in the input, as a text box would;
            keyboard users are already in the input, so the div needs no key handler. */}
        <div className={chipFieldClass} onClick={() => emailRef.current?.focus()}>
          {chips.map((address) => (
            <span key={address} className={styles.chip}>
              <span>{address}</span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`Remove ${address}`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeChip(address);
                }}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
          <input
            ref={emailRef}
            id={emailId}
            type="text"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            className={styles.chipInput}
            placeholder={chips.length ? '' : 'name@example.com'}
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              if (draft.trim()) commitDraft();
            }}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? errorId : undefined}
          />
        </div>
        {fieldError && (
          <p id={errorId} className={styles.fieldError}>
            {fieldError}
          </p>
        )}
      </div>

      <div className={styles.section}>
        <label htmlFor={noteId} className={styles.sectionLabel}>
          A note
        </label>
        <textarea
          id={noteId}
          className={styles.noteInput}
          maxLength={NOTE_MAX}
          rows={3}
          placeholder="Come and try it — the files are encrypted end to end."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className={styles.sendRow}>
        <Button
          variant="secondary"
          size="md"
          className={styles.sendButton}
          loading={sending}
          disabled={count === 0}
          onClick={handleSend}
        >
          {count === 0 ? 'Send invites' : `Send ${plural(count)}`}
        </Button>
        <p className={styles.footnote}>Each invite link works once and expires after 14 days.</p>
      </div>

      <p role="status" className={styles.statusLine}>
        {status && (
          <>
            <Check size={16} aria-hidden="true" />
            {status}
          </>
        )}
      </p>
      {error && (
        <p role="alert" className={styles.errorLine}>
          <AlertCircle size={16} aria-hidden="true" />
          {error}
        </p>
      )}

      {/* ── already sent ──────────────────────────────────────────────── */}
      {showSentList && (
        <section className={styles.sentSection} aria-labelledby={`${emailId}-sent`}>
          <h3 id={`${emailId}-sent`} className={styles.sentHeading}>
            Invites you&apos;ve sent
          </h3>
          {invites && invites.length === 0 && <p className={styles.empty}>No invites sent yet.</p>}
          {invites && invites.length > 0 && (
            <ul className={styles.sentList}>
              {invites.map((inv) => (
                <li key={inv.id} className={styles.sentRow}>
                  <span className={styles.sentEmail} title={inv.email}>
                    {inv.email}
                  </span>
                  <span className={[styles.statusBadge, STATUS_CLASS[inv.status]].filter(Boolean).join(' ')}>
                    {STATUS_LABEL[inv.status]}
                  </span>
                  {inv.status === 'pending' && (
                    <button
                      type="button"
                      className={styles.revokeButton}
                      aria-label={`Revoke invite to ${inv.email}`}
                      onClick={() => handleRevoke(inv.id)}
                    >
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
