'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { fontsApi } from '@neutrino/api-admin';
import type { CustomFont } from '@neutrino/api-admin';

const STYLE_TAG_ID = 'neutrino-custom-fonts';

type CustomFontsContextValue = {
  fonts: CustomFont[];
  loaded: boolean;
};

const CustomFontsContext = createContext<CustomFontsContextValue>({
  fonts: [],
  loaded: false,
});

function injectFontFaceStyles(fonts: { font: CustomFont; objectUrl: string }[]) {
  let style = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_TAG_ID;
    document.head.appendChild(style);
  }
  style.textContent = fonts
    .map(
      ({ font, objectUrl }) => `@font-face { font-family: '${font.displayName}'; src: url('${objectUrl}'); }`
    )
    .join('\n');
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
    const objectUrls: string[] = [];

    fontsApi
      .list()
      .then(async (list) => {
        const withBlobs = await Promise.all(
          list.map(async (font) => {
            const blob = await fontsApi.getFileBlob(font.fileUrl);
            const objectUrl = URL.createObjectURL(blob);
            objectUrls.push(objectUrl);
            return { font, objectUrl };
          })
        );
        if (cancelled) return;
        injectFontFaceStyles(withBlobs);
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
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
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
