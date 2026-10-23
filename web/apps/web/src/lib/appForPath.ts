/**
 * Which app a route belongs to — the value of `data-app` on <html>.
 *
 * `data-app` selects the app's identity colour and Blended Flow's wash
 * (`packages/tokens/src/apps.css`). It was hard-coded to "drive" in the root
 * layout, so every app wore Drive's colour. It is now set from the path twice:
 * by the anti-FOUC script before first paint (which inlines `APP_IDS` from
 * here, so the two cannot disagree) and by the app shell on every client-side
 * navigation.
 *
 * Anything that is not one of these apps — Drive's own views, Settings, Teams,
 * Admin — is Drive, which is what the shell around them is.
 */
export const APP_IDS = ['docs', 'sheets', 'slides', 'notes', 'photos', 'calendar', 'diagrams', 'drawing'] as const;

export type AppId = (typeof APP_IDS)[number] | 'drive';

export function appForPath(pathname: string): AppId {
  const first = pathname.split('/').filter(Boolean)[0] ?? '';
  return (APP_IDS as readonly string[]).includes(first) ? (first as AppId) : 'drive';
}
