'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppShell,
  Sidebar,
  Topbar,
  type NavSection,
  type StorageQuota,
  type TopbarSearchResult,
} from '@neutrino/layout';
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
} from 'lucide-react';
import { authApi, ensureE2EKeys, storageApi, type UserProfile, type QuotaInfo } from '@/lib/api';
import { IndexEngine, type SearchableDocType } from '@neutrino/search';
import { loadKeyPair } from '@neutrino/e2e-crypto';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import { NewItemFAB } from './NewItemFAB';

const SEARCH_KEY_STORAGE = 'search_key_v1';
const SEARCH_KEY_BYTES = 32;

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

const BASE_NAV_SECTIONS: NavSection[] = [
  {
    id: 'main',
    items: [
      { id: 'my-drive', label: 'My Drive', icon: HardDrive, href: '/drive' },
      { id: 'notes', label: 'Notes', icon: NotebookPen, href: '/notes' },
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

function getNavSections(isAdmin: boolean): NavSection[] {
  if (isAdmin) {
    return [
      ...BASE_NAV_SECTIONS,
      {
        id: 'admin',
        label: 'Administration',
        items: [
          { id: 'admin-dashboard', label: 'Admin', icon: ShieldCheck, href: '/admin' },
        ],
      },
    ];
  }
  return BASE_NAV_SECTIONS;
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
  const flags = useFeatureFlags();
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [searchResults, setSearchResults] = useState<TopbarSearchResult[]>([]);
  const engineRef = useRef<IndexEngine | null>(null);
  const searchKeyRef = useRef<Uint8Array | null>(null);

  const isAdmin = auth.status === 'ready' ? (auth.user.isAdmin ?? false) : false;
  const currentNavSections = getNavSections(isAdmin);
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

  useEffect(() => {
    if (auth.status !== 'ready' || !flags.search) return;
    const kp = loadKeyPair(auth.user.id);
    if (kp) {
      engineRef.current = new IndexEngine();
      searchKeyRef.current = getOrCreateSearchKey(auth.user.id);
    }
  }, [auth, flags.search]);

  const handleSearch = useCallback(async (query: string) => {
    const engine = engineRef.current;
    const searchKey = searchKeyRef.current;
    if (!engine || !searchKey || query.length < 3) {
      setSearchResults([]);
      return;
    }
    const terms = query.trim().split(/\s+/).filter(Boolean);
    const found = await engine.query(terms, searchKey);
    setSearchResults(
      found.map((r) => ({
        id: r.docId,
        title: r.title || r.docId,
        subtitle: docTypeLabel(r.type),
        href: docTypeUrl(r.type, r.docId),
        icon: docTypeIcon(r.type),
      })),
    );
  }, []);

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
      searchResults={flags.search ? searchResults : undefined}
      onResultClick={flags.search ? handleResultClick : undefined}
      onSettings={() => router.push('/settings')}
      onSignOut={handleSignOut}
      onProfileClick={() => router.push('/profile')}
    />
  );

  return (
    <AppShell sidebar={sidebar} topbar={topbar}>
      {children}
      <NewItemFAB />
    </AppShell>
  );
}
