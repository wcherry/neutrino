import type { TourPlacement } from './types';

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Space between the spotlight and the card. */
export const CARD_GAP = 12;
/** The card never comes closer than this to the edge of the window. */
export const VIEWPORT_MARGIN = 16;

const FALLBACK_ORDER: TourPlacement[] = ['bottom', 'top', 'right', 'left'];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

/**
 * Where the card goes: on the step's preferred side of the target when it fits there, otherwise
 * the first side that does (below, above, right, left), otherwise below and clamped. With no
 * target, centred. The other axis centres on the target and is kept inside the window.
 */
export function placeCard(
  target: Box | null,
  card: Size,
  viewport: Size,
  preferred?: TourPlacement,
): { top: number; left: number; placement: TourPlacement | 'center' } {
  const m = VIEWPORT_MARGIN;
  if (!target) {
    return {
      top: clamp((viewport.height - card.height) / 2, m, viewport.height - card.height - m),
      left: clamp((viewport.width - card.width) / 2, m, viewport.width - card.width - m),
      placement: 'center',
    };
  }
  const room: Record<TourPlacement, number> = {
    bottom: viewport.height - (target.top + target.height) - CARD_GAP - m,
    top: target.top - CARD_GAP - m,
    right: viewport.width - (target.left + target.width) - CARD_GAP - m,
    left: target.left - CARD_GAP - m,
  };
  const fits = (p: TourPlacement) => room[p] >= (p === 'top' || p === 'bottom' ? card.height : card.width);
  const order = preferred ? [preferred, ...FALLBACK_ORDER.filter((p) => p !== preferred)] : FALLBACK_ORDER;
  const placement = order.find(fits) ?? (room.bottom >= room.top ? 'bottom' : 'top');

  const centreX = target.left + target.width / 2 - card.width / 2;
  const centreY = target.top + target.height / 2 - card.height / 2;
  const maxLeft = viewport.width - card.width - m;
  const maxTop = viewport.height - card.height - m;
  switch (placement) {
    case 'bottom':
      return { top: clamp(target.top + target.height + CARD_GAP, m, maxTop), left: clamp(centreX, m, maxLeft), placement };
    case 'top':
      return { top: clamp(target.top - CARD_GAP - card.height, m, maxTop), left: clamp(centreX, m, maxLeft), placement };
    case 'right':
      return { top: clamp(centreY, m, maxTop), left: clamp(target.left + target.width + CARD_GAP, m, maxLeft), placement };
    case 'left':
      return { top: clamp(centreY, m, maxTop), left: clamp(target.left - CARD_GAP - card.width, m, maxLeft), placement };
  }
}
