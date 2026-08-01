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
  FileText,
  Table2,
  Presentation,
  Bell,
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
  type TaggedFile,
} from '@/lib/api';
import { tagNavSection } from '@/lib/tagNav';
import {
  intersectFileIds,
  matchTagsForTerm,
  parseTagQuery,
  resolveTagFilter,
} from '@/lib/tagSearch';
import { hrefForFile } from './drive/routeForFile';
import { getFileIcon } from '@/lib/file-icons';
import { IndexEngine, type SearchableDocType } from '@neutrino/search';
import { loadKeyPair } from '@neutrino/e2e-crypto';
import { NewItemFAB } from './NewItemFAB';
import { useNotifications } from '@/hooks/useNotifications';

const SEARCH_KEY_STORAGE = 'search_key_v1';
const SEARCH_KEY_BYTES = 32;
const MIN_SEARCH_LENGTH = 3;
const MAX_SEARCH_RESULTS = 20;
/** Per tag, matching the backend's paging cap. */
const TAG_SEARCH_FILE_LIMIT = 200;

/** A Drive file surfaced by a tag match rather than a content match. */
function taggedFileResult(file: TaggedFile): TopbarSearchResult {
  const Icon = getFileIcon(file.mimeType);
  return {
    id: file.id,
    title: file.name,
    subtitle: 'Tagged',
    href: hrefForFile(file),
    icon: <Icon size={16} />,
  };
}

function getOrCreateSearchKey(userId: string): Uint8Array {
  const storageKey = `${SEARCH_KEY_STORAGE}_${userId}`;
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    return Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  }
  const key = crypto.getRandomValues(new Uint8Array(SEARCH_KEY_BYTES));
  localStorage.setItem(storageKey, btoa(String.fromCharCode(...key)));
  return key;
}

function docTypeUrl(type: SearchableDocType, docId: string): string {
  switch (type) {
    case 'document': return `/docs/editor?id=${docId}`;
    case 'spreadsheet': return `/sheets/editor?id=${docId}`;
    case 'note': return `/notes/editor?id=${docId}`;
    case 'slide': return `/slides/editor?id=${docId}`;
    case 'event':
    case 'reminder': return '/calendar';
    default: return '/drive';
  }
}

function docTypeLabel(type: SearchableDocType): string {
  const labels: Record<SearchableDocType, string> = {
    document: 'Document',
    spreadsheet: 'Sheet',
    note: 'Note',
    slide: 'Slide',
    event: 'Event',
    reminder: 'Reminder',
  };
  return labels[type] ?? type;
}

function docTypeIcon(type: SearchableDocType): React.ReactNode {
  switch (type) {
    case 'document': return <FileText size={16} />;
    case 'spreadsheet': return <Table2 size={16} />;
    case 'note': return <NotebookPen size={16} />;
    case 'slide': return <Presentation size={16} />;
    case 'event': return <Calendar size={16} />;
    case 'reminder': return <Bell size={16} />;
    default: return <FileText size={16} />;
  }
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
  const engineRef = useRef<IndexEngine | null>(null);
  const searchKeyRef = useRef<Uint8Array | null>(null);

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
        const kp = loadKeyPair(user.id);
        if (kp) {
          engineRef.current = new IndexEngine();
          searchKeyRef.current = getOrCreateSearchKey(user.id);
        }
      } catch {
        // Not authenticated or refresh failed — redirect to sign-in.
        router.replace('/sign-in');
      }
    }

    init();
  }, [router]);

  useEffect(() => {
    if (auth.status !== 'ready') return;
    const kp = loadKeyPair(auth.user.id);
    if (kp) {
      engineRef.current = new IndexEngine();
      searchKeyRef.current = getOrCreateSearchKey(auth.user.id);
    }
  }, [auth]);


  /**
   * Files carrying every tag in the filter, as `fileId -> file`. Fetched
   * through the query cache so repeated keystrokes reuse the same responses.
   */
  const fetchTaggedFiles = useCallback(
    async (groups: Tag[][]): Promise<Map<string, TaggedFile>> => {
      const filesById = new Map<string, TaggedFile>();
      const idsPerGroup: Set<string>[] = [];

      for (const group of groups) {
        const idsForGroup = new Set<string>();
        const responses = await Promise.all(
          group.map((tag) =>
            queryClient
              .fetchQuery({
                queryKey: ['tag-files', tag.id],
                queryFn: () => tagsApi.filesForTag(tag.id, { limit: TAG_SEARCH_FILE_LIMIT }),
                staleTime: 30_000,
              })
              // A tag deleted in another tab 404s here. Search must degrade to
              // its other matches rather than throwing out of the handler.
              .catch(() => ({ files: [], total: 0, limit: 0, offset: 0 })),
          ),
        );
        for (const response of responses) {
          for (const file of response.files) {
            idsForGroup.add(file.id);
            filesById.set(file.id, file);
          }
        }
        idsPerGroup.push(idsForGroup);
      }

      const matching = intersectFileIds(idsPerGroup);
      return new Map([...filesById].filter(([id]) => matching.has(id)));
    },
    [queryClient],
  );

  const handleSearch = useCallback(async (query: string) => {
    const { tagTerms, textQuery, hasExplicitTagFilter } = parseTagQuery(query);

    // An explicit `tag:` filter naming an unknown tag matches nothing, rather
    // than silently degrading to an untagged search.
    const tagGroups = hasExplicitTagFilter ? resolveTagFilter(tags, tagTerms) : null;
    if (hasExplicitTagFilter && !tagGroups) {
      setSearchResults([]);
      return;
    }
    const taggedFiles = tagGroups ? await fetchTaggedFiles(tagGroups) : null;

    // Content search covers only the E2EE-indexed apps and needs local keys.
    const engine = engineRef.current;
    const searchKey = searchKeyRef.current;
    const canSearchText = Boolean(engine && searchKey) && textQuery.length >= MIN_SEARCH_LENGTH;

    const textResults =
      canSearchText && engine && searchKey
        ? await engine.query(textQuery.split(/\s+/).filter(Boolean), searchKey)
        : [];

    if (hasExplicitTagFilter && taggedFiles) {
      // `tag:x some words` — the tag filter narrows the content hits. With no
      // text terms, the tagged files are the whole result.
      const matched = canSearchText
        ? textResults.filter((r) => taggedFiles.has(r.docId))
        : [];

      const results: TopbarSearchResult[] = canSearchText
        ? matched.map((r) => ({
            id: r.docId,
            title: taggedFiles.get(r.docId)?.name || r.title || r.docId,
            subtitle: docTypeLabel(r.type),
            href: docTypeUrl(r.type, r.docId),
            icon: docTypeIcon(r.type),
          }))
        : [...taggedFiles.values()].map(taggedFileResult);

      setSearchResults(results.slice(0, MAX_SEARCH_RESULTS));
      return;
    }

    if (query.trim().length < MIN_SEARCH_LENGTH) {
      setSearchResults([]);
      return;
    }

    // No `tag:` prefix — surface files whose *tag name* matches the raw query
    // alongside the content hits, so typing "taxes" finds what you labelled.
    const impliedTags = matchTagsForTerm(tags, query.trim());
    const impliedFiles = impliedTags.length > 0
      ? await fetchTaggedFiles([impliedTags])
      : new Map<string, TaggedFile>();

    const seen = new Set<string>();
    const results: TopbarSearchResult[] = [];

    for (const r of textResults) {
      if (seen.has(r.docId)) continue;
      seen.add(r.docId);
      results.push({
        id: r.docId,
        title: r.title || r.docId,
        subtitle: docTypeLabel(r.type),
        href: docTypeUrl(r.type, r.docId),
        icon: docTypeIcon(r.type),
      });
    }

    for (const file of impliedFiles.values()) {
      if (seen.has(file.id)) continue;
      seen.add(file.id);
      results.push(taggedFileResult(file));
    }

    setSearchResults(results.slice(0, MAX_SEARCH_RESULTS));
  }, [tags, fetchTaggedFiles]);

  const handleResultClick = useCallback((result: TopbarSearchResult) => {
    router.push(result.href);
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
      notifications={toTopbarNotifications(notifications)}
      unreadNotificationCount={unreadCount}
      onNotificationRead={markRead}
      onMarkAllNotificationsRead={markAllRead}
      onSettings={() => router.push('/settings')}
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
