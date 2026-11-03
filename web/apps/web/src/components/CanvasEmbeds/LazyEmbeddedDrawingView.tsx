'use client';

import React, { Suspense, lazy } from 'react';
import type { EmbeddedDrawingViewProps } from './EmbeddedDrawingView';

// The view renders through the drawing compositor, which Docs and Slides load only once a
// drawing is actually on the page (see `readDrawing` in useEmbeddedCanvas).
const View = lazy(() => import('./EmbeddedDrawingView').then((m) => ({ default: m.EmbeddedDrawingView })));

export function LazyEmbeddedDrawingView(props: EmbeddedDrawingViewProps) {
  return (
    <Suspense fallback={null}>
      <View {...props} />
    </Suspense>
  );
}
