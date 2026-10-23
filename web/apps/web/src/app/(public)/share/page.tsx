import React, { Suspense } from 'react';
import ShareTokenClient from './ShareTokenClient';
import styles from './page.module.css';

export default function SharePage() {
  return (
    <Suspense
      fallback={(
        <div className={styles.page}>
          <div>Loading shared item…</div>
        </div>
      )}
    >
      <ShareTokenClient />
    </Suspense>
  );
}
