'use client';

import React from 'react';
import type { RemoteUser } from '../hooks/useDiagramCollab';
import styles from './PresenceBar.module.css';

interface PresenceBarProps {
  users: RemoteUser[];
  connected: boolean;
}

export function PresenceBar({ users, connected }: PresenceBarProps) {
  if (!connected && users.length === 0) return null;

  return (
    <div className={styles.bar}>
      {connected && (
        <div className={styles.youBadge} title="You">
          <span className={styles.dot} style={{ background: '#22c55e' }} />
          <span>You</span>
        </div>
      )}
      {users.map((u) => (
        <div
          key={u.clientId}
          className={styles.avatar}
          style={{ backgroundColor: u.color }}
          title={u.name}
        >
          {u.name.charAt(0).toUpperCase()}
        </div>
      ))}
    </div>
  );
}
