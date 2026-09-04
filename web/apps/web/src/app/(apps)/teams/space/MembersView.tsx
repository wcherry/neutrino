'use client';

/**
 * Members and their roles (issue #185, phase 6).
 *
 * The role picker's options are filtered by what the caller may grant, not just by what exists: an
 * Admin cannot make someone an Owner, and offering the option so the server can refuse it is a
 * worse way to say so. The server checks the same thing — this is the affordance, not the rule.
 */

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import {
  AlertDialog,
  Button,
  Heading,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  Spinner,
  Text,
  TextInput,
  useToast,
} from '@neutrino/ui';
import {
  teamsApi,
  TEAM_ROLES,
  TEAM_ROLE_DESCRIPTIONS,
  TEAM_ROLE_LABELS,
  type Team,
  type TeamJoinRequest,
  type TeamMember,
  type TeamRole,
} from '@neutrino/api-drive';
import { useUser } from '@neutrino/auth';
import { teamCan } from '../permissions';
import styles from './space.module.css';

/** The roles this caller may hand out. Only an Owner can create another Owner. */
function grantableRoles(actorRole: TeamRole): TeamRole[] {
  return TEAM_ROLES.filter((role) => role !== 'owner' || actorRole === 'owner');
}

function AddMemberDialog({
  team,
  open,
  onClose,
}: {
  team: Team;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { success, error: toastError } = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('editor');

  const add = useMutation({
    mutationFn: () => teamsApi.addMember(team.id, email.trim(), role),
    onSuccess: () => {
      setEmail('');
      qc.invalidateQueries({ queryKey: ['team-members', team.id] });
      qc.invalidateQueries({ queryKey: ['team', team.id] });
      success('Added to the team.');
      onClose();
    },
    onError: (e: unknown) => {
      toastError(e instanceof Error ? e.message : 'Could not add that person.');
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Add a member" size="sm">
      <ModalHeader title="Add a member" onClose={onClose} />
      <ModalBody>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="member-email">
            Email address
          </label>
          <TextInput
            id="member-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            autoFocus
          />
          <span className={styles.hint}>They need a Neutrino account already.</span>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="member-role">
            Role
          </label>
          <Select
            id="member-role"
            value={role}
            onChange={(e) => setRole(e.target.value as TeamRole)}
            options={grantableRoles(team.userRole).map((r) => ({
              value: r,
              label: TEAM_ROLE_LABELS[r],
            }))}
          />
          <span className={styles.hint}>{TEAM_ROLE_DESCRIPTIONS[role]}</span>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={add.isPending}>
          Cancel
        </Button>
        <Button
          onClick={() => add.mutate()}
          disabled={!email.trim() || add.isPending}
          loading={add.isPending}
        >
          Add
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/**
 * People who have asked to join, waiting on an answer.
 *
 * Only reachable for an Owner or Admin — the server refuses the listing to anyone else, so the
 * query is not even run for them. Only rendered when the team is `invite_only`: no other
 * visibility can produce a request, and an empty panel on a private team would be a question
 * nobody asked.
 */
function JoinRequestsPanel({ team }: { team: Team }) {
  const qc = useQueryClient();
  const { success, error: toastError } = useToast();
  const canAnswer = teamCan(team, 'inviteMember');
  const relevant = canAnswer && team.visibility === 'invite_only' && !team.archived;

  const { data } = useQuery({
    queryKey: ['team-join-requests', team.id],
    queryFn: () => teamsApi.listJoinRequests(team.id),
    enabled: relevant,
  });

  const settle = () => {
    qc.invalidateQueries({ queryKey: ['team-join-requests', team.id] });
    qc.invalidateQueries({ queryKey: ['team-members', team.id] });
    qc.invalidateQueries({ queryKey: ['team', team.id] });
  };

  const approve = useMutation({
    mutationFn: ({ id, role }: { id: string; role: TeamRole }) =>
      teamsApi.approveJoinRequest(team.id, id, role),
    onSuccess: () => {
      settle();
      success('Added to the team.');
    },
    onError: (e: unknown) =>
      toastError(e instanceof Error ? e.message : 'Could not approve that request.'),
  });

  const decline = useMutation({
    mutationFn: (id: string) => teamsApi.declineJoinRequest(team.id, id),
    onSuccess: () => {
      settle();
      success('Request declined.');
    },
    onError: (e: unknown) =>
      toastError(e instanceof Error ? e.message : 'Could not decline that request.'),
  });

  const requests = data?.requests ?? [];
  if (!relevant || requests.length === 0) return null;

  return (
    <section className={styles.requests}>
      <div className={styles.pageHeaderText}>
        <Heading level={2} size="md">
          Requests to join ({requests.length})
        </Heading>
        <Text size="sm" color="secondary">
          Approving admits them as a Viewer unless you pick another role.
        </Text>
      </div>

      <div className={styles.list}>
        {requests.map((r) => (
          <RequestRow
            key={r.id}
            request={r}
            actorRole={team.userRole}
            busy={approve.isPending || decline.isPending}
            onApprove={(role) => approve.mutate({ id: r.id, role })}
            onDecline={() => decline.mutate(r.id)}
          />
        ))}
      </div>
    </section>
  );
}

function RequestRow({
  request,
  actorRole,
  busy,
  onApprove,
  onDecline,
}: {
  request: TeamJoinRequest;
  actorRole: TeamRole;
  busy: boolean;
  onApprove: (role: TeamRole) => void;
  onDecline: () => void;
}) {
  const [role, setRole] = useState<TeamRole>('viewer');

  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.rowTitle}>{request.name}</span>
        <span className={styles.rowMeta}>{request.email}</span>
        {request.message && <span className={styles.requestMessage}>“{request.message}”</span>}
      </div>
      <div className={styles.rowActions}>
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value as TeamRole)}
          aria-label={`Role for ${request.name}`}
          options={grantableRoles(actorRole).map((r) => ({
            value: r,
            label: TEAM_ROLE_LABELS[r],
          }))}
        />
        <Button size="sm" disabled={busy} onClick={() => onApprove(role)}>
          Approve
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDecline}>
          Decline
        </Button>
      </div>
    </div>
  );
}

export function MembersView({ team, onLeft }: { team: Team; onLeft: () => void }) {
  const qc = useQueryClient();
  const currentUser = useUser();
  const { success, error: toastError } = useToast();
  const [adding, setAdding] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<TeamMember | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['team-members', team.id],
    queryFn: () => teamsApi.listMembers(team.id),
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: TeamRole }) =>
      teamsApi.updateMember(team.id, userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-members', team.id] });
      qc.invalidateQueries({ queryKey: ['team', team.id] });
      success('Role updated.');
    },
    onError: (e: unknown) => {
      toastError(e instanceof Error ? e.message : 'Could not change that role.');
    },
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => teamsApi.removeMember(team.id, userId),
    onSuccess: (_data, userId) => {
      setPendingRemove(null);
      // Leaving means losing the team: every route for it now answers 404, so stay on this screen
      // and it would immediately fail to load.
      if (userId === currentUser?.id) {
        qc.invalidateQueries({ queryKey: ['teams'] });
        onLeft();
        return;
      }
      qc.invalidateQueries({ queryKey: ['team-members', team.id] });
      qc.invalidateQueries({ queryKey: ['team', team.id] });
      success('Removed from the team.');
    },
    onError: (e: unknown) => {
      toastError(e instanceof Error ? e.message : 'Could not remove that person.');
    },
  });

  const canManage = teamCan(team, 'managePermissions');
  const canInvite = teamCan(team, 'inviteMember');
  const members = data?.members ?? [];

  return (
    <>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderText}>
          <Heading level={1} size="lg">
            Members
          </Heading>
          <Text size="sm" color="secondary">
            Membership decides who can see everything in this team.
          </Text>
        </div>
        {canInvite && (
          <div className={styles.actions}>
            <Button onClick={() => setAdding(true)}>
              <UserPlus size={16} /> Add member
            </Button>
          </div>
        )}
      </div>

      <JoinRequestsPanel team={team} />

      {isLoading ? (
        <div className={styles.loading}>
          <Spinner size="md" />
        </div>
      ) : (
        <div className={styles.list}>
          {members.map((member) => {
            const isSelf = member.userId === currentUser?.id;
            return (
              <div key={member.userId} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    {member.name}
                    {isSelf ? ' (you)' : ''}
                  </span>
                  <span className={styles.rowMeta}>{member.email}</span>
                </div>
                <div className={styles.rowActions}>
                  {canManage && !team.archived ? (
                    <Select
                      value={member.role}
                      aria-label={`Role for ${member.name}`}
                      onChange={(e) =>
                        changeRole.mutate({
                          userId: member.userId,
                          role: e.target.value as TeamRole,
                        })
                      }
                      options={grantableRoles(team.userRole).map((r) => ({
                        value: r,
                        label: TEAM_ROLE_LABELS[r],
                      }))}
                    />
                  ) : (
                    <span className={styles.rowMeta}>{TEAM_ROLE_LABELS[member.role]}</span>
                  )}
                  {/* Leaving is not managing permissions, so anyone in the team can do it for
                      themselves — including a Viewer, who can do nothing else here. */}
                  {(canManage || isSelf) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPendingRemove(member)}
                    >
                      {isSelf ? 'Leave' : 'Remove'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AddMemberDialog team={team} open={adding} onClose={() => setAdding(false)} />

      <AlertDialog
        open={!!pendingRemove}
        onClose={() => setPendingRemove(null)}
        variant="warning"
        title={
          pendingRemove?.userId === currentUser?.id
            ? `Leave ${team.name}?`
            : `Remove ${pendingRemove?.name ?? ''}?`
        }
        description={
          pendingRemove?.userId === currentUser?.id
            ? 'You will lose access to this team’s pages and files.'
            : 'They lose access to this team’s pages and files. Anything they wrote stays.'
        }
        confirmLabel={pendingRemove?.userId === currentUser?.id ? 'Leave' : 'Remove'}
        loading={removeMember.isPending}
        onConfirm={() => pendingRemove && removeMember.mutate(pendingRemove.userId)}
      />
    </>
  );
}
