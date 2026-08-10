'use client';

/**
 * Manage how the E2EE identity key is protected: which passkeys are enrolled,
 * the encryption password, and the recovery code.
 *
 * Every action here rewraps the master key, so all of them need an unlocked
 * session — the panel says so plainly rather than failing at the last step.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Fingerprint, KeyRound, LifeBuoy, Loader2, Plus, ShieldCheck } from 'lucide-react';
import {
  enrollPasskey,
  changeVaultPassword,
  regenerateRecoveryCode,
  revokeUnlockMethod,
  listUnlockMethods,
  type UnlockMethodResponse,
} from '@neutrino/auth';
import { isPasskeySupported, isUnlocked } from '@neutrino/e2e-crypto';
import styles from './UnlockMethodsPanel.module.css';

interface UnlockMethodsPanelProps {
  userId: string;
  userEmail: string;
}

const METHOD_ICON: Record<string, React.ReactNode> = {
  passkey: <Fingerprint size={16} />,
  password: <KeyRound size={16} />,
  recovery: <LifeBuoy size={16} />,
};

function formatDate(iso: string | null): string {
  if (!iso) return 'never used';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'never used' : `last used ${d.toLocaleDateString()}`;
}

export function UnlockMethodsPanel({ userId, userEmail }: UnlockMethodsPanelProps) {
  const [methods, setMethods] = useState<UnlockMethodResponse[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [newRecoveryCode, setNewRecoveryCode] = useState('');

  const unlocked = isUnlocked(userId);

  const reload = useCallback(async () => {
    try {
      setMethods(await listUnlockMethods());
    } catch {
      setMethods([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setBusy(key);
      setError('');
      try {
        await fn();
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  if (methods === null) {
    return (
      <div className={styles.panel}>
        <div className={styles.locked}>
          <Loader2 size={14} /> Loading…
        </div>
      </div>
    );
  }

  if (methods.length === 0) {
    return (
      <div className={styles.panel}>
        <p className={styles.hint}>
          No encryption key is set up yet. Reload the page to be prompted, or sign in again.
        </p>
      </div>
    );
  }

  // The server refuses to revoke the last method; mirror that here so the
  // button is visibly unavailable rather than failing on click.
  const canRevoke = methods.length > 1;

  return (
    <div className={styles.panel}>
      <div className={styles.list}>
        {methods.map((m) => (
          <div key={m.id} className={styles.row}>
            <div className={styles.rowIcon}>{METHOD_ICON[m.method] ?? <ShieldCheck size={16} />}</div>
            <div className={styles.rowInfo}>
              <div className={styles.rowLabel}>{m.label || m.method}</div>
              <div className={styles.rowMeta}>
                {m.method === 'recovery'
                  ? 'One-time code — regenerate to invalidate the old one'
                  : formatDate(m.lastUsedAt)}
              </div>
            </div>
            {m.method === 'passkey' && (
              <button
                type="button"
                className={styles.revokeBtn}
                disabled={!canRevoke || busy !== null}
                onClick={() => void run(m.id, () => revokeUnlockMethod(m.id))}
              >
                {busy === m.id ? 'Removing…' : 'Remove'}
              </button>
            )}
          </div>
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {!unlocked ? (
        <div className={styles.locked}>
          Unlock your encryption key to add a passkey or change your password.
        </div>
      ) : (
        <div className={styles.actions}>
          {isPasskeySupported() && (
            <button
              type="button"
              className={styles.revokeBtn}
              disabled={busy !== null}
              onClick={() =>
                void run('add-passkey', async () => {
                  await enrollPasskey(userId, userEmail, defaultPasskeyLabel());
                })
              }
            >
              {busy === 'add-passkey' ? (
                <>
                  <Loader2 size={14} /> Waiting for passkey…
                </>
              ) : (
                <>
                  <Plus size={14} /> Add passkey
                </>
              )}
            </button>
          )}

          <button
            type="button"
            className={styles.revokeBtn}
            disabled={busy !== null}
            onClick={() => setShowPasswordForm((v) => !v)}
          >
            Change encryption password
          </button>

          <button
            type="button"
            className={styles.revokeBtn}
            disabled={busy !== null}
            onClick={() =>
              void run('recovery', async () => {
                setNewRecoveryCode(await regenerateRecoveryCode(userId));
              })
            }
          >
            {busy === 'recovery' ? 'Generating…' : 'New recovery code'}
          </button>
        </div>
      )}

      {showPasswordForm && unlocked && (
        <div className={styles.inlineForm}>
          <label className={styles.hint} htmlFor="new-encryption-password">
            New encryption password (at least 8 characters)
          </label>
          <div className={styles.inlineFormRow}>
            <input
              id="new-encryption-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button
              type="button"
              className={styles.revokeBtn}
              disabled={newPassword.length < 8 || busy !== null}
              onClick={() =>
                void run('password', async () => {
                  await changeVaultPassword(userId, newPassword);
                  setNewPassword('');
                  setShowPasswordForm(false);
                })
              }
            >
              {busy === 'password' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {newRecoveryCode && (
        <div className={styles.inlineForm}>
          <p className={styles.hint}>
            Your new recovery code. The previous one no longer works — save this somewhere safe,
            it will not be shown again.
          </p>
          <div className={styles.recoveryCode}>{newRecoveryCode}</div>
          <button
            type="button"
            className={styles.revokeBtn}
            onClick={() => setNewRecoveryCode('')}
          >
            I have saved it
          </button>
        </div>
      )}
    </div>
  );
}

/** A label the user will recognise in a list months later. */
function defaultPasskeyLabel(): string {
  if (typeof navigator === 'undefined') return 'Passkey';
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'iOS passkey';
  if (/Macintosh/.test(ua)) return 'Mac passkey';
  if (/Windows/.test(ua)) return 'Windows passkey';
  if (/Android/.test(ua)) return 'Android passkey';
  return 'Passkey';
}
