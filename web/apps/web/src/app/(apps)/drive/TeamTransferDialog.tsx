'use client';

/**
 * Move a file into a team space, or share it with one (issue #185).
 *
 * One dialog for both, because they are two answers to one question — "this file of mine should be
 * the team's business" — and a user who picked the wrong one would have picked it in a different
 * menu, discovered the difference afterwards, and in the *move* case had no way back. Putting them
 * side by side is what makes the difference legible at the moment it matters: the mode is a choice
 * inside the dialog, each option says what happens to ownership, and Move carries the warning that
 * Share does not need.
 *
 * The dialog is offered only when `canTransferToTeams` — both flags — and hidden entirely when the
 * caller belongs to no teams, since every option would be an empty list.
 */

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Users } from 'lucide-react';
import {
  Alert,
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Radio,
  RadioGroup,
  Select,
  Spinner,
  Text,
  useToast,
} from '@neutrino/ui';
import { useUser } from '@neutrino/auth';
import { teamsApi, type FileItem, type TeamShareRole } from '@/lib/api';
import { describeKeyHandover, handFileKeyToTeam } from '@/lib/teamTransfer';
import styles from './TeamTransferDialog.module.css';

type Mode = 'share' | 'move';

interface Props {
  file: FileItem;
  onClose: () => void;
}

export function TeamTransferDialog({ file, onClose }: Props) {
  const qc = useQueryClient();
  const currentUser = useUser();
  const { success, error: toastError } = useToast();

  const [mode, setMode] = useState<Mode>('share');
  const [teamId, setTeamId] = useState<string>('');
  const [role, setRole] = useState<TeamShareRole>('viewer');

  const { data: teams, isLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: () => teamsApi.list(),
  });

  // Only teams the caller may add content to. A Viewer's teams are listed nowhere here, because
  // the server would refuse the transfer with a 403 and a dropdown whose entries fail is worse
  // than a shorter dropdown.
  const eligible = (teams?.teams ?? []).filter(
    (t) => !t.archived && ['owner', 'admin', 'editor', 'contributor'].includes(t.userRole)
  );
  const selected = eligible.find((t) => t.id === (teamId || eligible[0]?.id));

  const transfer = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Choose a team');

      const moved =
        mode === 'move' ? await teamsApi.moveFileIntoTeam(selected.id, file.id) : null;
      if (mode === 'share') {
        await teamsApi.shareFileWithTeam(selected.id, file.id, role);
      }

      // Only after the transfer: the key-share endpoint refuses a recipient who has no access to
      // the file yet, which until this moment every member was. See `lib/teamTransfer.ts`.
      const keys = await handFileKeyToTeam(selected.id, file.id, currentUser?.id);
      return { moved, keys };
    },
    onSuccess: ({ moved, keys }) => {
      qc.invalidateQueries({ queryKey: ['files'] });
      qc.invalidateQueries({ queryKey: ['folder-contents'] });
      qc.invalidateQueries({ queryKey: ['team-library'] });
      qc.invalidateQueries({ queryKey: ['team-shares'] });

      const keyNote = describeKeyHandover(keys);
      const headline =
        mode === 'move'
          ? `"${file.name}" now belongs to ${selected?.name}.`
          : `"${file.name}" is shared with ${selected?.name}.`;
      const lost =
        moved && moved.sharesNoLongerApplied > 0
          ? ` ${moved.sharesNoLongerApplied} existing ${
              moved.sharesNoLongerApplied === 1 ? 'share' : 'shares'
            } no longer apply.`
          : '';

      if (keyNote) toastError(`${headline}${lost} ${keyNote}`);
      else success(`${headline}${lost}`);
      onClose();
    },
    onError: (err: unknown) =>
      toastError(err instanceof Error ? err.message : 'The transfer failed.'),
  });

  return (
    <Modal open onClose={onClose} title="Add to a team space" size="sm">
      <ModalHeader title="Add to a team space" onClose={onClose} />
      <ModalBody>
        {isLoading ? (
          <div className={styles.loading}>
            <Spinner size="md" />
          </div>
        ) : eligible.length === 0 ? (
          <Alert
            variant="info"
            message="You are not in a team you can add files to. Join or create one from Team Spaces first."
          />
        ) : (
          <div className={styles.body}>
            <Select
              label="Team"
              value={selected?.id ?? ''}
              onChange={(e) => setTeamId(e.target.value)}
              options={eligible.map((t) => ({ value: t.id, label: t.name }))}
            />

            <RadioGroup label="What should happen to this file?" name="team-transfer-mode">
              <Radio
                name="team-transfer-mode"
                value="share"
                checked={mode === 'share'}
                onChange={() => setMode('share')}
                label="Share it with the team"
                description="The file stays in your Drive and stays yours. You can stop sharing it at any time."
              />
              <Radio
                name="team-transfer-mode"
                value="move"
                checked={mode === 'move'}
                onChange={() => setMode('move')}
                label="Move it into the team"
                description="The file leaves your Drive and belongs to the team. This cannot be undone."
              />
            </RadioGroup>

            {mode === 'share' ? (
              <Select
                label="The team can"
                value={role}
                onChange={(e) => setRole(e.target.value as TeamShareRole)}
                options={[
                  { value: 'viewer', label: 'View the file' },
                  { value: 'editor', label: 'Edit the file' },
                ]}
              />
            ) : (
              <Alert
                variant="warning"
                title="This cannot be undone"
                message={
                  <Text size="sm">
                    Once the file is the team&apos;s, its members decide who can open it — including
                    you. Anyone you have shared it with individually will lose access, and you will
                    not be able to share it outside the team.
                  </Text>
                }
              />
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => transfer.mutate()}
          disabled={!selected || transfer.isPending}
          loading={transfer.isPending}
          variant={mode === 'move' ? 'danger' : 'primary'}
        >
          {mode === 'move' ? <ArrowRightLeft size={16} /> : <Users size={16} />}
          {mode === 'move' ? 'Move into team' : 'Share with team'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
