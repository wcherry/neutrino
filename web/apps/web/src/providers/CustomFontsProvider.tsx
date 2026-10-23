'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { fontsApi } from '@neutrino/api-admin';
import type { CustomFont } from '@neutrino/api-admin';

type CustomFontsContextValue = {
  fonts: CustomFont[];
  loaded: boolean;
};

const CustomFontsContext = createContext<CustomFontsContextValue>({
  fonts: [],
  loaded: false,
});

/**
 * Fired on `window` when a custom font's file has arrived and replaced its placeholder. Text in the
 * DOM re-renders by itself; a canvas does not, so a canvas that draws text redraws on this.
 */
export const CUSTOM_FONT_LOADED = 'neutrino:custom-font-loaded';

/**
 * Registers the instance's font library so each file is downloaded only when something first
 * uses that font, not on every page load (a library of 72 fonts was 6.4 MB before Drive could
 * settle).
 *
 * A plain `@font-face { src: url(...) }` would be lazy on its own, but the file endpoint needs the
 * bearer token, which a stylesheet cannot send. So each font starts as a placeholder face whose
 * source is a `local()` name no system has. The browser tries it the first time text or a canvas
 * asks for that family, fails without touching the network, and reports `loadingerror`; only then
 * is the real file fetched with the token and swapped in, and the browser re-renders the text.
 *
 * Returns a function that removes everything it registered.
 */
export function registerLazyFonts(fonts: CustomFont[]): () => void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
    return () => {};
  }
  const set = document.fonts;
  const placeholders = new Map<FontFace, CustomFont>();
  const added: FontFace[] = [];
  let disposed = false;

  const onTried = (event: Event) => {
    for (const face of (event as FontFaceSetLoadEvent).fontfaces) {
      const font = placeholders.get(face);
      if (!font) continue;
      placeholders.delete(face);
      fontsApi
        .getFileBlob(font.fileUrl)
        .then((blob) => blob.arrayBuffer())
        .then((bytes) => new FontFace(font.displayName, bytes).load())
        .then((real) => {
          if (disposed) return;
          set.add(real);
          added.push(real);
          set.delete(face);
          window.dispatchEvent(new CustomEvent(CUSTOM_FONT_LOADED, { detail: { family: font.displayName } }));
        })
        .catch(() => {
          // The family falls back to the next font in its stack.
        });
    }
  };
  set.addEventListener('loading', onTried);
  set.addEventListener('loadingerror', onTried);

  for (const font of fonts) {
    const face = new FontFace(font.displayName, `local("neutrino-lazy-${font.id}")`);
    placeholders.set(face, font);
    set.add(face);
    added.push(face);
  }

  return () => {
    disposed = true;
    set.removeEventListener('loading', onTried);
    set.removeEventListener('loadingerror', onTried);
    for (const face of added) set.delete(face);
  };
}

export function CustomFontsProvider({ children }: { children: React.ReactNode }) {
  const [fonts, setFonts] = useState<CustomFont[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    if (!token) {
      setLoaded(true);
      return;
    }

    let cancelled = false;
    let unregister = () => {};

    fontsApi
      .list()
      .then((list) => {
        if (cancelled) return;
        unregister = registerLazyFonts(list);
        setFonts(list);
      })
      .catch(() => {
        // Leave fonts empty; built-in fonts remain fully usable.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
      unregister();
    };
  }, []);

  return (
    <CustomFontsContext.Provider value={{ fonts, loaded }}>
      {children}
    </CustomFontsContext.Provider>
  );
}

export function useCustomFonts(): CustomFontsContextValue {
  return useContext(CustomFontsContext);
}
