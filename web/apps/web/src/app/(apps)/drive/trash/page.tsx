'use client';

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Heading, EmptyState } from '@neutrino/ui';
import { Trash2, File, Folder } from 'lucide-react';
import { filesystemApi } from '@/lib/api';
import styles from '../shared/page.module.css';

export default function TrashPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['trash'],
    queryFn: () => filesystemApi.listTrash(),
  });

  const { mutate: emptyTrash } = useMutation({
    mutationFn: () => filesystemApi.emptyTrash(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
    },
  });

  const files = data?.files ?? [];
  const folders = data?.folders ?? [];
  const isEmpty = !isLoading && files.length === 0 && folders.length === 0;

  if (isEmpty) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <Heading level={1} size="xl">Trash</Heading>
        </div>
        <EmptyState
          icon={Trash2}
          title="Trash is empty"
          description="Files you delete will appear here for 30 days before being permanently removed."
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">Trash</Heading>
        <button type="button" onClick={() => emptyTrash()}>
          Empty trash
        </button>
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
