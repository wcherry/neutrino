/**
 * Photos user preferences, persisted in localStorage.
 *
 *   - autoFaceDetect: when enabled, saving a new photo automatically kicks off
 *     background face detection for it.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

export const AUTO_FACE_DETECT_KEY = 'neutrino:photos:autoFaceDetect';

/** Reads the current auto-face-detect preference (safe on the server). */
export function readAutoFaceDetect(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(AUTO_FACE_DETECT_KEY) === 'true';
}

export function usePhotoSettings() {
  const [autoFaceDetect, setAutoFaceDetectState] = useState<boolean>(readAutoFaceDetect);

  // Keep in sync across tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === AUTO_FACE_DETECT_KEY) setAutoFaceDetectState(readAutoFaceDetect());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setAutoFaceDetect = useCallback((value: boolean) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AUTO_FACE_DETECT_KEY, String(value));
    }
    setAutoFaceDetectState(value);
  }, []);

  return { autoFaceDetect, setAutoFaceDetect };
}
