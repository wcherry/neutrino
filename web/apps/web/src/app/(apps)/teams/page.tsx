'use client';

/**
 * Shared Spaces — the list of teams the signed-in person belongs to (issue #185, phase 1).
 *
 * Replaces Shared Drives in the navigation when `teamSpaces` is on. With the flag off this route
 * still exists but says so rather than 404ing at the router: the API answers 404 for every team
 * route while the flag is off, and "not found" on a page the sidebar did not link to is a worse
 * explanation than the real one.
 */

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Plus } from 'lucide-react';
import {
  Button,
  EmptyState,
  Heading,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Text,
  TextInput,
  Textarea,
  useToast,
} from '@neutrino/ui';
import { teamsApi, type Team } from '@neutrino/api-drive';
import { useFeatureFlags, useFeatureFlagsLoaded } from '@/providers/FeatureFlagsProvider';
import { teamHref } from './teamHref';
import styles from './page.module.css';

/**
 * The avatar colours a team can be given.
 *
 * A fixed palette rather than a free colour picker: the avatar's job is to make one team findable
 * among a dozen in a sidebar, which a set of clearly distinct colours does and an arbitrary hex
 * does not.
 */
const AVATAR_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0891b2',
];

function teamInitial(team: Team): string {
  return team.avatarEmoji || team.name.trim().charAt(0).toUpperCase() || '?';
}

function CreateTeamDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (team: Team) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(AVATAR_COLORS[0]);
  const [emoji, setEmoji] = useState('');
  const { error: toastError } = useToast();

  const create = useMutation({
    mutationFn: () =>
      teamsApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        avatarColor: color,
        avatarEmoji: emoji.trim() || undefined,
      }),
    onSuccess: (team) => {
      setName('');
      setDescription('');
      setEmoji('');
      onCreated(team);
    },
    onError: (e: unknown) => {
      toastError(e instanceof Error ? e.message : 'Could not create the team.');
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="New Team Space" size="md">
      <ModalHeader title="New Team Space" onClose={onClose} />
      <ModalBody>
        <div className={styles.dialogBody}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="team-name">
              Name
            </label>
            <TextInput
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Marketing"
              autoFocus
            />
            <span className={styles.hint}>
              The team gets a Home page you can start writing in straight away.
            </span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="team-description">
              Description <span className={styles.hint}>(optional)</span>
            </label>
            <Textarea
              id="team-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this team is for."
              rows={2}
            />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Avatar</span>
            <div className={styles.colorRow}>
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Avatar colour ${c}`}
                  aria-pressed={c === color}
                  className={`${styles.colorSwatch} ${c === color ? styles.colorSwatchActive : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <TextInput
              value={emoji}
              onChange={(e) => setEmoji(e.target.value.slice(0, 2))}
              placeholder="An emoji, optional"
              aria-label="Avatar emoji"
            />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button
          onClick={() => create.mutate()}
          disabled={!name.trim() || create.isPending}
          loading={create.isPending}
        >
          Create
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default function SharedSpacesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const flags = useFeatureFlags();
  const flagsLoaded = useFeatureFlagsLoaded();
  const [creating, setCreating] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['teams'],
    queryFn: () => teamsApi.list(),
    // Nothing to ask for while the feature is off — every team route answers 404.
    enabled: flags.teamSpaces,
  });

  const teams = useMemo(() => data?.teams ?? [], [data]);

  if (flagsLoaded && !flags.teamSpaces) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <Heading level={1} size="xl">
            Shared Spaces
          </Heading>
        </div>
        <EmptyState
          icon={Users}
          title="Team Spaces is not enabled"
          description="An administrator can turn it on under Admin → Feature Flags."
        />
      </div>
    );
  }

  if (!flagsLoaded || isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>
          <Spinner size="md" />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <Heading level={1} size="xl">
            Shared Spaces
          </Heading>
          <Text size="sm" color="secondary">
            A team owns its pages, its files and its members.
          </Text>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} /> New Team
        </Button>
      </div>

      {error && <div className={styles.error}>Could not load your Team Spaces.</div>}

      {!error && teams.length === 0 && (
        <EmptyState
          icon={Users}
          title="No Team Spaces yet"
          description="A Team Space gives a group somewhere to keep its pages, its files and everything it knows that isn't a document."
          action={<Button onClick={() => setCreating(true)}>Create your first team</Button>}
        />
      )}

      {teams.length > 0 && (
        <div className={styles.grid}>
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              className={styles.card}
              onClick={() => router.push(teamHref(team.id))}
            >
              <div className={styles.cardTop}>
                <span
                  className={styles.avatar}
                  style={{ ['--team-avatar-color' as string]: team.avatarColor ?? undefined }}
                  aria-hidden
                >
                  {teamInitial(team)}
                </span>
                <span className={styles.cardName}>{team.name}</span>
              </div>
              {team.description && (
                <span className={styles.cardDescription}>{team.description}</span>
              )}
              <span className={styles.cardMeta}>
                <span>
                  {team.memberCount} member{team.memberCount === 1 ? '' : 's'}
                </span>
                <span>·</span>
                <span>You are {team.userRole === 'admin' ? 'an' : 'a'} {team.userRole}</span>
                {team.archived && <span className={styles.archivedBadge}>Archived</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      <CreateTeamDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(team) => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['teams'] });
          router.push(teamHref(team.id));
        }}
      />
    </div>
  );
}
