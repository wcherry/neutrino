'use client';

/**
 * Picking where something goes.
 *
 * Two kinds of destination sit in one browser: the caller's own Drive, and — for a single file,
 * where the deployment has Team Spaces and transfers on — a team's library. They are one list
 * because they answer one question, "where should this live?", and a picker that covered only half
 * of it is what put moving a file into a team behind its own menu entry and its own dialog.
 *
 * What the two do is *not* the same, and the dialog says so at the moment it matters rather than in
 * the list: a move within My Drive is a filing decision, and a move into a team gives the file away
 * for good. So a team destination arms the warning and turns the confirm button red, and the root
 * level has no breadcrumb at all — "My Drive" as the only crumb above a list of My Drive folders
 * was a label for the thing you were already looking at.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Modal, ModalHeader, ModalBody, Button, Text, Spinner, TeamAvatar } from '@neutrino/ui';
import { Folder, ChevronRight } from 'lucide-react';
import {
  filesystemApi,
  teamsApi,
  useUser,
  type Folder as FolderItem,
  type Team,
} from '@/lib/api';
import styles from './MoveFolderDialog.module.css';

interface Props {
  itemName: string;
  currentFolderId?: string | null;
  /**
   * Teams the item may be moved into. Empty (the default) offers My Drive alone, which is what
   * every caller moving a folder or a selection gets: the server moves one *file* into a team and
   * has no route for anything else.
   */
  teams?: Team[];
  onMove: (targetFolderId: string | null) => void;
  /** Required for `teams` to have any effect. */
  onMoveIntoTeam?: (teamId: string, folderId: string | null) => void;
  onClose: () => void;
  isPending?: boolean;
}

interface BreadcrumbEntry {
  id: string | null;
  name: string;
}

/** Where the browser currently is. `team` is null in My Drive. */
interface Location {
  team: Team | null;
  folderId: string | null;
}

export function MoveFolderDialog({
  itemName,
  currentFolderId,
  teams = [],
  onMove,
  onMoveIntoTeam,
  onClose,
  isPending,
}: Props) {
  const currentUser = useUser();
  const [location, setLocation] = useState<Location>({ team: null, folderId: null });
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([]);

  const teamsOffered = onMoveIntoTeam ? teams : [];
  const { team, folderId } = location;

  const drive = useQuery({
    queryKey: ['move-folder-browse', folderId, currentUser?.id],
    queryFn: () =>
      filesystemApi.getFolderContents(folderId ?? currentUser!.id, {
        limit: 200,
        offset: 0,
        orderBy: 'name',
        direction: 'asc',
      }),
    enabled: !team && (!!folderId || !!currentUser),
  });

  // A team's library is browsed with the team's own listing: its folders are team rows, and the
  // Drive folder endpoint would not return them.
  const library = useQuery({
    queryKey: ['move-team-browse', team?.id, folderId],
    queryFn: () => teamsApi.listLibrary(team!.id, folderId ?? undefined),
    enabled: !!team,
  });

  const isLoading = team ? library.isLoading : drive.isLoading;
  const folders: Array<{ id: string; name: string; color?: string | null }> = team
    ? (library.data?.folders ?? [])
    : ((drive.data?.folders ?? []) as FolderItem[]);

  function navigateInto(next: { id: string; name: string }) {
    setLocation((prev) => ({ ...prev, folderId: next.id }));
    setBreadcrumbs((prev) => [...prev, { id: next.id, name: next.name }]);
  }

  function navigateIntoTeam(next: Team) {
    setLocation({ team: next, folderId: null });
    setBreadcrumbs([{ id: null, name: next.name }]);
  }

  function navigateTo(index: number) {
    // Index -1 is the root of the browser: back out of a team entirely, or to My Drive's top.
    if (index < 0) {
      setLocation({ team: null, folderId: null });
      setBreadcrumbs([]);
      return;
    }
    setLocation((prev) => ({ ...prev, folderId: breadcrumbs[index].id }));
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  }

  // Only meaningful in My Drive: a team library is never where the file already is, since a file
  // that has been moved into a team is no longer in the mover's Drive to be moved again.
  const isCurrentLocation = !team && folderId === (currentFolderId ?? null);

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title={`Move "${itemName}"`} onClose={onClose} />
      <ModalBody>
        {breadcrumbs.length > 0 && (
          <div className={styles.breadcrumbs}>
            <button
              type="button"
              className={styles.crumb}
              onClick={() => navigateTo(-1)}
              disabled={isPending}
            >
              {team ? 'All destinations' : 'My Drive'}
            </button>
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={crumb.id ?? `root-${i}`}>
                <ChevronRight size={12} className={styles.chevron} />
                <button
                  type="button"
                  className={[styles.crumb, i === breadcrumbs.length - 1 ? styles.crumbActive : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => i < breadcrumbs.length - 1 && navigateTo(i)}
                  disabled={i === breadcrumbs.length - 1}
                >
                  {i === 0 && team && (
                    <TeamAvatar
                      name={team.name}
                      color={team.avatarColor}
                      emoji={team.avatarEmoji}
                      size="xs"
                    />
                  )}
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        <div className={styles.folderList}>
          {isLoading ? (
            <div className={styles.loading}><Spinner size="sm" /></div>
          ) : folders.length === 0 && teamsOffered.length === 0 ? (
            <Text size="sm" color="muted" className={styles.empty}>No folders here</Text>
          ) : (
            <>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className={styles.folderRow}
                  onClick={() => navigateInto(folder)}
                >
                  <Folder
                    size={16}
                    className={styles.folderIcon}
                    style={{ color: folder.color ?? 'var(--color-amber, #d97706)' }}
                  />
                  <Text size="sm" truncate>{folder.name}</Text>
                  <ChevronRight size={14} className={styles.folderChevron} />
                </button>
              ))}

              {/* Teams are destinations at the top level only — a team inside a team's library is
                  not a place, and a team folder is reached by opening the team. */}
              {breadcrumbs.length === 0 &&
                teamsOffered.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={styles.folderRow}
                    onClick={() => navigateIntoTeam(t)}
                  >
                    <TeamAvatar name={t.name} color={t.avatarColor} emoji={t.avatarEmoji} size="xs" />
                    <Text size="sm" truncate>{t.name}</Text>
                    <ChevronRight size={14} className={styles.folderChevron} />
                  </button>
                ))}
            </>
          )}
        </div>

        {team && (
          <Alert
            className={styles.warning}
            variant="warning"
            title="This cannot be undone"
            message={
              <Text size="sm">
                The file leaves your Drive and belongs to {team.name}. Its members decide who can
                open it — including you — anyone you have shared it with individually will lose
                access, and you will not be able to share it outside the team.
              </Text>
            }
          />
        )}

        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            variant={team ? 'danger' : 'primary'}
            size="sm"
            onClick={() =>
              team ? onMoveIntoTeam?.(team.id, folderId) : onMove(folderId)
            }
            disabled={isPending || isCurrentLocation}
          >
            {isPending ? 'Moving…' : team ? 'Move into team' : 'Move here'}
          </Button>
        </div>
      </ModalBody>
    </Modal>
  );
}
