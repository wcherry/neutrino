import type { TourId } from '@neutrino/preferences';

export type { TourId };

/** Which side of its target a step's card prefers. Another side is used when it does not fit. */
export type TourPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TourStep {
  /**
   * The element the step points at, as the value of its `data-tour` attribute. An attribute on the
   * real element rather than a class or a role: it says "a tour points here" where the markup is,
   * and survives a restyle.
   */
  target: string;
  title: string;
  body: string;
  placement?: TourPlacement;
}

export interface TourDefinition {
  /** One per app; also what `onboarding.toursSeen` records. */
  id: TourId;
  /** As the card and the menu name it: "Drive tour", "Take the Drive tour". */
  appName: string;
  /** The routes it starts on by itself — those where every step's target can be on screen. */
  startsOn: (pathname: string) => boolean;
  /**
   * Where a replay from elsewhere in the app goes first. A tour without one runs on a document —
   * an editor's — and there is no one document to send the user to, so it is offered only on the
   * routes it starts on: "Take the Docs tour" is in the editor's menu, not the library's.
   */
  home?: string;
  /**
   * A target that says the page has drawn, for a page that draws after it opens (an editor
   * decrypting its document). Until it is on screen the tour waits, without counting the wait
   * against the tries a tour with nothing on screen gets, so a slow load does not leave steps out.
   */
  waitFor?: string;
  steps: readonly TourStep[];
}

/** A step whose target was found and on screen when the tour started. */
export interface ResolvedStep {
  step: TourStep;
  element: Element;
}

export function tourName(tour: Pick<TourDefinition, 'appName'>): string {
  return `${tour.appName} tour`;
}

export function replayLabel(tour: Pick<TourDefinition, 'appName'>): string {
  return `Take the ${tour.appName} tour`;
}
