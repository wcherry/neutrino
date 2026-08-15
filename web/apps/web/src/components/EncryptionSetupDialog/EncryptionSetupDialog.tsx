'use client';

/**
 * First-run encryption setup, shown immediately after registration.
 *
 * The key is created *for* the user: the account exists and is signed in by the
 * time this opens, so this provisions the vault on mount with the password they
 * just registered with. Nothing is asked of them before their key exists —
 * a new account is never left with files it cannot encrypt.
 *
 * The trade-off that buys: the vault's password unlock derives its KEK from the
 * account password, which the server *does* see at sign-in — so a hostile server
 * could derive that KEK and unwrap the master key. A separate encryption
 * password (Settings → Account → Unlock methods) is what removes that, and a
 * passkey — offered below — sidesteps it entirely, since its PRF secret never
 * leaves the authenticator.
 *
 * What is still asked, because it cannot be automated:
 *   - the recovery code, shown exactly once, so a forgotten password is not the
 *     end of the account
 *   - a passkey, optional, needing a user gesture
 *
 * Provisioning failure is not fatal: `E2EEUnlockGate` prompts again on the next
 * load, so the user can move on and set the key up from inside the app.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ModalBody, ModalFooter, ModalHeader, Button, Alert, Spinner } from '@neutrino/ui';
import { Check, Fingerprint, ShieldCheck } from 'lucide-react';
import { enrollPasskey, provisionVault } from '@neutrino/auth';
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

  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoverySaved, setRecoverySaved] = useState(false);

  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyAdded, setPasskeyAdded] = useState(false);
  const [passkeyError, setPasskeyError] = useState('');

  const provision = useCallback(async () => {
    setPhase('working');
    setError('');
    try {
      const { recoveryCode: code } = await provisionVault(userId, userEmail, accountPassword);
      setRecoveryCode(code);
      setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      setPhase('failed');
    }
  }, [userId, userEmail, accountPassword]);

  // Runs exactly once. A second `provisionVault` would mint a second master key
  // and PUT it over the first, orphaning the recovery code already on screen —
  // so this is guarded rather than left to effect deps (React's development
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
      await enrollPasskey(userId, userEmail, defaultPasskeyLabel());
      setPasskeyAdded(true);
    } catch (e) {
      // A passkey is optional here, so a refused prompt must not block the
      // recovery code the user still has to save.
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

  // ── Key created: passkey, then the recovery code shown exactly once ───────
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
            <p className={styles.sectionTitle}>Save your recovery code</p>
            <p className={styles.intro}>
              This is the only way back into your files if you forget your password. Write it down
              and keep it somewhere safe — it will not be shown again.
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
        </div>
      </ModalBody>
      <ModalFooter>
        <Button
          onClick={() => {
            setRecoveryCode('');
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
