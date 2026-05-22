'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Heading, EmptyState } from '@neutrino/ui';
import { Star, File, Folder } from 'lucide-react';
import { filesystemApi } from '@/lib/api';
import styles from '../shared/page.module.css';

export default function StarredPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['starred-page'],
    queryFn: () => filesystemApi.getStarred(50),
  });

  const files = data?.files ?? [];
  const folders = data?.folders ?? [];
  const isEmpty = !isLoading && files.length === 0 && folders.length === 0;

  if (isEmpty) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <Heading level={1} size="xl">Starred</Heading>
        </div>
        <EmptyState
          icon={Star}
          title="No starred files"
          description="Star files and folders to quickly find them here."
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">Starred</Heading>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {folders.map((folder) => (
          <li key={folder.id} aria-label={folder.name} style={{ padding: '8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Folder size={16} />
            <span>{folder.name}</span>
          </li>
        ))}
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
