'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Spinner, useToast } from '@neutrino/ui';
import { diagramsApi } from '@neutrino/api-diagrams';
import { GitBranch, Plus, Trash2, Clock } from 'lucide-react';
import { TemplatePickerModal } from './TemplatePickerModal';
import type { DiagramTemplate } from './editor/templates/diagramTemplates';
import styles from './page.module.css';

const TEMPLATE_SESSION_KEY_PREFIX = 'neutrino:diagram-template:';

export default function DiagramsPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['diagrams'],
    queryFn: () => diagramsApi.listDiagrams(),
  });

  const createMutation = useMutation({
    mutationFn: (template: DiagramTemplate) => diagramsApi.createDiagram({
      title: template.id === 'blank' ? 'Untitled diagram' : template.name,
    }),
    onSuccess: (diagram, template) => {
      if (template.id !== 'blank') {
        // The diagram is created blank; the editor seeds the template's starter
        // content client-side (see DiagramEditor.tsx) so it goes through the
        // same e2e-encrypted save path as any other edit, not a plaintext
        // server-side write.
        try {
          sessionStorage.setItem(`${TEMPLATE_SESSION_KEY_PREFIX}${diagram.id}`, JSON.stringify(template.build()));
        } catch {
          // sessionStorage unavailable — the diagram still opens, just blank
        }
      }
      router.push(`/diagrams/editor?id=${diagram.id}`);
    },
    onError: () => toast.error('Failed to create diagram'),
    onSettled: () => setCreating(false),
  });

  const handlePickTemplate = (template: DiagramTemplate) => {
    setCreating(true);
    setShowTemplatePicker(false);
    createMutation.mutate(template);
  };

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
          onClick={() => setShowTemplatePicker(true)}
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
            onClick={() => setShowTemplatePicker(true)}
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

      <TemplatePickerModal
        open={showTemplatePicker}
        onClose={() => setShowTemplatePicker(false)}
        onSelect={handlePickTemplate}
        busy={creating || createMutation.isPending}
      />
    </div>
  );
}
