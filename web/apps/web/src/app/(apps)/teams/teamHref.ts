/**
 * URLs into a Team Space.
 *
 * Query parameters rather than dynamic route segments, because the app builds with
 * `output: 'export'` — a `[teamId]` segment would need `generateStaticParams`, and there is no
 * static list of teams. `/notes/editor?id=` and `/drive?q=` are here for the same reason.
 */

export type TeamView = 'home' | 'pages' | 'files' | 'members' | 'settings';

export function teamHref(teamId: string, view: TeamView = 'home', pageId?: string): string {
  const params = new URLSearchParams({ id: teamId });
  if (view !== 'home') params.set('view', view);
  if (pageId) params.set('page', pageId);
  return `/teams/space?${params.toString()}`;
}

/** A specific wiki page. Always the `pages` view — a page *is* the pages view's content. */
export function teamPageHref(teamId: string, pageId: string): string {
  return teamHref(teamId, 'pages', pageId);
}

export function parseTeamView(value: string | null): TeamView {
  switch (value) {
    case 'pages':
    case 'files':
    case 'members':
    case 'settings':
      return value;
    default:
      return 'home';
  }
}
