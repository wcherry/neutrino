'use client';

/**
 * Team Spaces from the administrator's side (issue #185).
 *
 * The tab answers one question — **which team is about to run out of room?** — so the list arrives
 * fullest first from the server rather than alphabetically, and the only thing an admin can change
 * here is a team's disk quota.
 *
 * Deliberately the outside of a team. Its name, its size and its membership count, and nothing
 * about its pages, its files or its activity: being a deployment's administrator is authority over
 * the deployment, not membership of every team on it. The server enforces that; this simply has
 * nothing to render that would breach it.
 *
 * Hidden entirely when `teamSpaces` is off, because with the flag down no team can exist and the
 * endpoint 404s — a tab that renders "failed to load" on a deployment that has deliberately not
 * enabled the feature is worse than no tab.
 */

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ProgressBar,
  Spinner,
  useToast,
} from '@neutrino/ui';
import { Archive, ArchiveRestore, HardDrive, MoreVertical, Trash2, UserCog } from 'lucide-react';
import { adminApi } from '@neutrino/api-admin';
import { ApiClientError } from '@neutrino/api-core';
import type { AdminTeam } from '@neutrino/api-admin';
import { MENU_SEPARATOR, RowActionsMenu } from './RowActionsMenu';
import type { RowActionEntry } from './RowActionsMenu';
import {
  bytesToGigabytes,
  formatBytes,
  formatLimit,
  gigabytesToBytes,
  usagePercent,
} from './bytes';
import styles from './page.module.css';

const PAGE_SIZE = 25;

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiClientError && err.message ? err.message : fallback;
}

export function TeamsTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [quotaTeam, setQuotaTeam] = useState<AdminTeam | null>(null);
  const [ownerTeam, setOwnerTeam] = useState<AdminTeam | null>(null);
  const [deleteTeam, setDeleteTeam] = useState<AdminTeam | null>(null);
  /** The row whose actions menu is open, and where its button was. */
  const [menuFor, setMenuFor] = useState<{ team: AdminTeam; x: number; y: number } | null>(null);
  const qc = useQueryClient();
  const { success: toastSuccess, error: toastError } = useToast();

  /**
   * Archive and restore are one mutation because they are one decision made in two directions, and
   * splitting them would be two copies of the same invalidate-and-toast. The state is sent rather
   * than toggled, so a stale row on screen cannot flip the wrong way.
   */
  const setArchived = useMutation({
    mutationFn: ({ team, archived }: { team: AdminTeam; archived: boolean }) =>
      adminApi.setTeamArchived(team.id, { archived }),
    onSuccess: (_updated, { team, archived }) => {
      qc.invalidateQueries({ queryKey: ['admin-teams'] });
      // The team's own screens read the same row.
      qc.invalidateQueries({ queryKey: ['team'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
      toastSuccess(archived ? `${team.name} archived.` : `${team.name} restored.`);
    },
    onError: (err) => toastError(errorMessage(err, 'Could not change the team.')),
  });

  /**
   * One row's actions.
   *
   * Ordered by how routine they are, with the separator marking where that stops: storage and
   * ownership are settings, archiving pauses the team, and deleting is below the rule because it
   * is the one that cannot be taken back from here.
   */
  const actionsFor = (team: AdminTeam): RowActionEntry[] => [
    {
      label: 'Storage limit',
      icon: <HardDrive size={14} />,
      onSelect: () => setQuotaTeam(team),
    },
    {
      label: team.owners.length === 0 ? 'Assign an owner' : 'Transfer ownership',
      icon: <UserCog size={14} />,
      // The label already says which situation this is; the hover text says what it costs.
      title:
        team.owners.length === 0
          ? 'This team has no owner — nobody can change its settings or delete it'
          : 'The current owner becomes an Admin of the team',
      onSelect: () => setOwnerTeam(team),
    },
    {
      label: team.archived ? 'Restore' : 'Archive',
      icon: team.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />,
      title: team.archived
        ? 'Members can write to it again'
        : 'Everything stays readable and nothing can be changed. Reversible.',
      disabled: setArchived.isPending,
      // No confirmation: it is reversible, and the label says which way it goes.
      onSelect: () => setArchived.mutate({ team, archived: !team.archived }),
    },
    MENU_SEPARATOR,
    {
      label: 'Delete team',
      icon: <Trash2 size={14} />,
      danger: true,
      title: 'Its pages and files go with it',
      onSelect: () => setDeleteTeam(team),
    },
  ];

  const { data, isLoading, error } = useQuery({
    // The search term is part of the key, because the two listings have different totals and
    // sharing one cache entry would page the wrong one.
    queryKey: ['admin-teams', page, search],
    queryFn: () =>
      adminApi.listTeams({
        q: search || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return <div className={styles.error}>Failed to load teams.</div>;
  }

  const teams = data?.teams ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const overQuota = teams.filter((t) => t.overQuota);

  return (
    <div className={styles.sectionWide}>
      <h2 className={styles.sectionTitle}>Team Spaces</h2>

      {/* Named rather than counted. "Two teams are over their limit" is a number to go and find;
          naming them makes the row to click obvious. */}
      {overQuota.length > 0 && (
        <div className={styles.error}>
          {overQuota.map((t) => t.name).join(', ')}{' '}
          {overQuota.length === 1 ? 'is' : 'are'} over{' '}
          {overQuota.length === 1 ? 'its' : 'their'} storage limit. Nothing has been deleted — they
          simply cannot add anything until the limit is raised or they remove something.
        </div>
      )}

      <div className={styles.teamsToolbar}>
        <input
          type="search"
          className={styles.formInput}
          placeholder="Search teams"
          value={search}
          aria-label="Search teams"
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <span className={styles.userCount}>
          {total} {total === 1 ? 'team' : 'teams'}
        </span>
      </div>

      {teams.length === 0 ? (
        <div className={styles.empty}>
          {search ? 'No team matches that search.' : 'No teams have been created yet.'}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Team</th>
                <th>Owner</th>
                <th>Visibility</th>
                <th>Members</th>
                <th>Storage</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const percent = usagePercent(team.storageUsedBytes, team.storageLimitBytes);
                return (
                  <tr key={team.id}>
                    <td>
                      {team.name}
                      {team.archived && <span className={styles.deletedBadge}>Archived</span>}
                    </td>
                    <td>
                      <Owners team={team} />
                    </td>
                    <td>{team.visibility.replace('_', ' ')}</td>
                    <td>{team.memberCount}</td>
                    <td>
                      <div className={styles.quotaCell}>
                        <span
                          className={`${styles.quotaText} ${team.overQuota ? styles.quotaOver : ''}`}
                        >
                          {formatBytes(team.storageUsedBytes)} /{' '}
                          {formatLimit(team.storageLimitBytes)}
                        </span>
                        {percent !== null && (
                          <ProgressBar
                            value={percent}
                            max={100}
                            size="sm"
                            color={percent >= 90 ? 'error' : percent >= 75 ? 'warning' : 'accent'}
                            aria-label={`Storage used by ${team.name}`}
                          />
                        )}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.moreBtn}
                        aria-label={`Actions for ${team.name}`}
                        aria-haspopup="menu"
                        aria-expanded={menuFor?.team.id === team.id}
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          setMenuFor({ team, x: r.left, y: r.bottom + 4 });
                        }}
                      >
                        <MoreVertical size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className={styles.pagination}>
          <button
            type="button"
            className={styles.pageBtn}
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span className={styles.userCount}>
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            className={styles.pageBtn}
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}

      {menuFor && (
        <RowActionsMenu
          x={menuFor.x}
          y={menuFor.y}
          entries={actionsFor(menuFor.team)}
          onClose={() => setMenuFor(null)}
          aria-label={`Actions for ${menuFor.team.name}`}
        />
      )}

      <TeamQuotaDialog team={quotaTeam} onClose={() => setQuotaTeam(null)} />
      <TeamOwnerDialog team={ownerTeam} onClose={() => setOwnerTeam(null)} />
      <DeleteTeamDialog team={deleteTeam} onClose={() => setDeleteTeam(null)} />
    </div>
  );
}

/**
 * A team's Owners, or a warning that it has none.
 *
 * An ownerless team is the state the whole transfer route exists for — the last Owner's account was
 * deleted — and it has to read as a problem rather than as an empty cell, or it is invisible in
 * exactly the listing meant to surface it.
 */
function Owners({ team }: { team: AdminTeam }) {
  if (team.owners.length === 0) {
    return <span className={styles.quotaOver}>No owner</span>;
  }
  return (
    <div className={styles.ownerCell}>
      {team.owners.map((owner) => (
        <span key={owner.userId} title={owner.email}>
          {owner.name || owner.email}
        </span>
      ))}
    </div>
  );
}

/**
 * Set or clear one team's disk quota.
 *
 * Typed in gigabytes and stored in bytes, through the same `bytes.ts` conversions the user quota
 * editor uses — so "10 GB" means the same thing on both screens. An empty field is unlimited, not
 * zero, which is why the placeholder says so.
 */
function TeamQuotaDialog({ team, onClose }: { team: AdminTeam | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { success: toastSuccess } = useToast();
  // `null` until the admin types: the form seeds from the row that was clicked, so it opens on the
  // team's real limit rather than on a placeholder that could be saved by accident.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const value = draft ?? (team ? bytesToGigabytes(team.storageLimitBytes) : '');

  const save = useMutation({
    mutationFn: () =>
      adminApi.setTeamQuota(team!.id, { storageLimitBytes: gigabytesToBytes(value) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-teams'] });
      // The team's own pages read the same column, so their cached copy is now stale.
      qc.invalidateQueries({ queryKey: ['team'] });
      toastSuccess('Storage limit saved.');
      close();
    },
    onError: (err) => setError(errorMessage(err, 'Could not save the limit. Please try again.')),
  });

  function close() {
    setDraft(null);
    setError(null);
    onClose();
  }

  const willBeOver =
    !!team && gigabytesToBytes(value) !== null && team.storageUsedBytes > gigabytesToBytes(value)!;

  return (
    <Modal open={!!team} onClose={close} size="sm">
      <ModalHeader>Storage for {team?.name}</ModalHeader>
      <ModalBody>
        {team && (
          <div className={styles.dialogForm}>
            <p className={styles.formHint}>
              Using <strong>{formatBytes(team.storageUsedBytes)}</strong> of{' '}
              <strong>{formatLimit(team.storageLimitBytes)}</strong> across {team.memberCount}{' '}
              {team.memberCount === 1 ? 'member' : 'members'}. Leave the field empty for no limit.
            </p>
            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="team-quota-limit">
                Storage limit (GB)
              </label>
              <input
                id="team-quota-limit"
                type="number"
                min={0}
                step="0.1"
                className={styles.formInput}
                value={value}
                placeholder="Unlimited"
                disabled={save.isPending}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            {/* Said before saving rather than discovered afterwards. Lowering a limit past what a
                team already stores is a legitimate thing to do and deletes nothing — but an admin
                who did not mean to should find that out here. */}
            {willBeOver && (
              <p className={styles.formHint}>
                This is below what {team.name} already stores. Nothing will be deleted; the team
                will not be able to add anything until it is under the limit again.
              </p>
            )}
            {error && <div className={styles.error}>{error}</div>}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button type="button" className={styles.cancelBtn} onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.confirmBtn}
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

/**
 * Hand a team to somebody.
 *
 * A **transfer**, and the dialog says so before it happens: whoever owns the team now is demoted to
 * Admin, not removed. That is the reading of "assign a new owner" that matches the situation — the
 * previous Owner has left — and the one an admin would otherwise discover afterwards from the team.
 *
 * By email, because an administrator doing this is reading a leavers list or a ticket. The account
 * has to exist; an address nobody has claimed would leave the team exactly as ownerless as it was.
 */
function TeamOwnerDialog({ team, onClose }: { team: AdminTeam | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { success: toastSuccess } = useToast();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => adminApi.setTeamOwner(team!.id, { email: email.trim() }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['admin-teams'] });
      qc.invalidateQueries({ queryKey: ['team'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
      toastSuccess(
        `${team?.name} now belongs to ${updated.owners[0]?.name ?? email.trim()}.`
      );
      close();
    },
    onError: (err) => setError(errorMessage(err, 'Could not transfer the team.')),
  });

  function close() {
    setEmail('');
    setError(null);
    onClose();
  }

  const current = team?.owners ?? [];

  return (
    <Modal open={!!team} onClose={close} size="sm">
      <ModalHeader>Owner of {team?.name}</ModalHeader>
      <ModalBody>
        {team && (
          <div className={styles.dialogForm}>
            <p className={styles.formHint}>
              {current.length === 0 ? (
                <>
                  This team has <strong>no owner</strong> — nobody can change its settings, invite
                  anyone, or delete it. Give it to someone to put that right.
                </>
              ) : (
                <>
                  Currently owned by{' '}
                  <strong>{current.map((o) => o.name || o.email).join(', ')}</strong>.
                </>
              )}
            </p>
            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="team-owner-email">
                New owner’s email address
              </label>
              <input
                id="team-owner-email"
                type="email"
                className={styles.formInput}
                value={email}
                placeholder="someone@example.com"
                disabled={save.isPending}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {current.length > 0 && (
              <p className={styles.formHint}>
                {current.map((o) => o.name || o.email).join(', ')} will become{' '}
                {current.length === 1 ? 'an Admin' : 'Admins'} of the team — still able to do
                everything except delete it or hand it on. They are not removed, so this is one
                click back. If the new owner is not in the team yet, they will be added.
              </p>
            )}
            {error && <div className={styles.error}>{error}</div>}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button type="button" className={styles.cancelBtn} onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.confirmBtn}
          disabled={!email.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Transferring…' : 'Transfer ownership'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

/**
 * Delete a team, with the name typed back.
 *
 * The delete is soft server-side, so the row and everything cascading off it survive — but nothing
 * in this console lists a deleted team, so from here it is one way. Typing the name is what turns
 * an accidental click on a row into a deliberate act; it is the same guard the account danger zone
 * uses, and it is here for the same reason: the button sits in a table, one row away from Archive.
 */
function DeleteTeamDialog({ team, onClose }: { team: AdminTeam | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { success: toastSuccess } = useToast();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => adminApi.deleteTeam(team!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-teams'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
      toastSuccess(`${team?.name} deleted.`);
      close();
    },
    onError: (err) => setError(errorMessage(err, 'Could not delete the team.')),
  });

  function close() {
    setTyped('');
    setError(null);
    onClose();
  }

  const confirmed = !!team && typed.trim() === team.name;

  return (
    <Modal open={!!team} onClose={close} size="sm">
      <ModalHeader>Delete {team?.name}?</ModalHeader>
      <ModalBody>
        {team && (
          <div className={styles.dialogForm}>
            <p className={styles.formHint}>
              The team’s pages and its file library go with it, and its {team.memberCount}{' '}
              {team.memberCount === 1 ? 'member' : 'members'} lose access to all of it. If you only
              want to stop work on it, <strong>archive it instead</strong> — that is reversible and
              leaves everything readable.
            </p>
            <div className={styles.formField}>
              <label className={styles.formLabel} htmlFor="team-delete-confirm">
                Type <strong>{team.name}</strong> to confirm
              </label>
              <input
                id="team-delete-confirm"
                type="text"
                className={styles.formInput}
                value={typed}
                disabled={remove.isPending}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
            {error && <div className={styles.error}>{error}</div>}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button type="button" className={styles.cancelBtn} onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.deleteBtn}
          disabled={!confirmed || remove.isPending}
          onClick={() => remove.mutate()}
        >
          {remove.isPending ? 'Deleting…' : 'Delete team'}
        </button>
      </ModalFooter>
    </Modal>
  );
}
