import { Tag as TagIcon, Tags as TagsIcon } from 'lucide-react';
import type { NavItem, NavSection } from '@neutrino/layout';
import type { Tag } from '@neutrino/api-drive';

/** Tags listed inline in the sidebar before the rest fold into "All tags". */
export const MAX_SIDEBAR_TAGS = 8;

/**
 * The sidebar's Tags section, ordered by usage — most-tagged first, ties broken
 * alphabetically so the order stays stable as counts change. Unused tags sort
 * last rather than being hidden.
 *
 * The section is always present, even with no tags at all: it is the only
 * navigation route to `/drive/tags`, so hiding it would make the whole feature
 * undiscoverable for anyone who has not already tagged something from a file's
 * context menu.
 */
export function tagNavSection(tags: Tag[]): NavSection {
  if (tags.length === 0) {
    // No heading for a lone entry — it reads as a normal nav item.
    return {
      id: 'tags',
      items: [{ id: 'all-tags', label: 'Tags', icon: TagsIcon, href: '/drive/tags' }],
    };
  }

  const ordered = [...tags].sort(
    (a, b) => fileCount(b) - fileCount(a) || a.name.localeCompare(b.name),
  );

  const items: NavItem[] = ordered.slice(0, MAX_SIDEBAR_TAGS).map((tag) => ({
    id: `tag-${tag.id}`,
    label: tag.name,
    icon: TagIcon,
    href: `/drive/tag?id=${tag.id}`,
    // A zero on every unused tag is noise; show the count only when there is one.
    ...(fileCount(tag) > 0 ? { badge: fileCount(tag) } : {}),
  }));

  items.push({ id: 'all-tags', label: 'All tags', icon: TagsIcon, href: '/drive/tags' });

  return { id: 'tags', label: 'Tags', items };
}

/** Tolerates a server that predates `fileCount` rather than dropping the tag. */
function fileCount(tag: Tag): number {
  return tag.fileCount ?? 0;
}
