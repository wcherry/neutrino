'use client';

/**
 * Prompts for the E2EE identity key when the session is locked.
 *
 * Rendered as an overlay rather than a hard gate: every consumer of
 * `loadKeyPair` already handles a null key (that is what
 * `EncryptionWarningMessage` is for), so a user who dismisses this still gets a
 * working app — just one that cannot decrypt. Blocking the whole shell would
 * turn any unlock bug into a bricked account.
 *
 * Three paths:
 *   no vault  — mint an identity, wrap it, show the recovery code once
 *   locked    — unlock with a passkey, the vault password, or recovery code
 *   unlocked  — render nothing
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, ModalBody, ModalFooter, ModalHeader, Button, TextInput, Alert, Spinner } from '@neutrino/ui';
import { KeyRound, Fingerprint, ShieldCheck } from 'lucide-react';
import {
  getVaultState,
  provisionVault,
  unlockWithPassword,
  unlockWithPasskey,
  unlockWithRecoveryCode,
  type VaultState,
} from '@neutrino/auth';
import { isPasskeySupported, type VaultBundle } from '@neutrino/e2e-crypto';
import styles from './E2EEUnlockGate.module.css';

interface E2EEUnlockGateProps {
  userId: string;
  userName: string;
}

type Phase = 'checking' | 'provision' | 'show-recovery' | 'unlock' | 'done' | 'dismissed';

export function E2EEUnlockGate({ userId, userName }: E2EEUnlockGateProps) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [vault, setVault] = useState<VaultBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Provision inputs
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoverySaved, setRecoverySaved] = useState(false);

  // Unlock inputs
  const [unlockSecret, setUnlockSecret] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  const hasPasskey = vault?.unlocks.some((u) => u.method === 'passkey') ?? false;

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const { state, vault: bundle } = await getVaultState(userId);
        if (cancelled) return;
        setVault(bundle);
        setPhase(phaseFor(state));
      } catch {
        // A vault lookup that fails (offline, server down) must not trap the
        // user behind a modal — leave the app usable and try again next load.
        if (!cancelled) setPhase('dismissed');
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const runGuarded = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  async function handleProvision() {
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    await runGuarded(async () => {
      const { recoveryCode: code } = await provisionVault(userId, userName, password);
      setRecoveryCode(code);
      setPassword('');
      setConfirmPassword('');
      setPhase('show-recovery');
    });
  }

  async function handleUnlockWithSecret() {
    if (!vault) return;
    setBusy(true);
    setError('');
    try {
      if (useRecovery) {
        await unlockWithRecoveryCode(userId, vault, unlockSecret);
      } else {
        await unlockWithPassword(userId, vault, unlockSecret);
      }
      setUnlockSecret('');
      setPhase('done');
    } catch (e) {
      // By far the likeliest cause is a typo, and "Decryption failed — wrong
      // key or corrupted data" reads as data loss to someone who just
      // mistyped. Say the ordinary thing for the ordinary case.
      const message = e instanceof Error ? e.message : '';
      setError(
        message.includes('Decryption failed')
          ? useRecovery
            ? 'That recovery code is not right. Check for typos and try again.'
            : 'That password is not right. Try again.'
          : message || 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlockWithPasskey() {
    if (!vault) return;
    await runGuarded(async () => {
      await unlockWithPasskey(userId, vault);
      setPhase('done');
    });
  }

  if (phase === 'checking' || phase === 'done' || phase === 'dismissed') return null;

  // ── First-run provisioning ────────────────────────────────────────────────
  if (phase === 'provision') {
    return (
      <Modal open onClose={() => setPhase('dismissed')} size="sm" closeOnBackdrop={false}>
        <ModalHeader>
          <ShieldCheck size={18} /> Protect your encryption key
        </ModalHeader>
        <ModalBody>
          <div className={styles.body}>
            <p className={styles.intro}>
              Your notes, documents and files are encrypted with a key only you hold. Choose a
              password to protect it. This is separate from your sign-in password, and we never
              see it — if you lose both it and your recovery code, your files cannot be recovered.
            </p>
            {error && <Alert variant="error" message={error} />}
            <div className={styles.form}>
              <TextInput
                type="password"
                label="Encryption password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              <TextInput
                type="password"
                label="Confirm password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleProvision();
                }}
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setPhase('dismissed')} disabled={busy}>
            Later
          </Button>
          <Button onClick={() => void handleProvision()} disabled={busy}>
            {busy ? <Spinner size="sm" /> : 'Continue'}
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  // ── Recovery code, shown exactly once ─────────────────────────────────────
  if (phase === 'show-recovery') {
    return (
      <Modal open onClose={() => {}} size="sm" closeOnBackdrop={false} closeOnEsc={false}>
        <ModalHeader>Save your recovery code</ModalHeader>
        <ModalBody>
          <div className={styles.body}>
            <p className={styles.intro}>
              This is the only way back into your files if you forget your encryption password.
              Write it down and keep it somewhere safe — it will not be shown again.
            </p>
            <div className={styles.recoveryCode}>{recoveryCode}</div>
            <label className={styles.confirmRow}>
              <input
                type="checkbox"
                checked={recoverySaved}
                onChange={(e) => setRecoverySaved(e.target.checked)}
              />
              <span>I have saved my recovery code somewhere safe.</span>
            </label>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            onClick={() => {
              setRecoveryCode('');
              setPhase('done');
            }}
            disabled={!recoverySaved}
          >
            Done
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  // ── Unlock ────────────────────────────────────────────────────────────────
  return (
    <Modal open onClose={() => setPhase('dismissed')} size="sm" closeOnBackdrop={false}>
      <ModalHeader>
        <KeyRound size={18} /> Unlock your files
      </ModalHeader>
      <ModalBody>
        <div className={styles.body}>
          <p className={styles.intro}>
            Your files are encrypted. Unlock to read and edit them on this device.
          </p>
          {error && <Alert variant="error" message={error} />}

          <div className={styles.methods}>
            {hasPasskey && isPasskeySupported() && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => void handleUnlockWithPasskey()}
                  disabled={busy}
                >
                  <Fingerprint size={16} /> Unlock with passkey
                </Button>
                <div className={styles.divider}>or</div>
              </>
            )}

            <div className={styles.form}>
              <TextInput
                type={useRecovery ? 'text' : 'password'}
                label={useRecovery ? 'Recovery code' : 'Encryption password'}
                autoComplete={useRecovery ? 'off' : 'current-password'}
                value={unlockSecret}
                onChange={(e) => setUnlockSecret(e.target.value)}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleUnlockWithSecret();
                }}
              />
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  setUseRecovery((v) => !v);
                  setUnlockSecret('');
                  setError('');
                }}
              >
                {useRecovery ? 'Use my encryption password instead' : 'Use a recovery code instead'}
              </button>
            </div>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={() => setPhase('dismissed')} disabled={busy}>
          Later
        </Button>
        <Button onClick={() => void handleUnlockWithSecret()} disabled={busy || !unlockSecret}>
          {busy ? <Spinner size="sm" /> : 'Unlock'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function phaseFor(state: VaultState): Phase {
  if (state === 'unlocked') return 'done';
  if (state === 'none') return 'provision';
  return 'unlock';
}
