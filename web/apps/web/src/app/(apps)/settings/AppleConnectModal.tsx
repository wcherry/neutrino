'use client';

import React, { useState } from 'react';
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from '@neutrino/ui';
import type { CreateAppleConnectionRequest } from '@/lib/api';
import styles from './AppleConnectModal.module.css';

/**
 * Apple Calendar connects by CalDAV credentials, not OAuth, so it asks for them here. Shared by
 * Settings › Calendar and the welcome wizard's Calendar step.
 */
export function AppleConnectModal({
  onClose,
  onConnect,
  isPending,
}: {
  onClose: () => void;
  onConnect: (req: CreateAppleConnectionRequest) => void;
  isPending: boolean;
}) {
  const [caldavUrl, setCaldavUrl] = useState('https://caldav.icloud.com');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!caldavUrl.trim() || !username.trim() || !password.trim()) return;
    onConnect({ caldavUrl: caldavUrl.trim(), username: username.trim(), password });
  }

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title="Connect Apple Calendar" onClose={onClose} />
      <ModalBody>
        <p className={styles.note}>
          Apple Calendar uses CalDAV. Generate an app-specific password at
          appleid.apple.com and use your Apple ID email as the username.
        </p>
        <form id="apple-connect-form" onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.group}>
            <label className={styles.label}>CalDAV Server URL</label>
            <input className={styles.input} value={caldavUrl} onChange={(e) => setCaldavUrl(e.target.value)} placeholder="https://caldav.icloud.com" required />
          </div>
          <div className={styles.group}>
            <label className={styles.label}>Apple ID (email)</label>
            <input className={styles.input} type="email" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@icloud.com" autoFocus required />
          </div>
          <div className={styles.group}>
            <label className={styles.label}>App-specific password</label>
            <input className={styles.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="xxxx-xxxx-xxxx-xxxx" required />
          </div>
        </form>
      </ModalBody>
      <ModalFooter>
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button form="apple-connect-form" type="submit" disabled={isPending}>{isPending ? 'Connecting…' : 'Connect'}</Button>
      </ModalFooter>
    </Modal>
  );
}
