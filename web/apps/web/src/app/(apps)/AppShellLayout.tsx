'use client';

import { useTeamCommands, useTeamPins } from '@/lib/teamResources';
import { createDocFromTemplate } from '@/lib/docTemplates';
import React, { Suspense, useEffect, useMemo, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppShell,
  CommandPalette,
  ShellSidebar,
  ShellTopBar,
  Sidebar,
  Topbar,
  type PaletteCommand,
  type ShellBrand,
  type StorageQuota,
  type TopbarSearchResult,
  type TopbarNotification,
} from '@neutrino/layout';
import {
  COMMAND_APPS,
  availableCommands,
  commandSpec,
  detectPlatform,
  formatChord,
  keysFor,
  runCommandById,
  useCommands,
  useKeymap,
  type CommandId,
} from '@neutrino/commands';
import type { NotificationItem } from '@neutrino/api-drive';
import { useToast } from '@neutrino/ui';
import {
  authApi,
  storageApi,
  tagsApi,
  teamsApi,
  uploadDriveFile,
  canEncryptFor,
  type UserProfile,
  type QuotaInfo,
} from '@/lib/api';
import { ENCRYPTION_WARNING_MESSAGE } from '@/components/EncryptionWarningMessage';
import { APP_ITEMS, getNavSections, withActiveItem } from './navSections';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import { NewItemFAB } from './NewItemFAB';
import { E2EEUnlockGate, getGateState, subscribeToGateState } from '@/components/E2EEUnlockGate';
import { TourControlsProvider, replayLabel, useTourController } from '@/components/Tour';
import { RequestStorageDialog } from '@/components/RequestStorageDialog';
import { ImportRunProvider } from '@/components/ImportRun';
import type { InviteFriendsDialogProps } from '@/components/InviteFriends/InviteFriendsDialog';
import { useNotifications } from '@/hooks/useNotifications';
import { useDriveLiveUpdates } from '@/hooks/useDriveLiveUpdates';
import { useClientSearch, type SearchHit } from '@/hooks/useClientSearch';
import { useSearchIndexSync } from '@/hooks/useSearchIndexSync';
import { useSearchIndexUpdates } from '@/hooks/useSearchIndexUpdates';
import { driveSearchHref } from './drive/searchParams';
import { BUG_REPORT_URL } from '@/lib/bugReport';
import { signInHref } from '@/lib/signInRedirect';
import { FULL_VERSION_LABEL, VERSION_LABEL } from '@/lib/version';
import { clearDriveImageCache } from '@/lib/driveImages';
import { appForPath } from '@/lib/appForPath';
import { EditorReturnTracker } from '@/lib/editorReturn';
import { useQuickAccess } from '@/hooks/useQuickAccess';
import { getFileIcon, getIconColor } from '@/lib/file-icons';
import { formatFriendlyDate } from '@neutrino/utils';
import { routeForFile } from './drive/routeForFile';
import { DRIVE_PREVIEW_PARAM } from './drive/searchParams';
import { EditorShellActionsProvider, type EditorShellActionsValue } from '@/components/editorChrome/EditorShellActions';
import { usePreferencesSync } from '@/lib/preferencesSync';
import { preferences, usePreference, usePreferencesLoaded } from '@neutrino/preferences';
import { readInstanceBrand } from '@/lib/instanceBrand';
import { applyLayout, readLayout } from '@/lib/sidebarLayout';
import shellStyles from './AppShellLayout.module.css';

/** The editors, which get the editor frame in the new shell: no top bar, their title bar first. */
const EDITOR_ROUTE = /^\/(docs|sheets|slides|diagrams|drawing)\/editor(\/|$)/;

/** Set once a tab has landed in the app, so `drive.landing` redirects only the first visit. */
const LANDED_KEY = 'neutrino.landed';

/** Where each `shell.goto.*` command goes; the app ones only while that app is enabled. */
const GOTO: { id: CommandId; href: string; app?: (typeof APP_ITEMS)[number]['app'] }[] = [
  { id: 'shell.goto.drive', href: '/drive' },
  { id: 'shell.goto.recent', href: '/drive/recent' },
  { id: 'shell.goto.shared', href: '/drive/shared' },
  ...APP_ITEMS.map((item) => ({ id: `shell.goto.${item.app}` as CommandId, href: item.href!, app: item.app })),
  { id: 'shell.goto.settings', href: '/settings' },
  { id: 'shell.goto.keyboard', href: '/settings?tab=keyboard' },
];

/** Search hits carry an icon *component* so Drive can size it its own way. */
function toTopbarResult(hit: SearchHit): TopbarSearchResult {
  const { icon: Icon, iconColor } = hit;
  return {
    id: hit.id,
    title: hit.title,
    subtitle: hit.subtitle,
    href: hit.href,
    icon: <Icon size={16} />,
    iconColor,
    modified: hit.modified,
  };
}

function notificationHref(n: NotificationItem): string | undefined {
  const payload = n.payload as Record<string, string>;
  const { resourceType, resourceId, mimeType, teamId } = payload;
  if (!resourceId) return undefined;
  // A key request is answered from the team's Files; an approved one opens the file.
  if (n.eventType === 'team_key_approved') return `/open/file/${encodeURIComponent(resourceId)}`;
  if ((n.eventType === 'team_key_requested' || n.eventType === 'team_key_denied') && teamId) {
    return `/teams/space?id=${encodeURIComponent(teamId)}&view=files`;
  }
  if (resourceType === 'folder') return `/drive`;
  // Map file mimeType to the right editor
  if (mimeType?.includes('document')) return `/docs/editor?id=${resourceId}`;
  if (mimeType?.includes('sheet') || mimeType?.includes('spreadsheet')) return `/sheets/editor?id=${resourceId}`;
  if (mimeType?.includes('slide') || mimeType?.includes('presentation')) return `/slides/editor?id=${resourceId}`;
  if (mimeType?.includes('diagram')) return `/diagrams/editor?id=${resourceId}`;
  if (mimeType?.includes('drawing')) return `/drawing/editor?id=${resourceId}`;
  return `/drive`;
}

function toTopbarNotifications(items: NotificationItem[]): TopbarNotification[] {
  return items.map((n) => ({ ...n, href: notificationHref(n) }));
}

const DEFAULT_QUOTA_BYTES = 15 * 1024 * 1024 * 1024; // 15 GB fallback when no server limit set

function quotaFromInfo(info: QuotaInfo): StorageQuota {
  return {
    usedBytes: info.usedBytes,
    totalBytes: info.quotaBytes ?? DEFAULT_QUOTA_BYTES,
  };
}

type AuthState =
  | { status: 'loading' }
  // `quotaInfo` is the server's answer as it came, kept alongside the meter's
  // reduced view of it: the meter substitutes a default for "no limit", and the
  // storage request dialog has to be able to tell those apart.
  | { status: 'ready'; user: UserProfile; quota: StorageQuota; quotaInfo: QuotaInfo | null };

// Opened from the account menu only, so it is loaded on first open and adds
// nothing to any route's first-load JS (route budgets: scripts/check-route-budgets.mjs).
const InviteFriendsDialog = dynamic<InviteFriendsDialogProps>(
  () => import('@/components/InviteFriends/InviteFriendsDialog').then((m) => ({ default: m.InviteFriendsDialog })),
  { ssr: false },
);

export function AppShellLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [requestingStorage, setRequestingStorage] = useState(false);
  const [invitingFriends, setInvitingFriends] = useState(false);
  // Stays true after the first open so the dialog can animate out; until then
  // nothing is mounted and its chunk is never fetched.
  const [inviteDialogLoaded, setInviteDialogLoaded] = useState(false);
  const [searchResults, setSearchResults] = useState<TopbarSearchResult[]>([]);
  const [searchPending, setSearchPending] = useState(false);
  const { search } = useClientSearch();
  // Nothing but the page's ground is prerendered; the shell and the route render once the page
  // has hydrated. The build cannot know which shell a user's look wants — prerendering the classic
  // one flashed it in front of anyone on a new look — nor does any page have to be safe to render
  // at build time. (Before, a spinner was prerendered in the same place.)
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // Nothing is searched server-side, so the local index has to be kept current
  // or the box would have nothing to match against.
  useSearchIndexSync(auth.status === 'ready' ? auth.user.id : undefined);
  usePreferencesSync(auth.status === 'ready' ? auth.user.id : undefined);

  const isAdmin = auth.status === 'ready' ? (auth.user.isAdmin ?? false) : false;

  // Shared with the tag picker and tag pages: one cached list feeds the
  // sidebar, the picker's filter, and tag-name matching in search.
  const { data: tagsData } = useQuery({
    queryKey: ['tags'],
    queryFn: () => tagsApi.list(),
    enabled: auth.status === 'ready',
    staleTime: 30_000,
  });
  const tags = useMemo(() => tagsData?.tags ?? [], [tagsData]);

  // Shared Drives becomes Shared Spaces when `teamSpaces` is on. The flag reads false until
  // the map arrives, so the sidebar starts as the pre-#185 one rather than flashing an entry that
  // then disappears.
  const flags = useFeatureFlags();

  // The look decides the shell: classic keeps today's (the default until the editors are done,
  // ui-roadmap.md stage 5); the three new looks get the new top bar, sidebar and editor frame.
  const [look] = usePreference('appearance.look');
  const flow = look !== 'classic';
  const chrome = EDITOR_ROUTE.test(pathname) ? 'editor' : 'full';
  const [enabledApps] = usePreference('apps.enabled');
  const [sidebarCollapsed, setSidebarCollapsed] = usePreference('shell.sidebarCollapsed');
  const brand = useMemo<ShellBrand>(() => ({ name: readInstanceBrand().name }), []);

  // Where Drive opens (`drive.landing`, U9): the logo goes there, and so does the first visit to
  // `/drive` in a tab — once, so My Drive is still one click away for the rest of the session.
  const [landing] = usePreference('drive.landing');
  const landingHref = landing === 'recent' ? '/drive/recent' : landing === 'starred' ? '/drive/starred' : '/drive';
  // Decided on the user's real value, not the default a fresh device has before the server answers.
  const prefsLoaded = usePreferencesLoaded();
  useEffect(() => {
    if (auth.status !== 'ready' || !prefsLoaded) return;
    let landed = true;
    try {
      landed = sessionStorage.getItem(LANDED_KEY) === '1';
      sessionStorage.setItem(LANDED_KEY, '1');
    } catch {
      // No session storage: never redirect rather than redirect every time.
    }
    if (!landed && landingHref !== '/drive' && window.location.pathname.replace(/\/$/, '') === '/drive' && !window.location.search) {
      router.replace(landingHref);
    }
  }, [auth.status, prefsLoaded, landingHref, router]);

  // The new sidebar lists the user's teams by name (T1); the same cached list the Teams page reads.
  const { data: teamsData } = useQuery({
    queryKey: ['teams'],
    queryFn: () => teamsApi.list(),
    enabled: auth.status === 'ready' && flags.teamSpaces && flow,
    staleTime: 30_000,
  });

  // What each team pinned for its members (T5), and its palette shortcuts (T6).
  const teamPins = useTeamPins();
  const teamCommands = useTeamCommands();

  // The user's own arrangement (U8): pins, hidden entries, the order of the apps.
  const [sidebarPref] = usePreference('shell.sidebar');
  const navSections = withActiveItem(
    applyLayout(
      getNavSections(isAdmin, tags, flags.teamSpaces, {
        enabledApps,
        teams: flow && flags.teamSpaces ? teamsData?.teams ?? [] : undefined,
        teamPins,
      }),
      readLayout(sidebarPref),
    ),
    pathname
  );

  // ── The command palette (U6) ─────────────────────────────────────────────
  // ⌘K in either shell. It lists every command the screen underneath has registered right now,
  // with the user's own keys for it, plus the shell's own navigation; the field also searches files.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteCommands, setPaletteCommands] = useState<PaletteCommand[]>([]);
  const { preset, bindings } = useKeymap();
  const platform = useMemo(() => detectPlatform(), []);
  const openPalette = useCallback(() => {
    const groups = new Map(COMMAND_APPS.map((a) => [a.id, a.label]));
    setPaletteCommands(
      availableCommands().flatMap((id): PaletteCommand[] => {
        const spec = commandSpec(id);
        if (!spec) return [];
        return [{
          id,
          title: spec.title,
          group: groups.get(spec.app) ?? '',
          keys: keysFor(id, preset, bindings).map((chord) => formatChord(chord, platform)),
          run: () => { runCommandById(id); },
        }];
      }).concat(
        // A team's shortcut makes a new document from one of its Docs templates (T6).
        teamCommands.map(({ teamId, command }) => ({
          id: `team-${teamId}-${command.id}`,
          title: command.title,
          group: teamsData?.teams.find((t) => t.id === teamId)?.name ?? 'Team',
          run: () => {
            createDocFromTemplate({ userId: auth.status === 'ready' ? auth.user.id : undefined, templateId: command.templateId, title: command.title })
              .then((id) => router.push(`/docs/editor?id=${encodeURIComponent(id)}`))
              .catch(() => toast.error('Could not make a document from that template.'));
          },
        })),
      ),
    );
    setPaletteOpen(true);
  }, [preset, bindings, platform, teamCommands, teamsData, auth, router, toast]);
  const paletteShortcut = useMemo(() => {
    const chord = keysFor('shell.commandPalette', preset, bindings)[0];
    return chord ? formatChord(chord, platform) : undefined;
  }, [preset, bindings, platform]);

  // ── Guided tours (onboarding) ────────────────────────────────────────────
  // Each app's tour starts by itself once, after the encryption gate has settled and only on this
  // user's real `onboarding.toursSeen`; "Take the … tour" in the account menu and the palette
  // replays it.
  const gateState = useSyncExternalStore(subscribeToGateState, getGateState, () => 'pending' as const);
  const tours = useTourController({
    pathname,
    ready: auth.status === 'ready' && prefsLoaded,
    blocked: gateState !== 'clear',
    navigate: (href) => router.push(href),
  });
  const startTour = tours.start;
  const tourAvailable = tours.available !== null;

  const shellCommands = useMemo(() => {
    const runs: Partial<Record<CommandId, () => void>> = {
      'shell.toggleSidebar': () => setSidebarCollapsed(!preferences.get('shell.sidebarCollapsed')),
    };
    for (const g of GOTO) {
      if (g.app && !enabledApps.includes(g.app)) continue;
      runs[g.id] = () => router.push(g.href);
    }
    if (tourAvailable) runs['shell.takeTour'] = () => startTour();
    return runs;
  }, [setSidebarCollapsed, enabledApps, router, tourAvailable, startTour]);
  useCommands(shellCommands);
  // In the capture phase, so ⌘K reaches the palette from inside every editor: the sheet grid, the
  // canvases and ProseMirror all stop keys they handle before they bubble up to the window.
  useCommands({ 'shell.commandPalette': openPalette }, { phase: 'capture' });

  const { data: profileDetails } = useQuery({
    queryKey: ['profile-details'],
    queryFn: () => authApi.getProfileDetails(),
    enabled: auth.status === 'ready',
  });

  const { notifications, unreadCount, connected, markRead, markAllRead } = useNotifications();

  // Re-reads whatever listing is on screen when another client changes this user's drive. Mounted
  // here, above every route, because no listing page owns its own refresh — see
  // `lib/driveLiveUpdates.ts`.
  useDriveLiveUpdates({ connected });

  // The anti-FOUC script set `data-app` for the page that loaded; a client-side
  // navigation into another app changes it here (lib/appForPath.ts).
  useEffect(() => {
    document.documentElement.setAttribute('data-app', appForPath(pathname));
  }, [pathname]);

  async function handleUpload(files: FileList) {
    const fileArr = Array.from(files);
    const userId = auth.status === 'ready' ? auth.user.id : undefined;
    // This dropped every file into Drive in the clear — the shortest path there
    // was to issue #95. `uploadDriveFile` encrypts or refuses; check the key
    // once up front so a locked vault says so instead of reporting every file
    // as a failed upload.
    if (!(await canEncryptFor(userId))) {
      toast.warning(ENCRYPTION_WARNING_MESSAGE);
      return;
    }
    toast.info(`Uploading ${fileArr.length} file${fileArr.length > 1 ? 's' : ''}…`);
    const results = await Promise.allSettled(
      fileArr.map((file) => uploadDriveFile(file, userId, { folderId: null }))
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed === 0) {
      toast.success(`${succeeded} file${succeeded > 1 ? 's' : ''} uploaded`);
    } else if (succeeded === 0) {
      toast.error(`Failed to upload ${failed} file${failed > 1 ? 's' : ''}`);
    } else {
      toast.warning(`${succeeded} uploaded, ${failed} failed`);
    }
    queryClient.invalidateQueries({ queryKey: ['contents'] });
  }

  useEffect(() => {
    async function init() {
      async function fetchProfile(): Promise<UserProfile> {
        try {
          return await authApi.getProfile();
        } catch {
          // Expired access token — try a refresh once.
          await authApi.refresh();
          return authApi.getProfile();
        }
      }

      try {
        const [profile, quotaInfo] = await Promise.all([
          fetchProfile(),
          storageApi.getQuota().catch(() => null),
        ]);
        const user = { ...profile, isAdmin: profile.role === 'admin' };
        setAuth({
          status: 'ready',
          user,
          quota: quotaInfo
            ? quotaFromInfo(quotaInfo)
            : { usedBytes: 0, totalBytes: DEFAULT_QUOTA_BYTES },
          quotaInfo,
        });
        // The E2EE key is provisioned or unlocked by `E2EEUnlockGate` below —
        // it needs an unlock secret from the user, so it cannot happen here.
      } catch {
        // Not authenticated or refresh failed — redirect to sign-in, carrying where the user was
        // headed. Shared links (`/open/note/<id>`, a document URL in an email) routinely arrive
        // signed-out, and without this they all land on Drive with the destination lost.
        router.replace(signInHref(window.location.pathname + window.location.search));
      }
    }

    init();
  }, [router]);

  /**
   * Keystroke handler for the topbar box. Every keystroke starts a search, so
   * the sequence number drops results from a query the user has already typed
   * past — otherwise a slow early query can overwrite a fast later one.
   */
  const searchSeqRef = useRef(0);
  /** The query on screen, so an index change can be re-run against it. */
  const searchQueryRef = useRef('');
  const handleSearch = useCallback(async (query: string) => {
    const seq = ++searchSeqRef.current;
    searchQueryRef.current = query;
    if (!query.trim()) {
      setSearchPending(false);
      setSearchResults([]);
      return;
    }
    setSearchPending(true);
    try {
      const hits = await search(query);
      if (seq !== searchSeqRef.current) return;
      setSearchResults(hits.map(toTopbarResult));
    } catch {
      if (seq === searchSeqRef.current) setSearchResults([]);
    } finally {
      if (seq === searchSeqRef.current) setSearchPending(false);
    }
  }, [search]);

  /**
   * An open drop-down is a live view of the index, so a save in another app —
   * or in another tab — re-runs the query behind it rather than leaving hits
   * for content that has since changed.
   */
  useSearchIndexUpdates(() => {
    if (searchQueryRef.current.trim()) void handleSearch(searchQueryRef.current);
  });

  const handleResultClick = useCallback((result: TopbarSearchResult) => {
    router.push(result.href);
  }, [router]);

  const handleSearchSubmit = useCallback((query: string) => {
    setSearchResults([]);
    router.push(driveSearchHref(query));
  }, [router]);

  async function handleSignOut() {
    await authApi.logout().catch(() => {});
    // Decrypted image bytes and this account's Attachments folder id are held
    // in module state, which outlives the route change.
    clearDriveImageCache();
    // The user's synced preferences and decrypted vault are module state too.
    preferences.detach();
    router.replace('/sign-in');
  }

  // The shell and the route render before `/auth/me` answers, rather than a full-screen spinner
  // in their place: the route's own requests (Drive's listing above all) start in parallel with
  // it instead of after it. Nothing user-specific is drawn until it arrives — no account menu, no
  // storage meter — and a visitor whose session turns out to be gone is sent to sign-in by `init`
  // (or by the first request that 401s, whichever is first).
  const ready = auth.status === 'ready';

  function openInviteFriends() {
    setInviteDialogLoaded(true);
    setInvitingFriends(true);
  }

  const accountActions = {
    onProfile: () => router.push('/profile'),
    onSettings: () => router.push('/settings'),
    onInvite: openInviteFriends,
    onImport: () => router.push('/import'),
    onSignOut: handleSignOut,
    bugReportHref: BUG_REPORT_URL,
    // No Help menu in the shell: the current app's tour is replayed from the account menu.
    onTakeTour: tours.available ? () => startTour() : undefined,
    tourLabel: tours.available ? replayLabel(tours.available) : undefined,
  };
  const shellUser = ready
    ? { name: auth.user.name, email: auth.user.email, avatarSrc: profileDetails?.avatar ?? undefined }
    : undefined;
  // The same list as Drive's Quick access, in the bar between the bell and the avatar. A file
  // with no editor opens in Drive's preview, as a Universal Link to one does.
  const quickAccess = useQuickAccess({ enabled: ready });
  const quickAccessProps = {
    items: quickAccess.entries?.map(({ file, reason }) => {
      const Icon = getFileIcon(file.mimeType);
      return {
        id: file.id,
        title: file.name,
        subtitle: `Edited · ${formatFriendlyDate(file.updatedAt)}`,
        icon: <Icon size={16} strokeWidth={1.8} />,
        iconColor: getIconColor(file.mimeType),
        starred: reason === 'starred',
      };
    }),
    onOpen: (id: string) => {
      const file = quickAccess.entries?.find((e) => e.file.id === id)?.file;
      if (!file) return;
      routeForFile(file, router, {
        onPreviewFallback: (f) => router.push(`/drive?${DRIVE_PREVIEW_PARAM}=${encodeURIComponent(f.id)}`),
      });
    },
  };
  const notificationProps = {
    notifications: toTopbarNotifications(notifications),
    unreadCount: unreadCount,
    onRead: markRead,
    onMarkAllRead: markAllRead,
  };

  // Only the editor frame lacks a top bar, so only there do the editors draw its search,
  // notifications and account in their own title bars.
  const editorShellActions: EditorShellActionsValue | null =
    flow && chrome === 'editor'
      ? {
          onOpenPalette: openPalette,
          paletteShortcut,
          notifications: notificationProps,
          quickAccess: quickAccessProps,
          account: shellUser && { user: shellUser, ...accountActions },
        }
      : null;

  const sidebar = flow ? (
    <ShellSidebar
      sections={navSections}
      newButton={<NewItemFAB variant="sidebar" compact={sidebarCollapsed} />}
      quota={ready ? auth.quota : undefined}
      onRequestStorage={() => setRequestingStorage(true)}
      brand={brand}
      logoHref={landingHref}
      showBrand={chrome === 'editor'}
    />
  ) : (
    <Sidebar
      logoText={brand.name ?? 'Neutrino'}
      logoHref={landingHref}
      sections={navSections}
      quota={ready ? auth.quota : undefined}
      onRequestStorage={() => setRequestingStorage(true)}
      onUpload={handleUpload}
      version={VERSION_LABEL}
      versionTitle={FULL_VERSION_LABEL ? `Neutrino ${FULL_VERSION_LABEL}` : undefined}
    />
  );

  const topbar = flow ? (
    <ShellTopBar
      brand={brand}
      logoHref={landingHref}
      onOpenPalette={openPalette}
      paletteShortcut={paletteShortcut}
      user={shellUser}
      notifications={notificationProps.notifications}
      unreadNotificationCount={unreadCount}
      onNotificationRead={markRead}
      onMarkAllNotificationsRead={markAllRead}
      account={accountActions}
      quickAccess={quickAccessProps}
    />
  ) : (
    <Topbar
      user={shellUser}
      onOpenPalette={openPalette}
      paletteShortcut={paletteShortcut}
      quickAccess={quickAccessProps}
      notifications={notificationProps.notifications}
      unreadNotificationCount={unreadCount}
      onNotificationRead={markRead}
      onMarkAllNotificationsRead={markAllRead}
      bugReportHref={BUG_REPORT_URL}
      onSettings={() => router.push('/settings')}
      onInvite={openInviteFriends}
      onImport={() => router.push('/import')}
      onSignOut={handleSignOut}
      onProfileClick={() => router.push('/profile')}
      onTakeTour={accountActions.onTakeTour}
      tourLabel={accountActions.tourLabel}
    >
      <NewItemFAB />
    </Topbar>
  );

  if (!hydrated) return <div className={shellStyles.boot} />;

  return (
    // Above the route: a Takeout import runs for as long as it runs, and this
    // is what keeps it — and its progress bar — alive across an app switch.
    <ImportRunProvider>
      <AppShell sidebar={sidebar} topbar={topbar} variant={flow ? 'flow' : 'classic'} chrome={chrome}>
        <TourControlsProvider value={tours.controls}>
          <EditorShellActionsProvider value={editorShellActions}>{children}</EditorShellActionsProvider>
        </TourControlsProvider>
        {/* Remembers the folder or library an editor was opened from, for its back button. */}
        <Suspense fallback={null}>
          <EditorReturnTracker />
        </Suspense>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          commands={paletteCommands}
          onSearch={handleSearch}
          searchResults={searchResults}
          searchPending={searchPending}
          onResultClick={handleResultClick}
          onSearchSubmit={handleSearchSubmit}
        />
        {/* Overlays the shell when the identity key is missing or locked. Renders
            nothing once unlocked, and is dismissable — see the component notes. */}
        {ready && <E2EEUnlockGate userId={auth.user.id} userName={auth.user.email} />}
        {/* The guided tour on screen, if one is running — over everything but toasts. */}
        {tours.overlay}
        {/* The storage meter's "Request Additional" (issue #144). Mounted here
            rather than in the sidebar because @neutrino/layout has no API
            dependencies, so the ask belongs to the app. */}
        {ready && (
          <RequestStorageDialog
            open={requestingStorage}
            onClose={() => setRequestingStorage(false)}
            quota={auth.quotaInfo}
          />
        )}
        {ready && inviteDialogLoaded && (
          <InviteFriendsDialog open={invitingFriends} onClose={() => setInvitingFriends(false)} />
        )}
      </AppShell>
    </ImportRunProvider>
  );
}
