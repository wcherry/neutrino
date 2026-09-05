'use client';

/**
 * Team settings (issue #185, phase 1).
 *
 * Archive and Delete are deliberately different things and are presented as such. Archiving makes
 * the team read-only and reversible — a project that ended, not a mistake — and is offered to
 * Owners and Admins. Deleting takes the pages and files with it and is the Owner's alone.
 */

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  Button,
  Heading,
  Select,
  Text,
  TextInput,
  Textarea,
  useToast,
} from '@neutrino/ui';
import { teamsApi, type Team, type TeamVisibility } from '@neutrino/api-drive';
import { roleCan, teamCan } from '../permissions';
import styles from './space.module.css';

const VISIBILITY_OPTIONS: Array<{ value: TeamVisibility; label: string; hint: string }> = [
  { value: 'private', label: 'Private', hint: 'Only members can find this team.' },
  { value: 'invite_only', label: 'Invite only', hint: 'Members can be added by an admin.' },
  {
    value: 'organization',
    label: 'Organization',
    hint: 'Anyone in the organization can find it.',
  },
];

export function SettingsView({ team, onDeleted }: { team: Team; onDeleted: () => void }) {
  const qc = useQueryClient();
  const { success, error: toastError } = useToast();

  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? '');
  const [visibility, setVisibility] = useState<TeamVisibility>(team.visibility);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['team', team.id] });
    qc.invalidateQueries({ queryKey: ['teams'] });
  };

  const save = useMutation({
    mutationFn: () =>
      teamsApi.update(team.id, {
        name: name.trim(),
        description: description.trim() || null,
        visibility,
      }),
    onSuccess: () => {
      invalidate();
      success('Settings saved.');
    },
    onError: () => toastError('Could not save the settings.'),
  });

  const setArchived = useMutation({
    mutationFn: (archived: boolean) => teamsApi.update(team.id, { archived }),
    onSuccess: (_data, archived) => {
      invalidate();
      success(archived ? 'Team archived.' : 'Team restored.');
    },
    onError: () => toastError('Could not change the team’s state.'),
  });

  const remove = useMutation({
    mutationFn: () => teamsApi.remove(team.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      onDeleted();
    },
    onError: () => toastError('Could not delete the team.'),
  });

  // Restoring is a write on an archived team, which `teamCan` refuses on principle — so it is
  // checked against the role alone, the way the server does.
  const canManage = teamCan(team, 'manageSettings');
  const canRestore = roleCan(team.userRole, 'manageSettings');
  const canDelete = roleCan(team.userRole, 'deleteTeam');

  return (
    <>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderText}>
          <Heading level={1} size="lg">
            Settings
          </Heading>
        </div>
      </div>

      {team.archived && (
        <div className={styles.archivedNotice}>
          This team is archived. Its pages and files are readable, and nothing can be changed until
          it is restored.
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="settings-name">
          Name
        </label>
        <TextInput
          id="settings-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canManage}
        />
        <span className={styles.hint}>
          Renaming does not change the team&rsquo;s address ({team.slug}), so links into it keep
          working.
        </span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="settings-description">
          Description
        </label>
        <Textarea
          id="settings-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          disabled={!canManage}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="settings-visibility">
          Visibility
        </label>
        <Select
          id="settings-visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as TeamVisibility)}
          disabled={!canManage}
          options={VISIBILITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        <span className={styles.hint}>
          {VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.hint}
        </span>
      </div>

      {canManage && (
        <div className={styles.actions}>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
            Save changes
          </Button>
        </div>
      )}

      {(canRestore || canDelete) && (
        <div className={styles.dangerZone}>
          <Heading level={2} size="sm">
            Danger zone
          </Heading>

          {canRestore && (
            <div className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  {team.archived ? 'Restore this team' : 'Archive this team'}
                </span>
                <span className={styles.rowMeta}>
                  {team.archived
                    ? 'Members can write to it again.'
                    : 'Everything stays readable and nothing can be changed. Reversible.'}
                </span>
              </div>
              <Button
                variant="secondary"
                onClick={() => setArchived.mutate(!team.archived)}
                loading={setArchived.isPending}
              >
                {team.archived ? (
                  <>
                    <ArchiveRestore size={16} /> Restore
                  </>
                ) : (
                  <>
                    <Archive size={16} /> Archive
                  </>
                )}
              </Button>
            </div>
          )}

          {canDelete && (
            <div className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>Delete this team</span>
                <span className={styles.rowMeta}>
                  Its pages and files go with it. Only the owner can do this.
                </span>
              </div>
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} /> Delete
              </Button>
            </div>
          )}
        </div>
      )}

      <AlertDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        variant="error"
        title={`Delete ${team.name}?`}
        description={
          <Text size="sm" color="secondary">
            The team&rsquo;s pages and its file library go with it. If you only want to stop work on
            it, archive it instead.
          </Text>
        }
        confirmLabel="Delete team"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
