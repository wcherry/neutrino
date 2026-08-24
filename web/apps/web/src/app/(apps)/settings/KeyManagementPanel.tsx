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
 *   mobile key code a PIN-protected QR the phone scans — see `mobileKeyQr.ts`
 *   rotate          mint a new version; old files stay readable
 *   forget          drop this device's copy
 *
 * There is deliberately no device pairing here. The two-QR handshake put the web
 * app on the *receiving* end of a scan, which needs a camera pointed at another
 * screen — the wrong shape for a desktop browser, and the wrong direction: the
 * phone is the device with the camera. Moving a key to a phone is the mobile key
 * code above; moving it to another browser is the recovery kit.
 */

import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { Check, Copy, KeyRound, RefreshCw, Smartphone, Trash2 } from 'lucide-react';
import {
  rotateIdentity,
  backUpRetiredKeys,
  storedKeyFileVersions,
  currentRecoveryKit,
  forgetThisDevice,
  type RotationResult,
} from '@neutrino/auth';
import {
  getSessionKeyring,
  fingerprintFor,
  toBase64url,
  exportKeyQr,
  expireQrPayload,
  type MobileKeyQr,
} from '@neutrino/e2e-crypto';
import { useToast } from '@neutrino/ui';
import styles from './KeyManagementPanel.module.css';

/** How long the mobile QR stays on screen. Long enough to scan, short enough not to linger. */
const MOBILE_QR_SECONDS = 120;

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

  /**
   * The mobile compatibility QR — see `mobileKeyQr.ts`. Unlike pairing, this
   * code *is* the key under a short PIN, so it is held in state only while it is
   * on screen and cleared on a timer rather than left up until the panel closes.
   */
  const [mobileQr, setMobileQr] = useState<MobileKeyQr | null>(null);
  const [mobileQrSeconds, setMobileQrSeconds] = useState(0);
  const [mobileQrBusy, setMobileQrBusy] = useState(false);

  const [confirmForget, setConfirmForget] = useState(false);

  /**
   * Which versions the server's key file holds, read back rather than assumed.
   *
   * `null` while unknown, and `[]` for an account whose key file is missing —
   * the state this exists to make visible. Without it a failed archive is
   * invisible: rotation reports it once, in a block the user dismisses, and
   * every retired key then lives only in this browser profile.
   */
  const [backedUp, setBackedUp] = useState<number[] | null>(null);
  const [backingUp, setBackingUp] = useState(false);

  const refresh = useCallback(() => {
    const keyring = getSessionKeyring(userId);
    if (!keyring) {
      setVersions([]);
      return;
    }
    // One GET, and it is the difference between "your older keys are safe" and
    // "they are one cleared profile from gone".
    void storedKeyFileVersions()
      .then((stored) => setBackedUp(stored ?? []))
      .catch(() => setBackedUp(null));
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

  /**
   * Take the mobile QR off screen on its own.
   *
   * A photograph of it plus an offline grind of six digits is the key, so the
   * window in which a camera across the room can catch it is kept to the time it
   * actually takes to scan. The payload is blanked rather than the block hidden,
   * so nothing is left in state behind a closed panel.
   */
  useEffect(() => {
    if (!mobileQr || !mobileQr.payload) return;
    if (mobileQrSeconds <= 0) {
      setMobileQr(expireQrPayload(mobileQr));
      return;
    }
    const timer = setTimeout(() => setMobileQrSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [mobileQr, mobileQrSeconds]);

  // Locking the session must not leave a decrypted key rendered.
  useEffect(() => {
    if (!unlocked) {
      setMobileQr(null);
      setMobileQrSeconds(0);
    }
  }, [unlocked]);

  /**
   * Retired versions this browser holds that the server's key file does not.
   *
   * Empty while the status is still unknown (`backedUp === null`), so a slow or
   * failed status read never renders a false alarm.
   */
  const missingFromBackup =
    backedUp === null
      ? []
      : versions.filter((v) => !v.active && !backedUp.includes(v.version)).map((v) => v.version);

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

  /** Build the PIN-protected QR the mobile apps scan. */
  async function handleMobileQr() {
    const keyring = getSessionKeyring(userId);
    if (!keyring) {
      toast.error('Your key is locked.');
      return;
    }
    setMobileQrBusy(true);
    try {
      // 600 000 PBKDF2 iterations run before this resolves, so the button has to
      // show it is working rather than look dead for a second.
      setMobileQr(await exportKeyQr(keyring));
      setMobileQrSeconds(MOBILE_QR_SECONDS);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not build the key code.');
    } finally {
      setMobileQrBusy(false);
    }
  }

  /**
   * Re-upload the retired keys.
   *
   * Rotation writes them too, but only as a side effect, and a failure there
   * used to leave no way back other than rotating again — which mints another
   * version to lose. This is the retry, and it reports the reason on failure
   * rather than logging it to a console nobody has open.
   */
  async function handleBackUp() {
    setBackingUp(true);
    try {
      const { versions: stored } = await backUpRetiredKeys(userId);
      setBackedUp(stored);
      toast.success(
        stored.length === 0
          ? 'No earlier keys to back up yet.'
          : `Backed up ${stored.length} earlier key${stored.length === 1 ? '' : 's'}.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not back up your earlier keys.');
    } finally {
      setBackingUp(false);
    }
  }

  function closeMobileQr() {
    setMobileQr(null);
    setMobileQrSeconds(0);
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
      {/*
        The one status worth putting in front of the user unprompted. A retired
        key that is not in the key file cannot reach a phone, and cannot survive
        this browser — so "not backed up" is a call to action, not a detail.
      */}
      {missingFromBackup.length > 0 && (
        <div className={styles.warning}>
          Key version{missingFromBackup.length > 1 ? 's' : ''}{' '}
          {missingFromBackup.join(', ')} exist only in this browser. Files encrypted with{' '}
          {missingFromBackup.length > 1 ? 'them' : 'it'} cannot be opened on your phone, and would
          be lost if this browser&rsquo;s data were cleared.{' '}
          <button
            type="button"
            className={styles.inlineBtn}
            onClick={() => void handleBackUp()}
            disabled={backingUp}
          >
            {backingUp ? 'Backing up…' : 'Back up now'}
          </button>
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.outlineBtn} onClick={handleShowKit}>
          Show recovery kit
        </button>
        <button
          type="button"
          className={styles.outlineBtn}
          onClick={() => void handleMobileQr()}
          disabled={mobileQrBusy}
        >
          <Smartphone size={14} /> {mobileQrBusy ? 'Preparing…' : 'Key code for mobile'}
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

      {/* ── Mobile key code (this device shows, the phone scans) ─────── */}
      {mobileQr && (
        <div className={styles.block}>
          <div className={styles.blockTitle}>Key code for mobile</div>

          <p className={styles.warning}>
            This code contains your encryption key, protected only by the six digits below. Anyone
            who photographs both can read your files. Show it only to your own phone, never on a
            shared or recorded screen.
          </p>

          {mobileQr.payload ? (
            <>
              <p className={styles.hint}>
                In the Neutrino app, choose Import key → Scan QR code, then enter the PIN when it
                asks.
              </p>

              <div className={styles.qrWrap}>
                <QRCode value={mobileQr.payload} size={220} level="M" />
              </div>

              <div className={styles.sasLabel}>PIN</div>
              <div className={styles.sas}>{mobileQr.pin}</div>

              <div className={styles.countdown}>
                Hides in {Math.floor(mobileQrSeconds / 60)}:
                {String(mobileQrSeconds % 60).padStart(2, '0')}
              </div>
            </>
          ) : (
            <div className={styles.expired}>
              This code has expired. Generate a new one if the phone did not finish scanning.
            </div>
          )}

          {/*
            iOS stores one keypair, so a rotated account cannot hand the phone
            the versions its older files are sealed to. Saying so here is the
            difference between a known limitation and a phone that silently
            cannot open half the library.
          */}
          {mobileQr.omittedVersions.length > 0 && (
            <p className={styles.hint}>
              This sends version {mobileQr.keyVersion} only. The mobile app holds one key at a time,
              so files still sealed to version
              {mobileQr.omittedVersions.length > 1 ? 's ' : ' '}
              {mobileQr.omittedVersions.join(', ')} will not open there. There is no way to move
              every version to a phone.
            </p>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} onClick={closeMobileQr}>
              Done
            </button>
            <button
              type="button"
              className={styles.outlineBtn}
              onClick={() => void handleMobileQr()}
              disabled={mobileQrBusy}
            >
              {mobileQrBusy ? 'Preparing…' : 'New code'}
            </button>
          </div>
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
          {!rotated.keyFileStored && (
            <p className={styles.warning}>
              Your older keys could not be backed up to your account, so version{' '}
              {rotated.newVersion - 1} and earlier now exist only on this device. Files encrypted
              before today will not open anywhere else until this succeeds.
              {rotated.keyFileError ? ` The server said: ${rotated.keyFileError}` : ''}{' '}
              <button
                type="button"
                className={styles.inlineBtn}
                onClick={() => void handleBackUp()}
                disabled={backingUp}
              >
                {backingUp ? 'Retrying…' : 'Try again'}
              </button>
            </p>
          )}
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
