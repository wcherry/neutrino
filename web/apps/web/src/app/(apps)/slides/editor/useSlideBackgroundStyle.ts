'use client';

import type React from 'react';
import { useResolvedImageSrc } from '@/components/DriveImage';
import { slideBackgroundStyle } from './slideEditorHelpers';
import type { SlideBackground } from './slideEditorTypes';

/**
 * Background style for a slide, with an image background resolved.
 *
 * A background is stored the same way an image element is — as a reference to a
 * Drive file — and a reference can't go in a CSS `url()`. Every surface that
 * paints a slide (the canvas, the thumbnails, the presenter view) goes through
 * here so they all resolve the same way and share one cache.
 */
export function useSlideBackgroundStyle(bg: SlideBackground): React.CSSProperties {
  const resolved = useResolvedImageSrc(bg.type === 'image' ? bg.value : null);
  return slideBackgroundStyle(bg, bg.type === 'image' ? resolved : null);
}
