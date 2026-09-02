'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppShell,
  Sidebar,
  Topbar,
  type StorageQuota,
  type TopbarSearchResult,
  type TopbarNotification,
} from '@neutrino/layout';
import type { NotificationItem } from '@neutrino/api-drive';
import {
  Spinner,
  useToast,
} from '@neutrino/ui';
import {
  authApi,
  storageApi,
  tagsApi,
  uploadDriveFile,
  canEncryptFor,
  type UserProfile,
  type QuotaInfo,
} from '@/lib/api';
import { ENCRYPTION_WARNING_MESSAGE } from '@/components/EncryptionWarningMessage';
import { getNavSections, withActiveItem } from './navSections';
import { NewItemFAB } from './NewItemFAB';
import { E2EEUnlockGate } from '@/components/E2EEUnlockGate';
import { RequestStorageDialog } from '@/components/RequestStorageDialog';
import { ImportRunProvider } from '@/components/ImportRun';
import { useNotifications } from '@/hooks/useNotifications';
import { useClientSearch, type SearchHit } from '@/hooks/useClientSearch';
import { useSearchIndexSync } from '@/hooks/useSearchIndexSync';
import { useSearchIndexUpdates } from '@/hooks/useSearchIndexUpdates';
import { driveSearchHref } from './drive/searchParams';
import { BUG_REPORT_URL } from '@/lib/bugReport';
import { signInHref } from '@/lib/signInRedirect';
import { FULL_VERSION_LABEL, VERSION_LABEL } from '@/lib/version';
import { clearDriveImageCache } from '@/lib/driveImages';

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
  const { resourceType, resourceId, mimeType } = payload;
  if (!resourceId) return undefined;
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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [requestingStorage, setRequestingStorage] = useState(false);
  const [searchResults, setSearchResults] = useState<TopbarSearchResult[]>([]);
  const [searchPending, setSearchPending] = useState(false);
  const { search } = useClientSearch();

  // Nothing is searched server-side, so the local index has to be kept current
  // or the box would have nothing to match against.
  useSearchIndexSync(auth.status === 'ready' ? auth.user.id : undefined);

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

  const navSections = withActiveItem(getNavSections(isAdmin, tags), pathname);

  const { data: profileDetails } = useQuery({
    queryKey: ['profile-details'],
    queryFn: () => authApi.getProfileDetails(),
    enabled: auth.status === 'ready',
  });

  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

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
    router.replace('/sign-in');
  }

  if (auth.status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  const sidebar = (
    <Sidebar
      logoText="Neutrino"
      logoHref="/drive"
      sections={navSections}
      quota={auth.quota}
      onRequestStorage={() => setRequestingStorage(true)}
      onUpload={handleUpload}
      version={VERSION_LABEL}
      versionTitle={FULL_VERSION_LABEL ? `Neutrino ${FULL_VERSION_LABEL}` : undefined}
    />
  );

  const topbar = (
    <Topbar
      user={{ name: auth.user.name, email: auth.user.email, avatarSrc: profileDetails?.avatar ?? undefined }}
      onSearch={handleSearch}
      searchPlaceholder="Search in Drive..."
      searchResults={searchResults}
      onResultClick={handleResultClick}
      onSearchSubmit={handleSearchSubmit}
      searchPending={searchPending}
      notifications={toTopbarNotifications(notifications)}
      unreadNotificationCount={unreadCount}
      onNotificationRead={markRead}
      onMarkAllNotificationsRead={markAllRead}
      bugReportHref={BUG_REPORT_URL}
      onSettings={() => router.push('/settings')}
      onImport={() => router.push('/import')}
      onSignOut={handleSignOut}
      onProfileClick={() => router.push('/profile')}
    >
      <NewItemFAB />
    </Topbar>
  );

  return (
    // Above the route: a Takeout import runs for as long as it runs, and this
    // is what keeps it — and its progress bar — alive across an app switch.
    <ImportRunProvider>
      <AppShell sidebar={sidebar} topbar={topbar}>
        {children}
        {/* Overlays the shell when the identity key is missing or locked. Renders
            nothing once unlocked, and is dismissable — see the component notes. */}
        <E2EEUnlockGate userId={auth.user.id} userName={auth.user.email} />
        {/* The storage meter's "Request Additional" (issue #144). Mounted here
            rather than in the sidebar because @neutrino/layout has no API
            dependencies, so the ask belongs to the app. */}
        <RequestStorageDialog
          open={requestingStorage}
          onClose={() => setRequestingStorage(false)}
          quota={auth.quotaInfo}
        />
      </AppShell>
    </ImportRunProvider>
  );
}
