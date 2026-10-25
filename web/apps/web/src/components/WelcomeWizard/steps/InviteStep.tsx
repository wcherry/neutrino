'use client';

/**
 * Step 7: `InviteFriendsPanel` as it is — the personal link (Copy, Share…), addresses, a note and
 * Send N invites — with the rules of the two kinds of invitation said above it.
 */

import React from 'react';
import { InviteFriendsPanel } from '@/components/InviteFriends';
import { useStep } from '../stepApi';
import styles from './Steps.module.css';

export function InviteStep() {
  const { markDone } = useStep();
  return (
    <div className={styles.stack}>
      <p className={styles.hint}>
        Invitations sent by email work once and expire after 14 days. Your personal link can be used
        by several people until it expires after 14 days, and Reset link stops the old one working
        straight away.
      </p>
      <InviteFriendsPanel showSentList={false} onSent={markDone} onLinkUsed={markDone} />
    </div>
  );
}
