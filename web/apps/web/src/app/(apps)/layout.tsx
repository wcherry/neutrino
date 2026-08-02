'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppShell,
  Sidebar,
  Topbar,
  type NavItem,
  type NavSection,
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
  Calendar,
  GitBranch,
  HardDrive,
  Users,
  Star,
  Clock,
  Trash2,
  Share2,
  NotebookPen,
  ShieldCheck,
  Image,
} from 'lucide-react';
import {
  authApi,
  ensureE2EKeys,
  storageApi,
  tagsApi,
  type UserProfile,
  type QuotaInfo,
  type Tag,
} from '@/lib/api';
import { tagNavSection } from '@/lib/tagNav';
import { NewItemFAB } from './NewItemFAB';
import { useNotifications } from '@/hooks/useNotifications';
import { useClientSearch, type SearchHit } from '@/hooks/useClientSearch';
import { useSearchIndexSync } from '@/hooks/useSearchIndexSync';
import { driveSearchHref } from './drive/searchParams';

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

const BASE_NAV_SECTIONS: NavSection[] = [
  {
    id: 'main',
    items: [
      { id: 'my-drive', label: 'My Drive', icon: HardDrive, href: '/drive' },
      { id: 'notes', label: 'Notes', icon: NotebookPen, href: '/notes' },
      { id: 'photos', label: 'Photos', icon: Image, href: '/photos' },
      { id: 'diagrams', label: 'Diagrams', icon: GitBranch, href: '/diagrams' },
      { id: 'calendar', label: 'Calendar', icon: Calendar, href: '/calendar' },
      { id: 'shared', label: 'Shared with me', icon: Share2, href: '/drive/shared' },
      { id: 'recent', label: 'Recent', icon: Clock, href: '/drive/recent' },
      { id: 'starred', label: 'Starred', icon: Star, href: '/drive/starred' },
      { id: 'trash', label: 'Trash', icon: Trash2, href: '/drive/trash' },
    ],
  },
  {
    id: 'team',
    label: 'Team',
    items: [
      { id: 'shared-drives', label: 'Shared Drives', icon: Users, href: '/drive/team' },
    ],
  },
];

function getNavSections(isAdmin: boolean, tags: Tag[]): NavSection[] {
  const sections = [...BASE_NAV_SECTIONS, tagNavSection(tags)];
  if (isAdmin) {
    return [
      ...sections,
      {
        id: 'admin',
        label: 'Administration',
        items: [
          { id: 'admin-dashboard', label: 'Admin', icon: ShieldCheck, href: '/admin' },
        ],
      },
    ];
  }
  return sections;
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
  | { status: 'ready'; user: UserProfile; quota: StorageQuota };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
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

  const currentNavSections = getNavSections(isAdmin, tags);
  const allHrefs = currentNavSections.flatMap((s) => s.items).filter((i) => i.href);
  const activeHref = allHrefs
    .filter((i) => pathname === i.href || pathname.startsWith(i.href! + '/'))
    .sort((a, b) => b.href!.length - a.href!.length)[0]?.href;
  const navSections = currentNavSections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({ ...item, active: item.href === activeHref })),
  }));

  const { data: profileDetails } = useQuery({
    queryKey: ['profile-details'],
    queryFn: () => authApi.getProfileDetails(),
    enabled: auth.status === 'ready',
  });

  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  async function handleUpload(files: FileList) {
    const fileArr = Array.from(files);
    toast.info(`Uploading ${fileArr.length} file${fileArr.length > 1 ? 's' : ''}…`);
    const results = await Promise.allSettled(
      fileArr.map((file) => storageApi.uploadFile(file, undefined, null))
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
        });
        ensureE2EKeys(user.id).catch(() => {});
      } catch {
        // Not authenticated or refresh failed — redirect to sign-in.
        router.replace('/sign-in');
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
  const handleSearch = useCallback(async (query: string) => {
    const seq = ++searchSeqRef.current;
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

  const handleResultClick = useCallback((result: TopbarSearchResult) => {
    router.push(result.href);
  }, [router]);

  const handleSearchSubmit = useCallback((query: string) => {
    setSearchResults([]);
    router.push(driveSearchHref(query));
  }, [router]);

  async function handleSignOut() {
    await authApi.logout().catch(() => {});
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
      onUpload={handleUpload}
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
      onSettings={() => router.push('/settings')}
      onImport={() => router.push('/import')}
      onSignOut={handleSignOut}
      onProfileClick={() => router.push('/profile')}
    >
      <NewItemFAB />
    </Topbar>
  );

  return (
    <AppShell sidebar={sidebar} topbar={topbar}>
      {children}
    </AppShell>
  );
}
