'use client';

import React from 'react';
import type { RemoteUser } from '@/hooks/usePresence';
import styles from './PresenceBar.module.css';
import './remoteCursors.css';

interface PresenceBarProps {
  users: RemoteUser[];
  /** Whether the WebSocket is currently connected. */
  connected: boolean;
}

/** Renders colored avatar circles for each connected remote user. */
export function PresenceBar({ users, connected }: PresenceBarProps) {
  if (!connected && users.length === 0) return null;

  return (
    <div className={styles.bar} aria-label="Active collaborators">
      {users.map(u => (
        <div
          key={u.clientId}
          className={styles.avatar}
          style={{ backgroundColor: u.color }}
          title={u.name}
          aria-label={u.name}
        >
          {u.name.charAt(0).toUpperCase()}
        </div>
      ))}
      {connected && users.length === 0 && (
        <span className={styles.alone} title="Only you are editing">
          ● You
        </span>
      )}
    </div>
  );
}
