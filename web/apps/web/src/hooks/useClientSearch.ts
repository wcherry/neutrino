'use client';

import type React from 'react';
import { useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Calendar, File as FileIcon } from 'lucide-react';
import { IndexEngine, getOrCreateSearchKey, type SearchableDocType } from '@neutrino/search';
import { loadKeyPair } from '@neutrino/e2e-crypto';
import { tagsApi, useUser, type TaggedFile, type Tag } from '@/lib/api';
import { getFileIcon, getIconColor } from '@/lib/file-icons';
import {
  hrefForFile,
  DOC_MIME,
  NOTE_MIME,
  SHEET_MIME,
  SLIDES_MIME,
} from '@/app/(apps)/drive/routeForFile';
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

/** Lucide-style icon component, as `FileGrid` and the topbar both expect. */
export type HitIcon = React.ComponentType<{
  size?: number | string;
  strokeWidth?: number | string;
}>;

/** One search hit, shaped so Drive can render it exactly like a Drive item. */
export interface SearchHit {
  id: string;
  title: string;
  /** Item kind — "Document", "Note", "Tagged", … */
  subtitle: string;
  href: string;
  icon: HitIcon;
  iconColor: string;
  /** Drive mimetype when the hit has one; feeds Drive's type filter. */
  mimeType?: string;
  /** Last change, formatted for display; empty when unknown. */
  modified: string;
  /** Last change as epoch millis, for sorting; 0 when unknown. */
  updatedAt: number;
}

/**
 * Doc types that are Drive files under the hood. Reusing their mimetypes here
 * means a Doc looks the same in search results as it does in Drive — same
 * icon, same colour, from the same helpers.
 */
const DOC_TYPE_MIME: Partial<Record<SearchableDocType, string>> = {
  document: DOC_MIME,
  spreadsheet: SHEET_MIME,
  slide: SLIDES_MIME,
  note: NOTE_MIME,
};

function toMillis(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function formatModified(ms: number): string {
  if (ms <= 0) return '';
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

/** Icon and colour for a hit, matching how Drive draws the same item. */
export function docTypeIcon(
  type: SearchableDocType,
  mimeType?: string,
): { icon: HitIcon; iconColor: string } {
  if (type === 'event') return { icon: Calendar, iconColor: 'var(--color-blue, #2563eb)' };
  if (type === 'reminder') return { icon: Bell, iconColor: 'var(--color-amber, #d97706)' };

  const mime = mimeType || DOC_TYPE_MIME[type];
  if (!mime) return { icon: FileIcon, iconColor: 'var(--color-text-secondary)' };
  return { icon: getFileIcon(mime), iconColor: getIconColor(mime) };
}

/** A Drive file surfaced by a tag match rather than a content match. */
function taggedFileHit(file: TaggedFile): SearchHit {
  const updatedAt = toMillis(file.updatedAt);
  return {
    id: file.id,
    title: file.name,
    subtitle: 'Tagged',
    href: hrefForFile(file),
    icon: getFileIcon(file.mimeType),
    iconColor: getIconColor(file.mimeType),
    mimeType: file.mimeType,
    modified: formatModified(updatedAt),
    updatedAt,
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
              .map((r) => {
                const file = taggedFiles.get(r.docId);
                const mimeType = r.mimeType ?? file?.mimeType;
                const updatedAt = toMillis(file?.updatedAt ?? r.updatedAt);
                return {
                  id: r.docId,
                  title: file?.name || r.title || r.docId,
                  subtitle: docTypeLabel(r.type),
                  href: docTypeUrl(r.type, r.docId, mimeType),
                  ...docTypeIcon(r.type, mimeType),
                  mimeType,
                  modified: formatModified(updatedAt),
                  updatedAt,
                };
              })
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
          ...docTypeIcon(r.type, r.mimeType),
          mimeType: r.mimeType,
          modified: formatModified(r.updatedAt),
          updatedAt: r.updatedAt,
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
