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
  FileText,
  Table2,
  Presentation,
  Paintbrush,
} from 'lucide-react';
import type { NavSection } from '@neutrino/layout';
import type { Tag } from '@/lib/api';
import { tagNavSection } from '@/lib/tagNav';

/**
 * Drive views only. Every application has its own landing page and lives in the
 * "Apps" section below, so this stays a list of places inside My Drive.
 */
const DRIVE_SECTION: NavSection = {
  id: 'main',
  items: [
    { id: 'my-drive', label: 'My Drive', icon: HardDrive, href: '/drive' },
    { id: 'shared', label: 'Shared with me', icon: Share2, href: '/drive/shared' },
    { id: 'recent', label: 'Recent', icon: Clock, href: '/drive/recent' },
    { id: 'starred', label: 'Starred', icon: Star, href: '/drive/starred' },
    { id: 'trash', label: 'Trash', icon: Trash2, href: '/drive/trash' },
  ],
};

/** One entry per application, each pointing at that app's own page. */
const APPS_SECTION: NavSection = {
  id: 'apps',
  label: 'Apps',
  items: [
    { id: 'docs', label: 'Docs', icon: FileText, href: '/docs' },
    { id: 'sheets', label: 'Sheets', icon: Table2, href: '/sheets' },
    { id: 'slides', label: 'Slides', icon: Presentation, href: '/slides' },
    { id: 'notes', label: 'Notes', icon: NotebookPen, href: '/notes' },
    { id: 'diagrams', label: 'Diagrams', icon: GitBranch, href: '/diagrams' },
    { id: 'drawings', label: 'Drawings', icon: Paintbrush, href: '/drawing' },
    { id: 'photos', label: 'Photos', icon: Image, href: '/photos' },
    { id: 'calendar', label: 'Calendar', icon: Calendar, href: '/calendar' },
  ],
};

/**
 * The Team section, in one of its two shapes.
 *
 * With `teamSpaces` off this is what it has always been — a link to the Shared Drives page — and
 * the deployment is unchanged by #185. With the flag on, Shared Drives is replaced by Shared
 * Spaces: not added beside it, replaced, because a Team Space is what a shared drive was meant to
 * be and two entries would be two answers to "where does my team's stuff live".
 *
 * Replacing rather than adding is also what makes the flag a real kill switch. Turning it off puts
 * the old entry back, and the Shared Drives page and its endpoint were never removed — which is
 * what the six iOS apps and the macOS client still read.
 */
function teamSection(teamSpacesEnabled: boolean): NavSection {
  return {
    id: 'team',
    label: 'Team',
    items: teamSpacesEnabled
      ? [{ id: 'shared-spaces', label: 'Shared Spaces', icon: Users, href: '/teams' }]
      : [{ id: 'shared-drives', label: 'Shared Drives', icon: Users, href: '/drive/team' }],
  };
}

const ADMIN_SECTION: NavSection = {
  id: 'admin',
  label: 'Administration',
  items: [
    { id: 'admin-dashboard', label: 'Admin', icon: ShieldCheck, href: '/admin' },
  ],
};

/**
 * The sidebar.
 *
 * `teamSpacesEnabled` defaults to `false` so a caller that has not read the flag — or is rendering
 * before the flag map has arrived — gets the pre-#185 sidebar. Failing closed here is what keeps a
 * slow flag fetch from flashing a Shared Spaces entry that then disappears.
 */
export function getNavSections(
  isAdmin: boolean,
  tags: Tag[],
  teamSpacesEnabled = false
): NavSection[] {
  const sections = [
    DRIVE_SECTION,
    APPS_SECTION,
    teamSection(teamSpacesEnabled),
    tagNavSection(tags),
  ];
  return isAdmin ? [...sections, ADMIN_SECTION] : sections;
}

/**
 * The sidebar entry whose href best matches `pathname` — the longest match wins
 * so `/drive/trash` doesn't light up `/drive`, and `/docs/editor` still lights
 * up `/docs`.
 */
export function activeHref(sections: NavSection[], pathname: string): string | undefined {
  return sections
    .flatMap((s) => s.items)
    .filter((i) => i.href && (pathname === i.href || pathname.startsWith(i.href + '/')))
    .sort((a, b) => b.href!.length - a.href!.length)[0]?.href;
}

/** Marks the item matching `pathname` as active, leaving everything else alone. */
export function withActiveItem(sections: NavSection[], pathname: string): NavSection[] {
  const active = activeHref(sections, pathname);
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({ ...item, active: item.href === active })),
  }));
}
