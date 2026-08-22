'use client';

/**
 * Shown when someone's encryption key has changed since we last sealed to it.
 *
 * The sharer is stopped here rather than warned: at the point this opens we are
 * about to hand a file's DEK to a key we cannot vouch for, and a warning the
 * user can click past is exactly how key-substitution attacks succeed in
 * practice. Nothing is sealed until they choose "Trust the new key".
 *
 * Both fingerprints are shown, not just the new one. The old one is what makes
 * the change legible — a user who has verified this contact before may recognise
 * the value they wrote down, and either way seeing two distinct strings conveys
 * "this is not who it was" better than a single unfamiliar one.
 *
 * There is no "remind me later": the alternative to trusting the key is not
 * sharing, which is what closing the dialog does.
 */

import React from 'react';
import { Modal, ModalBody, ModalFooter, ModalHeader, Button, Alert } from '@neutrino/ui';
import { ShieldAlert } from 'lucide-react';
import styles from './KeyChangeDialog.module.css';

export interface KeyChangeDialogProps {
  /** Display name or email of the person being shared with. */
  recipientLabel: string;
  /** Fingerprint of the key we pinned previously. */
  previousFingerprint: string;
  /** Fingerprint of the key the server is offering now. */
  offeredFingerprint: string;
  /** ISO timestamp of when the previous key was first pinned. */
  firstSeen: string;
  /** Whether the previous key had been confirmed out of band. */
  wasVerified: boolean;
  /** Trust the new key, pin it, and continue the share. */
  onTrust: () => void;
  /** Abandon the share. */
  onCancel: () => void;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'an earlier session';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function KeyChangeDialog({
  recipientLabel,
  previousFingerprint,
  offeredFingerprint,
  firstSeen,
  wasVerified,
  onTrust,
  onCancel,
}: KeyChangeDialogProps) {
  return (
    <Modal open onClose={onCancel} size="md">
      <ModalHeader>
        <ShieldAlert size={18} /> {recipientLabel}&rsquo;s encryption key has changed
      </ModalHeader>
      <ModalBody>
        <div className={styles.body}>
          <Alert
            variant="warning"
            message="This file has not been shared. Sharing it now would encrypt it to a key we cannot vouch for."
          />

          <p className={styles.intro}>
            The key we recorded for {recipientLabel} on {formatDate(firstSeen)} is not the one being
            offered now. That happens when someone sets up a new device or rotates their key
            deliberately &mdash; but it is also what an attacker substituting their own key looks
            like, and from here the two are indistinguishable.
          </p>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Previously {wasVerified ? 'verified' : 'seen'}</p>
            <div className={`${styles.fingerprint} ${styles.previous}`}>{previousFingerprint}</div>
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Offered now</p>
            <div className={styles.fingerprint}>{offeredFingerprint}</div>
          </div>

          <p className={styles.intro}>
            Ask {recipientLabel} to read their key fingerprint aloud &mdash; by phone or in person,
            not through this app. If it matches the value offered now, the change is genuine.
          </p>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel}>
          Don&rsquo;t share
        </Button>
        <Button variant="danger" onClick={onTrust}>
          I verified it &mdash; trust the new key
        </Button>
      </ModalFooter>
    </Modal>
  );
}
