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
  ExternalLink,
  Folder,
} from 'lucide-react';
import type { NavItem, NavSection } from '@neutrino/layout';
import type { AppKey } from '@neutrino/preferences';
import type { Tag, Team } from '@/lib/api';
import { tagNavSection } from '@/lib/tagNav';
import { teamHref } from './teams/teamHref';
import { pinHref, type TeamPin } from '@/lib/teamResources';

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

/**
 * One entry per application, each pointing at that app's own page, in its identity colour (the
 * new shell draws it; the classic sidebar ignores it). `app` is its key in `apps.enabled`.
 */
export const APP_ITEMS: (NavItem & { app: AppKey })[] = [
  { id: 'docs', app: 'docs', label: 'Docs', icon: FileText, href: '/docs', color: 'var(--app-color-docs)' },
  { id: 'sheets', app: 'sheets', label: 'Sheets', icon: Table2, href: '/sheets', color: 'var(--app-color-sheets)' },
  { id: 'slides', app: 'slides', label: 'Slides', icon: Presentation, href: '/slides', color: 'var(--app-color-slides)' },
  { id: 'notes', app: 'notes', label: 'Notes', icon: NotebookPen, href: '/notes', color: 'var(--app-color-notes)' },
  { id: 'diagrams', app: 'diagrams', label: 'Diagrams', icon: GitBranch, href: '/diagrams', color: 'var(--app-color-diagrams)' },
  { id: 'drawings', app: 'drawing', label: 'Drawings', icon: Paintbrush, href: '/drawing', color: 'var(--app-color-drawing)' },
  { id: 'photos', app: 'photos', label: 'Photos', icon: Image, href: '/photos', color: 'var(--app-color-photos)' },
  { id: 'calendar', app: 'calendar', label: 'Calendar', icon: Calendar, href: '/calendar', color: 'var(--app-color-calendar)' },
];

/**
 * The apps an administrator has left on (`apps.enabled`, customization roadmap §6.3). Hiding an
 * app hides it here, in the New menu and in the command palette; it does not 404 its routes —
 * that is the feature-flag system's job, and a bookmark into a hidden app still opens.
 */
function appsSection(enabled: readonly AppKey[]): NavSection {
  return {
    id: 'apps',
    label: 'Apps',
    items: APP_ITEMS.filter((item) => enabled.includes(item.app)).map(({ app: _app, ...item }) => item),
  };
}

/** `#rrggbb` or nothing: a team's colour is drawn into a style, so it is checked again here. */
export function safeTeamColor(color: string | null | undefined): string | undefined {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : undefined;
}

/** A team in the new shell's sidebar: its own square, in its colour (T1), linking into its space. */
function teamItem(team: Team): NavItem {
  const mark = team.avatarEmoji || team.name.trim().charAt(0).toUpperCase() || '#';
  return {
    id: `team-${team.id}`,
    label: team.name,
    icon: Users,
    href: teamHref(team.id),
    swatch: { color: safeTeamColor(team.avatarColor) ?? 'var(--brand-accent)', text: mark },
  };
}

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
function teamSection(teamSpacesEnabled: boolean, teams?: readonly Team[], pins: Record<string, TeamPin[]> = {}): NavSection {
  if (!teamSpacesEnabled) {
    return { id: 'team', label: 'Team', items: [{ id: 'shared-drives', label: 'Shared Drives', icon: Users, href: '/drive/team' }] };
  }
  // The new shell lists the user's teams themselves, under Teams, as the mockups do; the
  // classic sidebar keeps its one entry.
  if (teams) {
    return {
      id: 'team',
      label: 'Teams',
      items: [
        ...teams.filter((t) => !t.archived).flatMap((t) => [
          teamItem(t),
          // What the team's Owners pinned for everyone (T5), under the team.
          ...(pins[t.id] ?? []).map((pin): NavItem => ({
            id: `team-${t.id}-pin-${pin.id}`,
            label: pin.name,
            icon: pin.kind === 'link' ? ExternalLink : pin.kind === 'folder' ? Folder : FileText,
            href: pinHref(t.id, pin),
            nested: true,
            external: pin.kind === 'link',
          })),
        ]),
        { id: 'shared-spaces', label: teams.length ? 'All teams' : 'Shared Spaces', icon: Users, href: '/teams' },
      ],
    };
  }
  return { id: 'team', label: 'Team', items: [{ id: 'shared-spaces', label: 'Shared Spaces', icon: Users, href: '/teams' }] };
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
export interface NavOptions {
  /** `apps.enabled`; every app when omitted. */
  enabledApps?: readonly AppKey[];
  /** The user's teams, listed by name — the new shell's sidebar. Omitted, the Team section is one link. */
  teams?: readonly Team[];
  /** Each team's pinned resources (T5), drawn under it. */
  teamPins?: Record<string, TeamPin[]>;
}

export function getNavSections(
  isAdmin: boolean,
  tags: Tag[],
  teamSpacesEnabled = false,
  { enabledApps = APP_ITEMS.map((i) => i.app), teams, teamPins }: NavOptions = {},
): NavSection[] {
  const sections = [
    DRIVE_SECTION,
    appsSection(enabledApps),
    teamSection(teamSpacesEnabled, teams, teamPins),
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
