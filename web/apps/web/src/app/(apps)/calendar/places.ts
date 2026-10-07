// Saved places and task geofences on the web (#243). The web stores and edits geofences; only the
// iOS app watches for arrivals. Saved places are end-to-end encrypted (`sealPlace` in e2e-crypto).

import type { TaskResponse, UpdateTaskRequest } from '@neutrino/api-calendar';

/** The radius a new point starts at, and the range allowed. The server and iOS use the same. */
export const DEFAULT_RADIUS_M = 150;
export const MIN_RADIUS_M = 100;
export const MAX_RADIUS_M = 2000;

/** A saved place, decrypted. */
export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
}

/** Where a task reminds you on arrival. */
export type Geofence =
  | { kind: 'place'; placeId: string }
  | { kind: 'point'; lat: number; lng: number; radiusM: number };

export function geofenceOf(task: Pick<TaskResponse, 'geoPlaceId' | 'geoLat' | 'geoLng' | 'geoRadiusM'>): Geofence | null {
  if (task.geoPlaceId) return { kind: 'place', placeId: task.geoPlaceId };
  if (typeof task.geoLat === 'number' && typeof task.geoLng === 'number') {
    return { kind: 'point', lat: task.geoLat, lng: task.geoLng, radiusM: task.geoRadiusM ?? DEFAULT_RADIUS_M };
  }
  return null;
}

/**
 * The four fields that set, replace or clear a geofence. All four always: a place sent alone
 * would leave a point beside it on an older server, so the other kind is cleared explicitly.
 */
export function geofenceFields(geofence: Geofence | null): Pick<UpdateTaskRequest, 'geoPlaceId' | 'geoLat' | 'geoLng' | 'geoRadiusM'> {
  if (geofence?.kind === 'place') return { geoPlaceId: geofence.placeId, geoLat: null, geoLng: null, geoRadiusM: null };
  if (geofence?.kind === 'point') {
    return { geoPlaceId: null, geoLat: geofence.lat, geoLng: geofence.lng, geoRadiusM: clampRadius(geofence.radiusM) };
  }
  return { geoPlaceId: null, geoLat: null, geoLng: null, geoRadiusM: null };
}

export function clampRadius(radiusM: number): number {
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(radiusM)));
}

/** "Home", or "51.5014, -0.1419 · 150 m" for a point, or "A saved place" when it can't be read. */
export function describeGeofence(geofence: Geofence, places: readonly Place[]): string {
  if (geofence.kind === 'place') {
    return places.find((p) => p.id === geofence.placeId)?.name ?? 'A saved place';
  }
  return `${geofence.lat.toFixed(4)}, ${geofence.lng.toFixed(4)} · ${formatRadius(geofence.radiusM)}`;
}

export function formatRadius(radiusM: number): string {
  return radiusM >= 1000 ? `${(radiusM / 1000).toFixed(radiusM % 1000 === 0 ? 0 : 1)} km` : `${radiusM} m`;
}

// ── Smart Add `@place` ────────────────────────────────────────────────────────

/** Case, accents and anything but letters and digits dropped, as iOS `PlacesService.match` folds. */
export function foldPlaceName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * The saved place `text` names: an exact name first, then the only place whose name it starts.
 * Null when nothing fits, or more than one place would: a geofence is never attached on a guess.
 * The same rule as iOS `PlacesService.match`.
 */
export function matchPlace(text: string, places: readonly Place[]): Place | null {
  const query = foldPlaceName(text);
  if (!query) return null;
  const exact = places.find((p) => foldPlaceName(p.name) === query);
  if (exact) return exact;
  const prefixed = places.filter((p) => foldPlaceName(p.name).startsWith(query));
  return prefixed.length === 1 ? prefixed[0] : null;
}

// ── Geocoding ─────────────────────────────────────────────────────────────────
//
// OpenStreetMap's Nominatim, the same OpenStreetMap the photo map draws on. The query goes to
// OpenStreetMap, not to Neutrino, as iOS's goes to Apple; saved places themselves never leave the
// browser unencrypted. Its usage policy allows light, user-initiated searches: one per submit,
// never per keystroke.

export interface GeocodeResult {
  /** A short name for the place, e.g. "Safeway". */
  name: string;
  /** The full address line. */
  label: string;
  lat: number;
  lng: number;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export async function geocode(query: string, fetchImpl: typeof fetch = fetch): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (!q) return [];
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '5', addressdetails: '0' });
  const res = await fetchImpl(`${NOMINATIM}?${params}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const rows = (await res.json()) as { name?: string; display_name?: string; lat?: string; lon?: string }[];
  return rows
    .map((r) => ({
      name: r.name || (r.display_name ?? '').split(',')[0] || q,
      label: r.display_name ?? r.name ?? q,
      lat: Number(r.lat),
      lng: Number(r.lon),
    }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}
