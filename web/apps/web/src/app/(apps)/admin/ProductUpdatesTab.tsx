'use client';

/**
 * Product updates: the "What's new" part of the weekly email.
 *
 * An administrator writes an update as a draft, publishes it, and the next weekly email carries
 * every update published during its week to each account with "Product updates" email on. Unpublish
 * takes one back before it goes out; after that it has been sent. "Preview my weekly email" shows
 * what the caller's own email would say for the last seven days, drafts left out.
 */

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Spinner, TextInput, Textarea, useToast } from '@neutrino/ui';
import { productUpdatesApi, type ProductUpdate, type WeeklyEmailPreview } from '@neutrino/api-admin';
import styles from './page.module.css';

const KEY = ['admin', 'product-updates'] as const;

function formatDate(naive: string): string {
  const at = new Date(naive.endsWith('Z') ? naive : `${naive}Z`);
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The editor for a new update or an existing one. */
function UpdateForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: ProductUpdate;
  onSave: (body: { title: string; body: string }) => void;
  onCancel?: () => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  return (
    <form
      className={styles.section}
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ title, body });
      }}
    >
      <TextInput label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      <Textarea
        label="Update"
        hint="Plain text. Leave a blank line between paragraphs."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        required
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="submit" size="sm" loading={saving} disabled={!title.trim() || !body.trim()}>
          {initial ? 'Save' : 'Save draft'}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function ProductUpdatesTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const [preview, setPreview] = useState<WeeklyEmailPreview | null | undefined>(undefined);

  const { data: updates, isLoading, isError } = useQuery({ queryKey: KEY, queryFn: () => productUpdatesApi.list() });

  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const fail = (err: unknown) => toast.error(err instanceof Error ? err.message : 'Something went wrong');

  const create = useMutation({
    mutationFn: productUpdatesApi.create,
    onSuccess: () => {
      setComposerKey((k) => k + 1);
      void refresh();
    },
    onError: fail,
  });
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { title: string; body: string } }) => productUpdatesApi.edit(id, body),
    onSuccess: () => {
      setEditing(null);
      void refresh();
    },
    onError: fail,
  });
  const publish = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) => productUpdatesApi.setPublished(id, published),
    onSuccess: () => void refresh(),
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: productUpdatesApi.remove,
    onSuccess: () => void refresh(),
    onError: fail,
  });
  const previewEmail = useMutation({
    mutationFn: productUpdatesApi.previewWeeklyEmail,
    onSuccess: setPreview,
    onError: fail,
  });

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>New product update</h2>
        <p style={{ margin: 0, fontSize: 'var(--font-size-13)', color: 'var(--color-text-secondary)' }}>
          Published updates go out in the next weekly email, on Monday, to everyone with Product updates
          email on.
        </p>
        <UpdateForm key={composerKey} onSave={(body) => create.mutate(body)} saving={create.isPending} />
      </section>

      <section className={`${styles.section} ${styles.sectionWide}`}>
        <h2 className={styles.sectionTitle}>Updates</h2>
        {isLoading ? (
          <Spinner />
        ) : isError ? (
          <p role="alert">Could not load product updates.</p>
        ) : !updates || updates.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>No updates yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {updates.map((u) =>
                  editing === u.id ? (
                    <tr key={u.id}>
                      <td colSpan={3}>
                        <UpdateForm
                          initial={u}
                          onSave={(body) => edit.mutate({ id: u.id, body })}
                          onCancel={() => setEditing(null)}
                          saving={edit.isPending}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr key={u.id}>
                      <td>{u.title}</td>
                      <td>{u.publishedAt ? `Published ${formatDate(u.publishedAt)}` : 'Draft'}</td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(u.id)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant={u.publishedAt ? 'secondary' : 'primary'}
                          onClick={() => publish.mutate({ id: u.id, published: !u.publishedAt })}
                        >
                          {u.publishedAt ? 'Unpublish' : 'Publish'}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            if (window.confirm(`Delete “${u.title}”?`)) remove.mutate(u.id);
                          }}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Weekly email</h2>
        <div>
          <Button size="sm" variant="secondary" loading={previewEmail.isPending} onClick={() => previewEmail.mutate()}>
            Preview my weekly email
          </Button>
        </div>
        {preview === null && (
          <p role="status" style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
            Your last seven days held nothing to tell, so you wouldn’t get an email this week.
          </p>
        )}
        {preview && (
          <div role="region" aria-label="Weekly email preview">
            <p style={{ margin: '0 0 8px', fontWeight: 600 }}>{preview.subject}</p>
            {/* Sandboxed: the HTML is the server's, but it quotes names other people chose. */}
            <iframe
              title="Weekly email preview"
              sandbox=""
              srcDoc={preview.html}
              style={{ width: '100%', height: 480, border: '1px solid var(--color-border)', borderRadius: 8 }}
            />
          </div>
        )}
      </section>
    </>
  );
}
