'use client';

import React, { useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Calendar,
  FileText,
  NotebookPen,
  Presentation,
  Table2,
} from 'lucide-react';
import { IndexEngine, getOrCreateSearchKey, type SearchableDocType } from '@neutrino/search';
import { loadKeyPair } from '@neutrino/e2e-crypto';
import { tagsApi, useUser, type TaggedFile, type Tag } from '@/lib/api';
import { getFileIcon } from '@/lib/file-icons';
import { hrefForFile } from '@/app/(apps)/drive/routeForFile';
import {
  intersectFileIds,
  matchTagsForTerm,
  parseTagQuery,
  resolveTagFilter,
} from '@/lib/tagSearch';

/** Shortest query the content index is consulted for. */
export const MIN_SEARCH_LENGTH = 3;
export const MAX_SEARCH_RESULTS = 20;
/** Per tag, matching the backend's paging cap. */
const TAG_SEARCH_FILE_LIMIT = 200;

/** One row in the search drop-down / Drive results list. */
export interface SearchHit {
  id: string;
  title: string;
  /** Item kind — "Document", "Note", "Tagged", … */
  subtitle: string;
  href: string;
  icon: React.ReactNode;
  /** Last change, already formatted for display; empty when unknown. */
  modified: string;
}

function formatModified(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function docTypeUrl(type: SearchableDocType, docId: string, mimeType?: string): string {
  switch (type) {
    case 'document': return `/docs/editor?id=${docId}`;
    case 'spreadsheet': return `/sheets/editor?id=${docId}`;
    case 'note': return `/notes/editor?id=${docId}`;
    case 'slide': return `/slides/editor?id=${docId}`;
    case 'event':
    case 'reminder': return '/calendar';
    case 'file': return hrefForFile({ id: docId, mimeType: mimeType ?? '' });
    default: return '/drive';
  }
}

export function docTypeLabel(type: SearchableDocType): string {
  const labels: Record<SearchableDocType, string> = {
    document: 'Document',
    spreadsheet: 'Sheet',
    note: 'Note',
    slide: 'Slide',
    event: 'Event',
    reminder: 'Reminder',
    file: 'File',
  };
  return labels[type] ?? type;
}

export function docTypeIcon(type: SearchableDocType, mimeType?: string): React.ReactNode {
  switch (type) {
    case 'document': return <FileText size={16} />;
    case 'spreadsheet': return <Table2 size={16} />;
    case 'note': return <NotebookPen size={16} />;
    case 'slide': return <Presentation size={16} />;
    case 'event': return <Calendar size={16} />;
    case 'reminder': return <Bell size={16} />;
    case 'file': {
      const Icon = getFileIcon(mimeType ?? '');
      return <Icon size={16} />;
    }
    default: return <FileText size={16} />;
  }
}

/** A Drive file surfaced by a tag match rather than a content match. */
function taggedFileHit(file: TaggedFile): SearchHit {
  const Icon = getFileIcon(file.mimeType);
  return {
    id: file.id,
    title: file.name,
    subtitle: 'Tagged',
    href: hrefForFile(file),
    icon: <Icon size={16} />,
    modified: formatModified(file.updatedAt),
  };
}

/**
 * The client-side search service behind both the topbar drop-down and the
 * Drive search view.
 *
 * Content lives in the local encrypted index (`@neutrino/search`); tag names
 * are matched against the server's tag list. Both halves are combined here so
 * every search surface returns exactly the same hits.
 */
export function useClientSearch() {
  const user = useUser();
  const queryClient = useQueryClient();
  const engineRef = useRef<IndexEngine | null>(null);

  const { data: tagsData } = useQuery({
    queryKey: ['tags'],
    queryFn: () => tagsApi.list(),
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });
  const tags = useMemo(() => tagsData?.tags ?? [], [tagsData]);

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

  const search = useCallback(
    async (query: string): Promise<SearchHit[]> => {
      const { tagTerms, textQuery, hasExplicitTagFilter } = parseTagQuery(query);

      // An explicit `tag:` filter naming an unknown tag matches nothing, rather
      // than silently degrading to an untagged search.
      const tagGroups = hasExplicitTagFilter ? resolveTagFilter(tags, tagTerms) : null;
      if (hasExplicitTagFilter && !tagGroups) return [];
      const taggedFiles = tagGroups ? await fetchTaggedFiles(tagGroups) : null;

      // Content search covers only the E2EE-indexed apps and needs local keys.
      const userId = user?.id;
      if (userId && !engineRef.current && loadKeyPair(userId)) {
        engineRef.current = new IndexEngine();
      }
      const engine = engineRef.current;
      const canSearchText = Boolean(engine && userId) && textQuery.length >= MIN_SEARCH_LENGTH;

      const textResults =
        canSearchText && engine && userId
          ? await engine.query(textQuery.split(/\s+/).filter(Boolean), getOrCreateSearchKey(userId))
          : [];

      if (hasExplicitTagFilter && taggedFiles) {
        // `tag:x some words` — the tag filter narrows the content hits. With no
        // text terms, the tagged files are the whole result.
        const hits: SearchHit[] = canSearchText
          ? textResults
              .filter((r) => taggedFiles.has(r.docId))
              .map((r) => ({
                id: r.docId,
                title: taggedFiles.get(r.docId)?.name || r.title || r.docId,
                subtitle: docTypeLabel(r.type),
                href: docTypeUrl(r.type, r.docId, r.mimeType),
                icon: docTypeIcon(r.type, r.mimeType),
                modified: formatModified(taggedFiles.get(r.docId)?.updatedAt ?? r.updatedAt),
              }))
          : [...taggedFiles.values()].map(taggedFileHit);

        return hits.slice(0, MAX_SEARCH_RESULTS);
      }

      if (query.trim().length < MIN_SEARCH_LENGTH) return [];

      // No `tag:` prefix — surface files whose *tag name* matches the raw query
      // alongside the content hits, so typing "taxes" finds what you labelled.
      const impliedTags = matchTagsForTerm(tags, query.trim());
      const impliedFiles = impliedTags.length > 0
        ? await fetchTaggedFiles([impliedTags])
        : new Map<string, TaggedFile>();

      const seen = new Set<string>();
      const hits: SearchHit[] = [];

      for (const r of textResults) {
        if (seen.has(r.docId)) continue;
        seen.add(r.docId);
        hits.push({
          id: r.docId,
          title: r.title || r.docId,
          subtitle: docTypeLabel(r.type),
          href: docTypeUrl(r.type, r.docId, r.mimeType),
          icon: docTypeIcon(r.type, r.mimeType),
          modified: formatModified(r.updatedAt),
        });
      }

      for (const file of impliedFiles.values()) {
        if (seen.has(file.id)) continue;
        seen.add(file.id);
        hits.push(taggedFileHit(file));
      }

      return hits.slice(0, MAX_SEARCH_RESULTS);
    },
    [tags, fetchTaggedFiles, user?.id],
  );

  return { search };
}
