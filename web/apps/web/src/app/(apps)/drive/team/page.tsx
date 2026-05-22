'use client';

import React from 'react';
import { Heading, EmptyState } from '@neutrino/ui';
import { Users } from 'lucide-react';
import styles from '../shared/page.module.css';

export default function SharedDrivesPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">Shared Drives</Heading>
      </div>
      <EmptyState
        icon={Users}
        title="No shared drives"
        description="Shared drives let your team store, search, and access files together."
      />
    </div>
  );
}
