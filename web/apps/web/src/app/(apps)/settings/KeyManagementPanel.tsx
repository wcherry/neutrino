'use client';

/**
 * Everything the user can do with their encryption key, in one place.
 *
 * Replaces the old "Unlock methods" panel, which managed the server-side
 * vault's password/passkey/recovery rows. There is no vault any more: the key is
 * created here, wrapped to this device, and never transmitted. What is left to
 * manage is correspondingly different — which versions exist, how to get the key
 * onto a second device, and how to print the kit that is now the only backstop.
 *
 * Four actions:
 *   recovery kit    re-render the printable kit for the current keyring
 *   rotate          mint a new version; old files stay readable
 *   pair a device   hand the keyring to a second device, offline
 *   forget          drop this device's copy
 */

import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { Check, Copy, KeyRound, QrCode, RefreshCw, Trash2 } from 'lucide-react';
import {
  rotateIdentity,
  currentRecoveryKit,
  forgetThisDevice,
  type RotationResult,
} from '@neutrino/auth';
import {
  getSessionKeyring,
  fingerprintFor,
  toBase64url,
  parsePairingOffer,
  respondToPairingOffer,
  confirmationCode,
  encodePairingPayload,
  type PairingOffer,
  type PairingResponse,
} from '@neutrino/e2e-crypto';
import { useToast } from '@neutrino/ui';
import styles from './KeyManagementPanel.module.css';

interface Props {
  userId: string;
  /** Re-read when the session locks or unlocks. */
  unlocked: boolean;
  onForgotten: () => void;
}

interface VersionRow {
  version: number;
  fingerprint: string;
  createdAt: string;
  active: boolean;
}

export function KeyManagementPanel({ userId, unlocked, onForgotten }: Props) {
  const toast = useToast();

  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [kit, setKit] = useState('');
  const [kitCopied, setKitCopied] = useState(false);

  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotated, setRotated] = useState<RotationResult | null>(null);
  const [rotatedKitSaved, setRotatedKitSaved] = useState(false);

  const [pairing, setPairing] = useState(false);
  const [offerText, setOfferText] = useState('');
  const [pairError, setPairError] = useState('');
  const [pairResult, setPairResult] = useState<{
    offer: PairingOffer;
    response: PairingResponse;
  } | null>(null);

  const [confirmForget, setConfirmForget] = useState(false);

  const refresh = useCallback(() => {
    const keyring = getSessionKeyring(userId);
    if (!keyring) {
      setVersions([]);
      return;
    }
    setVersions(
      keyring.entries.map((e) => ({
        version: e.version,
        fingerprint: fingerprintFor(userId, toBase64url(e.publicKey)),
        createdAt: e.createdAt,
        active: e.retiredAt === null,
      })),
    );
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh, unlocked]);

  if (!unlocked) {
    return (
      <p className={styles.hint}>
        Unlock your encryption key to manage it.
      </p>
    );
  }

  function handleShowKit() {
    try {
      setKit(currentRecoveryKit(userId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read your key.');
    }
  }

  async function handleCopyKit(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setKitCopied(true);
      setTimeout(() => setKitCopied(false), 2000);
    } catch {
      // Clipboard access denied — the kit is on screen and selectable anyway.
    }
  }

  async function handleRotate() {
    setRotating(true);
    try {
      const result = await rotateIdentity(userId);
      setRotated(result);
      setRotatedKitSaved(false);
      setConfirmRotate(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not rotate your key.');
    } finally {
      setRotating(false);
    }
  }

  function handleRespondToOffer() {
    setPairError('');
    const keyring = getSessionKeyring(userId);
    if (!keyring) {
      setPairError('Your key is locked.');
      return;
    }
    try {
      const offer = parsePairingOffer(offerText);
      setPairResult({ offer, response: respondToPairingOffer(keyring, offer) });
    } catch (e) {
      setPairError(e instanceof Error ? e.message : 'That code was not recognised.');
    }
  }

  async function handleForget() {
    await forgetThisDevice(userId);
    setConfirmForget(false);
    onForgotten();
  }

  return (
    <div className={styles.panel}>
      {/* ── Versions ─────────────────────────────────────────────────── */}
      <div className={styles.versions}>
        {versions.map((v) => (
          <div key={v.version} className={styles.versionRow}>
            <KeyRound size={16} className={v.active ? styles.activeIcon : styles.retiredIcon} />
            <div className={styles.versionInfo}>
              <div className={styles.versionName}>
                Version {v.version}
                {v.active && <span className={styles.activeBadge}>Active</span>}
              </div>
              <div className={styles.versionFingerprint}>{v.fingerprint}</div>
            </div>
          </div>
        ))}
      </div>
      {versions.length > 1 && (
        <p className={styles.hint}>
          Older versions are kept because files encrypted before a rotation are still sealed to
          them. Removing one would make those files unreadable.
        </p>
      )}

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <div className={styles.actions}>
        <button type="button" className={styles.outlineBtn} onClick={handleShowKit}>
          Show recovery kit
        </button>
        <button type="button" className={styles.outlineBtn} onClick={() => setPairing(true)}>
          <QrCode size={14} /> Add a device
        </button>
        <button type="button" className={styles.outlineBtn} onClick={() => setConfirmRotate(true)}>
          <RefreshCw size={14} /> Rotate key
        </button>
        <button type="button" className={styles.dangerBtn} onClick={() => setConfirmForget(true)}>
          <Trash2 size={14} /> Forget on this device
        </button>
      </div>

      {/* ── Recovery kit ─────────────────────────────────────────────── */}
      {kit && (
        <div className={styles.block}>
          <div className={styles.blockTitle}>Your recovery kit</div>
          <p className={styles.hint}>
            The only copy of your key that survives losing every device. Anyone holding it can read
            your files, so keep it somewhere safe rather than on the machine it protects.
          </p>
          <pre className={styles.kit}>{kit}</pre>
          <button
            type="button"
            className={styles.outlineBtn}
            onClick={() => void handleCopyKit(kit)}
          >
            {kitCopied ? (
              <>
                <Check size={14} /> Copied
              </>
            ) : (
              <>
                <Copy size={14} /> Copy
              </>
            )}
          </button>
        </div>
      )}

      {/* ── Pairing (this device is the sender) ──────────────────────── */}
      {pairing && (
        <div className={styles.block}>
          <div className={styles.blockTitle}>Add a device</div>
          {!pairResult ? (
            <>
              <p className={styles.hint}>
                On the new device, choose &ldquo;Restore my key&rdquo; and pick pairing. It will
                show a code — paste it here. Nothing is sent through our servers; the key travels
                only between the two screens.
              </p>
              <textarea
                className={styles.textarea}
                rows={3}
                placeholder="Paste the code shown on the new device…"
                value={offerText}
                onChange={(e) => {
                  setOfferText(e.target.value);
                  setPairError('');
                }}
              />
              {pairError && <span className={styles.error}>{pairError}</span>}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.outlineBtn}
                  onClick={() => {
                    setPairing(false);
                    setOfferText('');
                    setPairError('');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={handleRespondToOffer}
                  disabled={!offerText.trim()}
                >
                  Continue
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={styles.hint}>
                Scan this with the new device. Then check that it shows the same confirmation code
                as below — if the codes differ, something is intercepting the transfer and you
                should stop.
              </p>
              <div className={styles.qrWrap}>
                <QRCode value={encodePairingPayload(pairResult.response)} size={220} level="M" />
              </div>
              <div className={styles.sasLabel}>Confirmation code</div>
              <div className={styles.sas}>
                {confirmationCode(pairResult.offer, pairResult.response)}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => {
                    setPairing(false);
                    setPairResult(null);
                    setOfferText('');
                  }}
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Rotation confirm ─────────────────────────────────────────── */}
      {confirmRotate && (
        <div className={styles.block}>
          <div className={styles.blockTitle}>Rotate your encryption key?</div>
          <p className={styles.hint}>
            A new key version is created and used for everything from now on. Files you already
            have stay readable — they keep the version that made them.
          </p>
          <p className={styles.hint}>
            Your current recovery kit will not cover the new key, so you will be shown a fresh one
            to save.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.outlineBtn}
              onClick={() => setConfirmRotate(false)}
              disabled={rotating}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => void handleRotate()}
              disabled={rotating}
            >
              {rotating ? 'Rotating…' : 'Rotate key'}
            </button>
          </div>
        </div>
      )}

      {/* ── New kit after rotation, must be acknowledged ──────────────── */}
      {rotated && (
        <div className={styles.block}>
          <div className={styles.blockTitle}>Save your new recovery kit</div>
          <p className={styles.hint}>
            Version {rotated.newVersion} is now active. Your previous kit cannot restore it, so
            replace the copy you have saved with this one.
          </p>
          <pre className={styles.kit}>{rotated.recoveryKit}</pre>
          <label className={styles.confirmRow}>
            <input
              type="checkbox"
              checked={rotatedKitSaved}
              onChange={(e) => setRotatedKitSaved(e.target.checked)}
            />
            <span>I have replaced my saved recovery kit with this one.</span>
          </label>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.outlineBtn}
              onClick={() => void handleCopyKit(rotated.recoveryKit)}
            >
              {kitCopied ? (
                <>
                  <Check size={14} /> Copied
                </>
              ) : (
                <>
                  <Copy size={14} /> Copy
                </>
              )}
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => setRotated(null)}
              disabled={!rotatedKitSaved}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* ── Forget confirm ───────────────────────────────────────────── */}
      {confirmForget && (
        <div className={styles.block}>
          <div className={styles.blockTitle}>Forget this device&rsquo;s key?</div>
          <p className={styles.hint}>
            This browser will no longer be able to read your encrypted files. Your key is not
            deleted — you can restore it here from your recovery kit, or from another device that
            still has it. If neither exists, your files become unreadable permanently.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.outlineBtn}
              onClick={() => setConfirmForget(false)}
            >
              Cancel
            </button>
            <button type="button" className={styles.dangerBtn} onClick={() => void handleForget()}>
              Forget it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
