/**
 * Photos user preferences — synced preferences (`@neutrino/preferences`).
 *
 *   - autoFaceDetect: when enabled, saving a new photo automatically kicks off
 *     background face detection for it.
 */
'use client';

import { preferences, usePreference } from '@neutrino/preferences';

/** Reads the current auto-face-detect preference (safe on the server). */
export function readAutoFaceDetect(): boolean {
  return preferences.get('photos.autoFaceDetect');
}

export function usePhotoSettings() {
  const [autoFaceDetect, setAutoFaceDetect] = usePreference('photos.autoFaceDetect');
  return { autoFaceDetect, setAutoFaceDetect };
}
