'use client';

/**
 * One Team Space (issue #185).
 *
 * The team's own sidebar — Home, Pages with its tree, Files, Members, Settings — beside whichever
 * view is open. Which view, and which page, live in the URL rather than in component state, so a
 * page inside a team is linkable and the browser's Back button walks the wiki.
 *
 * Query parameters rather than route segments because the app builds with `output: 'export'`; see
 * `teamHref.ts`.
 */

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileText, Files, Home, Settings, Users } from 'lucide-react';
import { EmptyState, Spinner } from '@neutrino/ui';
import { buildPageTree, flattenPageTree, teamsApi } from '@neutrino/api-drive';
import { useFeatureFlags, useFeatureFlagsLoaded } from '@/providers/FeatureFlagsProvider';
import { parseTeamView, teamHref, type TeamView } from '../teamHref';
import { FilesView } from './FilesView';
import { MembersView } from './MembersView';
import { PagesView } from './PagesView';
import { SettingsView } from './SettingsView';
import styles from './space.module.css';

const NAV: Array<{ view: TeamView; label: string; icon: typeof Home }> = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'pages', label: 'Pages', icon: FileText },
  { view: 'files', label: 'Files', icon: Files },
  { view: 'members', label: 'Members', icon: Users },
  { view: 'settings', label: 'Settings', icon: Settings },
];

function TeamSpace() {
  const router = useRouter();
  const params = useSearchParams();
  const flags = useFeatureFlags();
  const flagsLoaded = useFeatureFlagsLoaded();

  const teamId = params.get('id');
  const view = parseTeamView(params.get('view'));
  const pageParam = params.get('page');
  const [search, setSearch] = useState('');

  const { data: team, isLoading, error } = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => teamsApi.get(teamId!),
    enabled: !!teamId && flags.teamSpaces,
  });

  // The tree is one request for the whole team; the sidebar and the Pages list read the same copy,
  // so opening the tree does not cost a request per level.
  const { data: pagesData } = useQuery({
    queryKey: ['team-pages', teamId, search],
    queryFn: () => teamsApi.listPages(teamId!, search || undefined),
    enabled: !!teamId && flags.teamSpaces,
  });

  const pages = useMemo(() => pagesData?.pages ?? [], [pagesData]);
  const tree = useMemo(() => flattenPageTree(buildPageTree(pages)), [pages]);

  const homePageId = useMemo(
    () => team?.defaultPageId ?? pages.find((p) => p.isHome)?.id ?? null,
    [team, pages]
  );

  // Home *is* a page, so the Home nav entry opens the team's Home page rather than a separate
  // screen — the difference between the two would only be visible as a second thing to maintain.
  const activePageId = view === 'home' ? homePageId : pageParam;

  const go = (nextView: TeamView, pageId?: string) => {
    if (!teamId) return;
    router.push(teamHref(teamId, nextView, pageId));
  };

  // Search only means something in the page tree; carrying a filter into Files or Members would
  // show a filtered sidebar next to an unfiltered screen.
  useEffect(() => {
    if (view !== 'pages') setSearch('');
  }, [view]);

  if (flagsLoaded && !flags.teamSpaces) {
    return (
      <EmptyState
        icon={Users}
        title="Team Spaces is not enabled"
        description="An administrator can turn it on under Admin → Feature Flags."
      />
    );
  }

  if (!teamId) {
    return (
      <EmptyState
        icon={Users}
        title="No team selected"
        description="Open a Team Space from Shared Spaces."
      />
    );
  }

  if (!flagsLoaded || isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error || !team) {
    // A team the caller is not in answers 404, and so does one that does not exist — deliberately
    // indistinguishable, so this message covers both without claiming to know which.
    return (
      <EmptyState
        icon={Users}
        title="Team not found"
        description="It may have been deleted, or you may no longer be a member."
      />
    );
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar} aria-label={`${team.name} navigation`}>
        <div className={styles.teamHeader}>
          <span
            className={styles.avatar}
            style={{ ['--team-avatar-color' as string]: team.avatarColor ?? undefined }}
            aria-hidden
          >
            {team.avatarEmoji || team.name.trim().charAt(0).toUpperCase()}
          </span>
          <span className={styles.teamName}>{team.name}</span>
        </div>

        <div className={styles.nav}>
          {NAV.map(({ view: v, label, icon: Icon }) => (
            <button
              key={v}
              type="button"
              className={`${styles.navItem} ${view === v ? styles.navItemActive : ''}`}
              onClick={() => go(v)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {tree.length > 0 && (
          <>
            <div className={styles.navSectionLabel}>Pages</div>
            <div className={styles.nav}>
              {tree.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className={`${styles.treeItem} ${
                    activePageId === node.id ? styles.treeItemActive : ''
                  }`}
                  style={{ paddingLeft: `calc(var(--space-2) + ${node.depth * 12}px)` }}
                  onClick={() => go('pages', node.id)}
                  title={node.title}
                >
                  <span aria-hidden>{node.icon || '📄'}</span>
                  <span className={styles.treeLabel}>{node.title}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </nav>

      <div className={styles.main}>
        <div className={styles.mainInner}>
          {(view === 'home' || view === 'pages') && (
            <PagesView
              team={team}
              pages={pages}
              activePageId={activePageId}
              onSelectPage={(pageId) => go('pages', pageId ?? undefined)}
              search={search}
              onSearchChange={setSearch}
            />
          )}
          {view === 'files' && <FilesView team={team} />}
          {view === 'members' && (
            <MembersView team={team} onLeft={() => router.push('/teams')} />
          )}
          {view === 'settings' && (
            <SettingsView team={team} onDeleted={() => router.push('/teams')} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function TeamSpacePage() {
  // `useSearchParams` needs a Suspense boundary in the App Router, and this route is entirely
  // driven by the query string.
  return (
    <Suspense
      fallback={
        <div className={styles.loading}>
          <Spinner size="md" />
        </div>
      }
    >
      <TeamSpace />
    </Suspense>
  );
}
