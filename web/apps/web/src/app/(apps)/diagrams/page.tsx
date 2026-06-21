'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Spinner, useToast } from '@neutrino/ui';
import { diagramsApi } from '@neutrino/api-diagrams';
import { GitBranch, Plus, Trash2, Clock } from 'lucide-react';
import styles from './page.module.css';

export default function DiagramsPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['diagrams'],
    queryFn: () => diagramsApi.listDiagrams(),
  });

  const createMutation = useMutation({
    mutationFn: () => diagramsApi.createDiagram({ title: 'Untitled diagram' }),
    onSuccess: (diagram) => {
      router.push(`/diagrams/editor?id=${diagram.id}`);
    },
    onError: () => toast.error('Failed to create diagram'),
    onSettled: () => setCreating(false),
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="lg" />
      </div>
    );
  }

  const diagrams = data?.diagrams ?? [];

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h1 className={styles.title}>Diagrams</h1>
        <button
          className={styles.createBtn}
          onClick={() => {
            setCreating(true);
            createMutation.mutate();
          }}
          disabled={creating || createMutation.isPending}
        >
          <Plus size={16} />
          New diagram
        </button>
      </div>

      {diagrams.length === 0 ? (
        <div className={styles.empty}>
          <GitBranch size={48} className={styles.emptyIcon} />
          <h3>No diagrams yet</h3>
          <p>Create your first diagram to get started.</p>
          <button
            className={styles.createBtn}
            onClick={() => {
              setCreating(true);
              createMutation.mutate();
            }}
            disabled={creating || createMutation.isPending}
          >
            <Plus size={16} />
            New diagram
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {diagrams.map((d) => (
            <div
              key={d.id}
              className={styles.card}
              onClick={() => router.push(`/diagrams/editor?id=${d.id}`)}
            >
              <div className={styles.cardThumb}>
                <GitBranch size={32} className={styles.thumbIcon} />
              </div>
              <div className={styles.cardBody}>
                <div className={styles.cardTitle}>{d.title}</div>
                <div className={styles.cardMeta}>
                  <Clock size={11} />
                  {new Date(d.updatedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
