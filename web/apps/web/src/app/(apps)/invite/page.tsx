'use client';

/**
 * `/invite` — the Invite friends panel as a page of its own, for a link to send
 * someone to (the welcome email, a share dialog's "they need an account" hint)
 * where opening the account-menu dialog is not an option.
 */

import { InviteFriendsPanel } from '@/components/InviteFriends/InviteFriendsPanel';
import styles from '@/components/InviteFriends/InviteFriends.module.css';

export default function InvitePage() {
  return (
    <div className={styles.pageWrap}>
      <h1 className={styles.pageHeading}>Invite friends</h1>
      <p className={styles.pageIntro}>
        Sharing an encrypted file needs the other person to have a key. Invite them and it just works.
      </p>
      <InviteFriendsPanel />
    </div>
  );
}
