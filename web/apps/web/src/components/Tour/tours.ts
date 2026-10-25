import type { AppId } from '@/lib/appForPath';
import type { TourDefinition } from './types';

/**
 * Drive's tour. It starts on My Drive itself, the one listing that has every target: the New
 * button, Quick access, the filter chips and display mode over the files, the top bar's right end
 * and the storage meter. Each step's target carries the `data-tour` value named here.
 */
export const DRIVE_TOUR: TourDefinition = {
  id: 'drive',
  appName: 'Drive',
  startsOn: (pathname) => pathname.replace(/\/$/, '') === '/drive',
  home: '/drive',
  steps: [
    {
      target: 'new',
      title: 'Create anything from here',
      body: 'New makes a folder, a document, sheet, deck, note or drawing, or uploads files — always into the folder you’re looking at.',
      placement: 'bottom',
    },
    {
      target: 'quick-access',
      title: 'Quick access',
      body: 'What you edited recently and what you starred, one click away. When the row is full, the arrows beside the heading scroll it.',
      placement: 'bottom',
    },
    {
      target: 'file-filters',
      title: 'Quick filters',
      body: 'Narrow the list to media, office files, drawings, PDFs or what you’ve starred — and back to All.',
      placement: 'bottom',
    },
    {
      target: 'view-mode',
      title: 'Display mode',
      body: 'Show files as a large grid, a small grid or a detailed list. Each view remembers the one you chose.',
      placement: 'bottom',
    },
    {
      target: 'top-right',
      title: 'Search, notifications and you',
      body: 'Search your files and run commands, see what’s new, reopen something from Quick access, and reach your profile and settings.',
      placement: 'bottom',
    },
    {
      target: 'storage',
      title: 'Your storage',
      body: 'How much of your space you’ve used. When you’re getting close, Request more storage asks for more.',
      placement: 'right',
    },
  ],
};

/** Every tour, one per app. Phase 2 adds the other apps' here. */
export const TOURS: readonly TourDefinition[] = [DRIVE_TOUR];

/** The tour for the app a route belongs to (`appForPath`), if it has one. */
export function tourForApp(app: AppId, tours: readonly TourDefinition[] = TOURS): TourDefinition | null {
  return tours.find((t) => t.id === app) ?? null;
}
