'use client';

/**
 * First-run encryption setup, shown immediately after registration.
 *
 * The key is created *for* the user: the account exists and is signed in by the
 * time this opens, so this mints the keyring on mount and wraps it to this
 * device with the password they just registered with. Nothing is asked of them
 * before their key exists — a new account is never left with files it cannot
 * encrypt.
 *
 * Wrapping under the account password is weaker than a passkey, because the
 * server sees that password at sign-in. It is nonetheless sound here in a way it
 * was not under the old server-side vault: the wrapped keyring never leaves this
 * device, so knowing the password buys nothing without also holding this
 * browser's IndexedDB. A passkey — offered below — removes even that, since its
 * PRF secret never leaves the authenticator.
 *
 * What is still asked, because it cannot be automated:
 *   - the recovery kit, shown exactly once. With no server-side copy of the key,
 *     this is the only thing that survives losing the device.
 *   - a passkey, optional, needing a user gesture
 *
 * Failure is not fatal: `E2EEUnlockGate` prompts again on the next load, so the
 * user can move on and set the key up from inside the app.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ModalBody, ModalFooter, ModalHeader, Button, Alert, Spinner } from '@neutrino/ui';
import { Check, Fingerprint, ShieldCheck } from 'lucide-react';
import { provisionKeyring, currentRecoveryKit } from '@neutrino/auth';
import { storeUnderPasskey, getSessionKeyring } from '@neutrino/e2e-crypto';
import { isPasskeySupported } from '@neutrino/e2e-crypto';
import { defaultPasskeyLabel } from '@/lib/passkeyLabel';
import styles from './EncryptionSetupDialog.module.css';

interface EncryptionSetupDialogProps {
  userId: string;
  userEmail: string;
  /** The password the account was just created with; it wraps the new key. */
  accountPassword: string;
  /** Called when the user finishes setup or chooses to move on without it. */
  onDone: () => void;
}

type Phase = 'working' | 'ready' | 'failed';

export function EncryptionSetupDialog({
  userId,
  userEmail,
  accountPassword,
  onDone,
}: EncryptionSetupDialogProps) {
  const [phase, setPhase] = useState<Phase>('working');
  const [error, setError] = useState('');

  const [recoveryKit, setRecoveryKit] = useState('');
  const [recoverySaved, setRecoverySaved] = useState(false);

  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyAdded, setPasskeyAdded] = useState(false);
  const [passkeyError, setPasskeyError] = useState('');

  const provision = useCallback(async () => {
    setPhase('working');
    setError('');
    try {
      const { recoveryKit: kit } = await provisionKeyring(userId, userEmail, {
        method: 'passphrase',
        passphrase: accountPassword,
      });
      setRecoveryKit(kit);
      setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setPhase('failed');
    }
  }, [userId, userEmail, accountPassword]);

  // Runs exactly once. A second `provisionKeyring` would mint a second identity
  // and overwrite the first, orphaning the recovery kit already on screen — so
  // this is guarded rather than left to effect deps (React's development
  // double-invoke alone would trigger it).
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void provision();
  }, [provision]);

  async function handleAddPasskey() {
    setPasskeyBusy(true);
    setPasskeyError('');
    try {
      // Re-wraps this device's stored keyring under the passkey, replacing the
      // account-password wrapping chosen above. The keyring itself is unchanged,
      // so the recovery kit on screen stays correct.
      const keyring = getSessionKeyring(userId);
      if (!keyring) throw new Error('Your key is not unlocked.');
      await storeUnderPasskey(keyring, userEmail, defaultPasskeyLabel());
      setPasskeyAdded(true);
    } catch (e) {
      // A passkey is optional here, so a refused prompt must not block the
      // recovery kit the user still has to save.
      setPasskeyError(e instanceof Error ? e.message : 'Could not add a passkey.');
    } finally {
      setPasskeyBusy(false);
    }
  }

  // ── Creating the key ──────────────────────────────────────────────────────
  if (phase === 'working') {
    return (
      <Modal open onClose={() => {}} size="sm" closeOnBackdrop={false} closeOnEsc={false}>
        <ModalHeader>
          <ShieldCheck size={18} /> Setting up encryption
        </ModalHeader>
        <ModalBody>
          <div className={styles.working}>
            <Spinner size="md" />
            <p className={styles.intro}>
              Creating the key that encrypts your notes, documents and files. This takes a moment.
            </p>
          </div>
        </ModalBody>
      </Modal>
    );
  }

  // ── Provisioning failed ───────────────────────────────────────────────────
  if (phase === 'failed') {
    return (
      <Modal open onClose={onDone} size="sm" closeOnBackdrop={false}>
        <ModalHeader>
          <ShieldCheck size={18} /> Encryption setup
        </ModalHeader>
        <ModalBody>
          <div className={styles.body}>
            <Alert variant="error" message={error} />
            <p className={styles.intro}>
              Your account is ready — only the encryption key is missing. You can carry on and
              we will offer to set it up again next time you open Neutrino.
            </p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onDone}>
            Continue without it
          </Button>
          <Button onClick={() => void provision()}>Try again</Button>
        </ModalFooter>
      </Modal>
    );
  }

  // ── Key created: passkey, then the recovery kit shown exactly once ───────
  return (
    <Modal open onClose={() => {}} size="sm" closeOnBackdrop={false} closeOnEsc={false}>
      <ModalHeader>
        <ShieldCheck size={18} /> Your encryption key is ready
      </ModalHeader>
      <ModalBody>
        <div className={styles.body}>
          <p className={styles.intro}>
            Your notes, documents and files are encrypted with a key only you hold. It is unlocked
            with your account password — we never see the key itself.
          </p>

          {isPasskeySupported() && (
            <>
              <div className={styles.section}>
                <p className={styles.sectionTitle}>Add a passkey</p>
                <p className={styles.intro}>
                  Unlock on this device with Touch ID, Windows Hello or your security key instead
                  of typing your password. You can add more later in Settings.
                </p>
                {passkeyError && <Alert variant="error" message={passkeyError} />}
                {passkeyAdded ? (
                  <div className={styles.enrolled}>
                    <Check size={16} /> Passkey added
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => void handleAddPasskey()}
                    disabled={passkeyBusy}
                  >
                    {passkeyBusy ? (
                      <Spinner size="sm" />
                    ) : (
                      <>
                        <Fingerprint size={16} /> Add passkey
                      </>
                    )}
                  </Button>
                )}
              </div>
              <div className={styles.divider} />
            </>
          )}

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Save your recovery kit</p>
            <p className={styles.intro}>
              Your key is created on this device and never sent to us, so we cannot reset it. This
              kit is the only way back into your files if you lose this device. Print it or write it
              down — it will not be shown again.
            </p>
            <pre className={styles.recoveryKit}>{recoveryKit}</pre>
            <label className={styles.confirmRow}>
              <input
                type="checkbox"
                checked={recoverySaved}
                onChange={(e) => setRecoverySaved(e.target.checked)}
              />
              <span>I have saved my recovery kit somewhere safe.</span>
            </label>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button
          onClick={() => {
            setRecoveryKit('');
            onDone();
          }}
          disabled={!recoverySaved || passkeyBusy}
        >
          Done
        </Button>
      </ModalFooter>
    </Modal>
  );
}
