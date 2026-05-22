'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Trash2, Star, ArrowLeft, Sparkles } from 'lucide-react';
import { docsTemplates, type DocTemplate } from '@/lib/api';
import styles from './page.module.css';

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  return <span className={styles.badge}>{category}</span>;
}

interface TemplateCardProps {
  template: DocTemplate;
  onUse: (id: string) => void;
  onDelete?: (id: string) => void;
  loading?: boolean;
}

function TemplateCard({ template, onUse, onDelete, loading }: TemplateCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.cardPreview}>
        <FileText size={40} color="#4285f4" />
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitle}>
            {template.isDefault && <Star size={12} className={styles.defaultStar} />}
            {template.name}
          </div>
          <CategoryBadge category={template.category} />
        </div>
        {template.description && (
          <div className={styles.cardDesc}>{template.description}</div>
        )}
      </div>
      <div className={styles.cardActions}>
        <button
          className={styles.useBtn}
          onClick={() => onUse(template.id)}
          disabled={loading}
        >
          {loading ? 'Creating...' : 'Use Template'}
        </button>
        {!template.isSystem && onDelete && (
          <button
            className={styles.deleteBtn}
            onClick={() => onDelete(template.id)}
            aria-label="Delete template"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function DocsTemplatesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [usingId, setUsingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['doc-templates'],
    queryFn: () => docsTemplates.list(),
  });

  const useTemplateMutation = useMutation({
    mutationFn: (id: string) => docsTemplates.use(id),
    onMutate: (id) => setUsingId(id),
    onSuccess: (res) => {
      router.push(`/docs/editor?id=${res.docId}`);
    },
    onError: () => setUsingId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => docsTemplates.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['doc-templates'] }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      docsTemplates.create({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        category: newCategory.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doc-templates'] });
      setShowCreateForm(false);
      setNewName('');
      setNewDesc('');
      setNewCategory('');
    },
  });

  const templates = data?.templates ?? [];
  const systemTemplates = templates.filter((t) => t.isSystem);
  const customTemplates = templates.filter((t) => !t.isSystem);

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <button className={styles.backBtn} onClick={() => router.push('/docs')}>
          <ArrowLeft size={16} />
          Back to Docs
        </button>
        <h1 className={styles.pageTitle}>
          <Sparkles size={20} />
          Document Templates
        </h1>
        <button
          className={styles.newBtn}
          onClick={() => setShowCreateForm((v) => !v)}
        >
          <Plus size={15} />
          New Template
        </button>
      </div>

      {showCreateForm && (
        <div className={styles.createForm}>
          <h3 className={styles.formTitle}>Create Template</h3>
          <input
            className={styles.input}
            placeholder="Template name *"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className={styles.input}
            placeholder="Description (optional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
          <input
            className={styles.input}
            placeholder="Category (optional)"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
          />
          <div className={styles.formActions}>
            <button
              className={styles.cancelBtn}
              onClick={() => setShowCreateForm(false)}
            >
              Cancel
            </button>
            <button
              className={styles.saveBtn}
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      <div className={styles.content}>
        {isLoading && <div className={styles.loading}>Loading templates...</div>}
        {isError && (
          <div className={styles.error}>Failed to load templates. Please try again.</div>
        )}

        {!isLoading && !isError && (
          <>
            {systemTemplates.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>System Templates</h2>
                <div className={styles.grid}>
                  {systemTemplates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      onUse={(id) => useTemplateMutation.mutate(id)}
                      loading={usingId === template.id && useTemplateMutation.isPending}
                    />
                  ))}
                </div>
              </section>
            )}

            {customTemplates.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>My Templates</h2>
                <div className={styles.grid}>
                  {customTemplates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      onUse={(id) => useTemplateMutation.mutate(id)}
                      onDelete={(id) => {
                        if (confirm('Delete this template?')) deleteMutation.mutate(id);
                      }}
                      loading={usingId === template.id && useTemplateMutation.isPending}
                    />
                  ))}
                </div>
              </section>
            )}

            {templates.length === 0 && (
              <div className={styles.empty}>No templates available.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
