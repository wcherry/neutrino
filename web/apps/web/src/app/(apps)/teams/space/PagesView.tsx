'use client';

/**
 * The wiki (issue #185, phases 2 and 3).
 *
 * One page at a time, read or edited in place. The editor is a markdown textarea rather than a
 * rich-text surface: a page is stored as markdown, and a WYSIWYG editor over it would need a
 * round-trip between the two representations that neither the design doc nor the storage format
 * asks for. `renderMarkdown` is what turns it back into a page.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, History, Plus, Save, Trash2, X } from 'lucide-react';
import {
  AlertDialog,
  Button,
  EmptyState,
  Heading,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  SearchInput,
  Spinner,
  Text,
  TextInput,
  useToast,
} from '@neutrino/ui';
import {
  teamsApi,
  type Team,
  type TeamPage,
  type TeamPageVersion,
} from '@neutrino/api-drive';
import { renderMarkdown } from '../markdown';
import { teamCan } from '../permissions';
import styles from './space.module.css';

/** The trail from a page up to the top of the tree, root first. */
function breadcrumbTrail(pages: TeamPage[], pageId: string): TeamPage[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const trail: TeamPage[] = [];
  let cursor = byId.get(pageId);
  // Bounded for the same reason the server bounds its walk: a cycle that predates the server's
  // check would otherwise hang the sidebar.
  for (let i = 0; cursor && i < 100; i += 1) {
    trail.unshift(cursor);
    cursor = cursor.parentPageId ? byId.get(cursor.parentPageId) : undefined;
  }
  return trail;
}

function VersionHistoryDialog({
  team,
  page,
  open,
  onClose,
}: {
  team: Team;
  page: TeamPage;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { success, error: toastError } = useToast();
  const [preview, setPreview] = useState<TeamPageVersion | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['team-page-versions', team.id, page.id],
    queryFn: () => teamsApi.listPageVersions(team.id, page.id),
    enabled: open,
  });

  const restore = useMutation({
    mutationFn: (versionId: string) =>
      teamsApi.restorePageVersion(team.id, page.id, versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-page', team.id, page.id] });
      qc.invalidateQueries({ queryKey: ['team-page-versions', team.id, page.id] });
      qc.invalidateQueries({ queryKey: ['team-pages', team.id] });
      success('Version restored. The version it replaced was saved first.');
      onClose();
    },
    onError: () => toastError('Could not restore that version.'),
  });

  const versions = data?.versions ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Version history" size="lg">
      <ModalHeader title="Version history" onClose={onClose} />
      <ModalBody>
        {isLoading && (
          <div className={styles.loading}>
            <Spinner size="md" />
          </div>
        )}
        {!isLoading && versions.length === 0 && (
          <Text size="sm" color="secondary">
            No versions yet. One is recorded each time the page&rsquo;s content changes.
          </Text>
        )}
        {versions.length > 0 && (
          <div className={styles.list}>
            {versions.map((v) => (
              <div key={v.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    v{v.versionNumber}
                    {v.label ? ` — ${v.label}` : ''}
                  </span>
                  <span className={styles.rowMeta}>
                    {v.createdByName} · {new Date(v.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className={styles.rowActions}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      setPreview(await teamsApi.getPageVersion(team.id, page.id, v.id));
                    }}
                  >
                    Preview
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => restore.mutate(v.id)}
                    disabled={restore.isPending}
                  >
                    Restore
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {preview && (
          <>
            <Heading level={3} size="sm">
              v{preview.versionNumber} — {preview.title}
            </Heading>
            <div className={styles.markdown}>{renderMarkdown(preview.contentMd ?? '')}</div>
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function NewPageDialog({
  team,
  parentPageId,
  open,
  onClose,
  onCreated,
}: {
  team: Team;
  parentPageId?: string;
  open: boolean;
  onClose: () => void;
  onCreated: (page: TeamPage) => void;
}) {
  const [title, setTitle] = useState('');
  const { error: toastError } = useToast();

  const create = useMutation({
    mutationFn: () => teamsApi.createPage(team.id, { title: title.trim(), parentPageId }),
    onSuccess: (page) => {
      setTitle('');
      onCreated(page);
    },
    onError: () => toastError('Could not create the page.'),
  });

  return (
    <Modal open={open} onClose={onClose} title="New page" size="sm">
      <ModalHeader title="New page" onClose={onClose} />
      <ModalBody>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="page-title">
            Title
          </label>
          <TextInput
            id="page-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Meeting notes"
            autoFocus
          />
          {parentPageId && (
            <span className={styles.hint}>Created inside the page you have open.</span>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button
          onClick={() => create.mutate()}
          disabled={!title.trim() || create.isPending}
          loading={create.isPending}
        >
          Create
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function PagesView({
  team,
  pages,
  activePageId,
  onSelectPage,
  search,
  onSearchChange,
}: {
  team: Team;
  pages: TeamPage[];
  activePageId: string | null;
  onSelectPage: (pageId: string | null) => void;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const qc = useQueryClient();
  const { success, error: toastError } = useToast();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: page, isLoading } = useQuery({
    queryKey: ['team-page', team.id, activePageId],
    queryFn: () => teamsApi.getPage(team.id, activePageId!),
    enabled: !!activePageId,
  });

  // Leaving edit mode on navigation is deliberate: a draft carried across pages would be written
  // to whichever page happened to be open when Save was pressed.
  useEffect(() => {
    setEditing(false);
    setShowHistory(false);
  }, [activePageId]);

  const save = useMutation({
    mutationFn: () =>
      teamsApi.updatePage(team.id, activePageId!, {
        title: draftTitle.trim() || undefined,
        contentMd: draft,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-page', team.id, activePageId] });
      qc.invalidateQueries({ queryKey: ['team-pages', team.id] });
      setEditing(false);
      success('Page saved.');
    },
    onError: () => toastError('Could not save the page.'),
  });

  const duplicate = useMutation({
    mutationFn: () => teamsApi.duplicatePage(team.id, activePageId!),
    onSuccess: (copy) => {
      qc.invalidateQueries({ queryKey: ['team-pages', team.id] });
      onSelectPage(copy.id);
    },
    onError: () => toastError('Could not duplicate the page.'),
  });

  const remove = useMutation({
    mutationFn: () => teamsApi.deletePage(team.id, activePageId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-pages', team.id] });
      setConfirmDelete(false);
      onSelectPage(null);
      success('Page deleted.');
    },
    onError: () => toastError('Could not delete the page.'),
  });

  const trail = useMemo(
    () => (activePageId ? breadcrumbTrail(pages, activePageId) : []),
    [pages, activePageId]
  );

  const canEdit = teamCan(team, 'editPage');
  const canCreate = teamCan(team, 'createPage');
  const canDelete = teamCan(team, 'deletePage');

  if (!activePageId) {
    return (
      <>
        <div className={styles.pageHeader}>
          <div className={styles.pageHeaderText}>
            <Heading level={1} size="lg">
              Pages
            </Heading>
            <Text size="sm" color="secondary">
              {pages.length} page{pages.length === 1 ? '' : 's'} in this team.
            </Text>
          </div>
          <div className={styles.actions}>
            <SearchInput
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search pages"
            />
            {canCreate && (
              <Button onClick={() => setCreating(true)}>
                <Plus size={16} /> New page
              </Button>
            )}
          </div>
        </div>
        {pages.length === 0 ? (
          <EmptyState
            title={search ? 'No pages match that search' : 'No pages yet'}
            description={
              search
                ? 'Try a different word — search looks at page titles and their content.'
                : 'Pages are where a team keeps what it knows that is not a file.'
            }
          />
        ) : (
          <div className={styles.list}>
            {pages.map((p) => (
              <div key={p.id} className={styles.row}>
                <button
                  type="button"
                  className={styles.rowButton}
                  onClick={() => onSelectPage(p.id)}
                >
                  <span className={styles.rowTitle}>
                    {p.icon ? `${p.icon} ` : ''}
                    {p.title}
                  </span>
                  <span className={styles.rowMeta}>
                    Updated {new Date(p.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
        <NewPageDialog
          team={team}
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ['team-pages', team.id] });
            onSelectPage(created.id);
          }}
        />
      </>
    );
  }

  if (isLoading || !page) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <>
      {trail.length > 1 && (
        <div className={styles.breadcrumbs}>
          {trail.map((crumb, i) => (
            <React.Fragment key={crumb.id}>
              {i > 0 && <span>/</span>}
              <button
                type="button"
                className={styles.crumb}
                onClick={() => onSelectPage(crumb.id)}
              >
                {crumb.title}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderText}>
          {editing ? (
            <TextInput
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              aria-label="Page title"
            />
          ) : (
            <Heading level={1} size="lg">
              {page.icon ? `${page.icon} ` : ''}
              {page.title}
            </Heading>
          )}
          <Text size="sm" color="secondary">
            Updated {new Date(page.updatedAt).toLocaleString()}
          </Text>
        </div>

        <div className={styles.actions}>
          {editing ? (
            <>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={save.isPending}>
                <X size={16} /> Cancel
              </Button>
              <Button onClick={() => save.mutate()} loading={save.isPending}>
                <Save size={16} /> Save
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setShowHistory(true)}>
                <History size={16} /> History
              </Button>
              {canCreate && (
                <Button variant="ghost" onClick={() => duplicate.mutate()}>
                  <Copy size={16} /> Duplicate
                </Button>
              )}
              {/* The Home page has no delete: the team is guaranteed to have exactly one, and the
                  server refuses. Hiding the button is how that reads as a rule rather than a
                  failure. */}
              {canDelete && !page.isHome && (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={16} /> Delete
                </Button>
              )}
              {canCreate && (
                <Button variant="ghost" onClick={() => setCreating(true)}>
                  <Plus size={16} /> Subpage
                </Button>
              )}
              {canEdit && (
                <Button
                  onClick={() => {
                    setDraft(page.contentMd ?? '');
                    setDraftTitle(page.title);
                    setEditing(true);
                  }}
                >
                  Edit
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {editing ? (
        <>
          <textarea
            className={styles.editor}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Page content, markdown"
          />
          <span className={styles.hint}>
            Markdown. Headings, lists, task lists, tables, code blocks, links and images. Saving
            records a version of what the page held before.
          </span>
        </>
      ) : (
        <div className={styles.markdown}>{renderMarkdown(page.contentMd ?? '')}</div>
      )}

      <VersionHistoryDialog
        team={team}
        page={page}
        open={showHistory}
        onClose={() => setShowHistory(false)}
      />

      <NewPageDialog
        team={team}
        parentPageId={page.id}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['team-pages', team.id] });
          onSelectPage(created.id);
        }}
      />

      <AlertDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        variant="warning"
        title={`Delete "${page.title}"?`}
        description="Its subpages are deleted with it."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
