'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Heading, EmptyState } from '@neutrino/ui';
import { Clock, File } from 'lucide-react';
import { filesystemApi } from '@/lib/api';
import styles from '../shared/page.module.css';

export default function RecentPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['recent'],
    queryFn: () => filesystemApi.getRootContents({ view: 'recent', limit: 50 }),
  });

  const files = data?.files ?? [];

  if (!isLoading && files.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <Heading level={1} size="xl">Recent</Heading>
        </div>
        <EmptyState
          icon={Clock}
          title="No recent files"
          description="Files you open or edit will appear here."
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">Recent</Heading>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {files.map((file) => (
          <li key={file.id} aria-label={file.name} style={{ padding: '8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <File size={16} />
            <span>{file.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
