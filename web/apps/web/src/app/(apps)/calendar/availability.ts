import type { Availability, EventResponse } from '@/lib/api';
import styles from './availability.module.css';

/**
 * How an event shows the user's time, and how each kind is shaded on the calendar. The shading
 * keeps the calendar's colour (`eventColorStyle`) and changes only the fill:
 *
 * - busy: the solid tint every event had before (no class).
 * - tentative: the tint in diagonal stripes.
 * - free: hollow, with a dashed outline.
 * - away (out of office): a deeper fill.
 */
export const AVAILABILITY_OPTIONS: { value: Availability; label: string }[] = [
  { value: 'busy', label: 'Busy' },
  { value: 'free', label: 'Free' },
  { value: 'tentative', label: 'Tentative' },
  { value: 'away', label: 'Away' },
];

export function availabilityOf(ev: Pick<EventResponse, 'availability'>): Availability {
  return ev.availability ?? 'busy';
}

export function availabilityLabel(a: Availability): string {
  return AVAILABILITY_OPTIONS.find((o) => o.value === a)?.label ?? 'Busy';
}

/** The class that shades a chip, bar or agenda row for the event's availability. */
export function availabilityClass(ev: Pick<EventResponse, 'availability'>): string {
  switch (availabilityOf(ev)) {
    case 'free': return styles.free;
    case 'tentative': return styles.tentative;
    case 'away': return styles.away;
    default: return '';
  }
}
