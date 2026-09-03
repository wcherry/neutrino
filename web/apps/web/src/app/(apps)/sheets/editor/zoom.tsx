'use client';

import React, { createContext, useContext } from 'react';

/**
 * Grid zoom.
 *
 * The zoom itself is a CSS `zoom` on the scroll area: it relayouts, so a
 * zoomed-out grid actually shows more cells rather than painting the same
 * cells smaller, and every pixel the virtualiser deals in (scrollTop, the
 * prefix-sum offsets, the overlay boxes) stays in the grid's own unzoomed
 * coordinate space. Nothing in the grid has to know about it.
 *
 * The exception is a mouse drag. `clientX`/`clientY` are viewport coordinates,
 * so a delta taken from them is in screen pixels while the value it is added to
 * — a column width, a chart's x — is in grid pixels. Dividing by the scale
 * converts one into the other; without it, dragging a column edge at 200% moves
 * the edge twice as far as the pointer. This context carries the scale to the
 * handful of places that take such a delta.
 */
const SheetZoomContext = createContext(1);

export function SheetZoomProvider({ scale, children }: { scale: number; children: React.ReactNode }) {
    return <SheetZoomContext.Provider value={scale}>{children}</SheetZoomContext.Provider>;
}

/** The active zoom as a scale factor (1 = 100%). Defaults to 1 outside a provider. */
export function useSheetZoom(): number {
    const scale = useContext(SheetZoomContext);
    return scale > 0 ? scale : 1;
}
