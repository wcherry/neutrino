'use client';

/**
 * Prompts for the E2EE identity key when this device cannot decrypt.
 *
 * Rendered as an overlay rather than a hard gate: every consumer of
 * `loadKeyPair` already handles a null key (that is what
 * `EncryptionWarningMessage` is for), so a user who dismisses this still gets a
 * working app — just one that cannot decrypt. Blocking the whole shell would
 * turn any unlock bug into a bricked account.
 *
 * Four paths, and the distinction between the first two is the important one:
 *
 *   none         no key anywhere — offer to create one
 *   needs-device the account *has* a key, but this browser holds no copy. Never
 *                offer to create one here: that would mint a second identity and
 *                orphan every existing file. Recovery kit or pairing only.
 *   locked       this device holds the keyring — open it
 *   unlocked     render nothing
 *
 * The passphrase prompt has been removed: a key created here is stored so that
 * this device opens it unattended, `getKeyringState` does that before anything
 * renders, and 'unlocked' is what it reports. So on a device enrolled from now
 * on, this component never appears after the first run.
 *
 * 'locked' therefore only happens on a browser enrolled *before* that change,
 * whose stored record is still wrapped under a passphrase or passkey. That path
 * is kept — the alternative is those users being unable to reach their own files
 * — and `unlockKeyring` converts the record afterwards, so it asks exactly once
 * and then never again.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Button,
  TextInput,
  Alert,
  Spinner,
} from '@neutrino/ui';
import { KeyRound, Fingerprint, ShieldCheck, ShieldAlert } from 'lucide-react';
import {
  getKeyringState,
  provisionKeyring,
  unlockKeyring,
  restoreFromRecoveryKit,
  type KeyringState,
  type LocalKeystoreInfo,
} from '@neutrino/auth';
import { subscribeToGateRequests } from './gateEvents';
import styles from './E2EEUnlockGate.module.css';

interface E2EEUnlockGateProps {
  userId: string;
  userName: string;
}

type Phase =
  | 'checking'
  | 'provision'
  | 'show-kit'
  | 'unlock'
  | 'restore'
  | 'done'
  | 'dismissed';

export function E2EEUnlockGate({ userId, userName }: E2EEUnlockGateProps) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [local, setLocal] = useState<LocalKeystoreInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Provision / restore inputs
  const [recoveryKit, setRecoveryKit] = useState('');
  const [kitSaved, setKitSaved] = useState(false);
  const [kitInput, setKitInput] = useState('');

  // Unlock input — only ever used by a device enrolled before the prompt went.
  const [unlockSecret, setUnlockSecret] = useState('');

  const check = useCallback(async () => {
    setPhase('checking');
    try {
      const { state, local: info } = await getKeyringState(userId);
      setLocal(info);
      setPhase(phaseFor(state));
    } catch {
      // A lookup that fails (offline, server down) must not trap the user
      // behind a modal — leave the app usable and try again next load.
      setPhase('dismissed');
    }
  }, [userId]);

  useEffect(() => {
    void check();
  }, [check]);

  // Dismissing this is not final: Settings (and anything else that finds the
  // session locked) can ask for it back rather than telling the user to reload.
  useEffect(() => subscribeToGateRequests(() => void check()), [check]);

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

  /**
   * How this device will wrap the keyring.
   *
   * Device wrapping, always: the passphrase prompt was removed by request, so
   * there is no secret to wrap under and nothing to ask. The key is stored where
   * this origin's JavaScript can read it back without a gesture — see
   * `DeviceParams` in `keystoreLocal.ts` for exactly what that gives up.
   */
  function wrapChoice() {
    return { method: 'device' } as const;
  }

  async function handleProvision() {
    await runGuarded(async () => {
      const { recoveryKit: kit } = await provisionKeyring(userId, userName, wrapChoice());
      setRecoveryKit(kit);
      setPhase('show-kit');
    });
  }

  async function handleRestore() {
    await runGuarded(async () => {
      await restoreFromRecoveryKit(userId, userName, kitInput, wrapChoice());
      setKitInput('');
      setPhase('done');
    });
  }

  async function handleUnlock(method: 'passkey' | 'passphrase') {
    await runGuarded(async () => {
      await unlockKeyring(
        userId,
        method === 'passkey' ? { method } : { method, passphrase: unlockSecret },
      );
      setUnlockSecret('');
      setPhase('done');
    });
  }

  if (phase === 'checking' || phase === 'done' || phase === 'dismissed') return null;

  // ── First run: no key anywhere ────────────────────────────────────────────
  if (phase === 'provision') {
    return (
      <Modal open onClose={() => setPhase('dismissed')} size="sm" closeOnBackdrop={false}>
        <ModalHeader>
          <ShieldCheck size={18} /> Set up encryption
        </ModalHeader>
        <ModalBody>
          <div className={styles.body}>
            <p className={styles.intro}>
              Your notes, documents and files are encrypted with a key that is created here and
              never sent to us. It is kept on this device and unlocks automatically.
            </p>
            <p className={styles.intro}>
              Because we never receive it, we cannot reset it. The recovery kit shown next is the
              only way back if you lose this device.
            </p>
            {error && <Alert variant="error" message={error} />}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setPhase('dismissed')} disabled={busy}>
            Later
          </Button>
          <Button onClick={() => void handleProvision()} disabled={busy}>
            {busy ? <Spinner size="sm" /> : 'Create my key'}
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  // ── The recovery kit, shown exactly once ──────────────────────────────────
  if (phase === 'show-kit') {
    return (
      <Modal open onClose={() => {}} size="md" closeOnBackdrop={false} closeOnEsc={false}>
        <ModalHeader>Save your recovery kit</ModalHeader>
        <ModalBody>
          <div className={styles.body}>
            <p className={styles.intro}>
              This is the only copy of your key that survives losing this device. Print it or write
              it down and keep it somewhere safe — it will not be shown again, and there is no way
              for us to recover your files without it.
            </p>
            <pre className={styles.recoveryKit}>{recoveryKit}</pre>
            <label className={styles.confirmRow}>
              <input
                type="checkbox"
                checked={kitSaved}
                onChange={(e) => setKitSaved(e.target.checked)}
              />
              <span>I have saved my recovery kit somewhere safe.</span>
            </label>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            onClick={() => {
              setRecoveryKit('');
              setPhase('done');
            }}
            disabled={!kitSaved}
          >
            Done
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  // ── This account has a key, but not on this device ────────────────────────
  if (phase === 'restore') {
    return (
      <Modal open onClose={() => setPhase('dismissed')} size="md" closeOnBackdrop={false}>
        <ModalHeader>
          <ShieldAlert size={18} /> This device needs your key
        </ModalHeader>
        <ModalBody>
          <div className={styles.body}>
            <p className={styles.intro}>
              Your files are encrypted with a key this browser does not have. Enter your recovery
              kit to restore it, or pair with a device that already has it from Settings.
            </p>
            {error && <Alert variant="error" message={error} />}
            <div className={styles.form}>
              <TextInput
                label="Recovery kit"
                autoComplete="off"
                value={kitInput}
                onChange={(e) => setKitInput(e.target.value)}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && kitInput) void handleRestore();
                }}
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setPhase('dismissed')} disabled={busy}>
            Later
          </Button>
          <Button onClick={() => void handleRestore()} disabled={busy || !kitInput}>
            {busy ? <Spinner size="sm" /> : 'Restore my key'}
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  // ── Unlock this device's stored keyring ───────────────────────────────────
  const byPasskey = local?.method === 'passkey';
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
            {byPasskey ? (
              <Button
                variant="secondary"
                onClick={() => void handleUnlock('passkey')}
                disabled={busy}
              >
                {busy ? <Spinner size="sm" /> : (
                  <>
                    <Fingerprint size={16} /> Unlock with passkey
                  </>
                )}
              </Button>
            ) : (
              <div className={styles.form}>
                <TextInput
                  type="password"
                  label="Passphrase"
                  autoComplete="current-password"
                  value={unlockSecret}
                  onChange={(e) => setUnlockSecret(e.target.value)}
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleUnlock('passphrase');
                  }}
                />
              </div>
            )}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                setError('');
                setPhase('restore');
              }}
            >
              Use my recovery kit instead
            </button>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={() => setPhase('dismissed')} disabled={busy}>
          Later
        </Button>
        {!byPasskey && (
          <Button onClick={() => void handleUnlock('passphrase')} disabled={busy || !unlockSecret}>
            {busy ? <Spinner size="sm" /> : 'Unlock'}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}

function phaseFor(state: KeyringState): Phase {
  if (state === 'unlocked') return 'done';
  if (state === 'none') return 'provision';
  if (state === 'needs-device') return 'restore';
  return 'unlock';
}
