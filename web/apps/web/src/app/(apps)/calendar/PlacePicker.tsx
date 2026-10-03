'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { LocateFixed, MapPin, Search } from 'lucide-react';
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from '@neutrino/ui';
import {
  DEFAULT_RADIUS_M,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  clampRadius,
  formatRadius,
  geocode,
  type GeocodeResult,
  type Geofence,
  type Place,
} from './places';
import styles from './page.module.css';

// Leaflet touches `window` when it loads, so the map is client-only and loaded on demand.
const GeofenceMap = dynamic(() => import('./GeofenceMap').then((m) => m.GeofenceMap), { ssr: false });

/** What was picked: the geofence, the words to show for it, and a name to save it under. */
export interface PlacePick {
  geofence: Geofence;
  label: string;
  /** Save the point as a place with this name first, and remind there. */
  saveAs?: string;
}

interface PlacePickerProps {
  places: Place[];
  /** Saving needs the account key; when it's missing this says why instead. */
  saveUnavailableReason?: string | null;
  /** What to search for first, e.g. Smart Add's `@Safeway`. */
  initialQuery?: string;
  onPick: (pick: PlacePick) => void;
  onClose: () => void;
  /** Swappable in tests. */
  geocoder?: (query: string) => Promise<GeocodeResult[]>;
}

interface Spot {
  lat: number;
  lng: number;
  name: string;
}

/**
 * "Remind me when I arrive…": a saved place, a search result, or where the browser is, then the
 * radius on a map. The web never fires the reminder — the user's iPhone does.
 */
export function PlacePicker({ places, saveUnavailableReason, initialQuery = '', onPick, onClose, geocoder = geocode }: PlacePickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [spot, setSpot] = useState<Spot | null>(null);
  const [radius, setRadius] = useState(DEFAULT_RADIUS_M);
  const [saveAsPlace, setSaveAsPlace] = useState(false);
  const [saveName, setSaveName] = useState('');

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    try {
      const found = await geocoder(query);
      setResults(found);
      if (found.length === 0) setError(`Nothing found for “${query.trim()}”.`);
    } catch {
      setError('Place search is unavailable right now.');
    } finally {
      setSearching(false);
    }
  }

  function choose(next: Spot) {
    setSpot(next);
    setSaveName(next.name);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError('This browser can’t share its location.');
      return;
    }
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ lat: pos.coords.latitude, lng: pos.coords.longitude, name: 'Current location' }),
      () => setError('Location permission was denied.'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function confirm() {
    if (!spot) return;
    const name = saveName.trim();
    onPick({
      geofence: { kind: 'point', lat: spot.lat, lng: spot.lng, radiusM: clampRadius(radius) },
      label: name || spot.name,
      saveAs: saveAsPlace && name ? name : undefined,
    });
  }

  return (
    <Modal open onClose={onClose} size="md">
      <ModalHeader title="Remind me when I arrive" onClose={onClose} />
      <ModalBody>
        <div className={styles.placePicker}>
          {places.length > 0 && (
            <div className={styles.formGroup}>
              <span className={styles.formLabel}>Saved places</span>
              <div className={styles.placeChoices}>
                {places.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={styles.placeChoice}
                    onClick={() => onPick({ geofence: { kind: 'place', placeId: p.id }, label: p.name })}
                  >
                    <MapPin size={12} aria-hidden /> {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form className={styles.placeSearch} onSubmit={search} role="search">
            <input
              className={styles.formInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a place or address"
              aria-label="Search for a place"
            />
            <Button type="submit" variant="secondary" icon={<Search size={14} />} disabled={searching || !query.trim()}>
              {searching ? 'Searching…' : 'Search'}
            </Button>
          </form>
          <button type="button" className={styles.placeTextBtn} onClick={useMyLocation}>
            <LocateFixed size={12} aria-hidden /> Use my current location
          </button>

          {error && <div className={styles.placeError} role="alert">{error}</div>}

          {results && results.length > 0 && (
            <ul className={styles.placeResults} aria-label="Search results">
              {results.map((r) => (
                <li key={`${r.lat},${r.lng}`}>
                  <button type="button" className={styles.placeResult} onClick={() => choose(r)}>
                    <strong>{r.name}</strong>
                    <span>{r.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {spot && (
            <div className={styles.placeSpot} data-testid="place-spot">
              <GeofenceMap
                lat={spot.lat}
                lng={spot.lng}
                radiusM={radius}
                onMove={(lat, lng) => setSpot((s) => (s ? { ...s, lat, lng } : s))}
              />
              <div className={styles.formGroup}>
                <label className={styles.formLabel} htmlFor="place-radius">
                  Remind within {formatRadius(radius)}
                </label>
                <input
                  id="place-radius"
                  type="range"
                  min={MIN_RADIUS_M}
                  max={MAX_RADIUS_M}
                  step={50}
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                />
              </div>
              <label className={styles.placeSaveToggle}>
                <input
                  type="checkbox"
                  checked={saveAsPlace}
                  disabled={!!saveUnavailableReason}
                  onChange={(e) => setSaveAsPlace(e.target.checked)}
                />
                Save as a place
              </label>
              {saveUnavailableReason && <div className={styles.formHint}>{saveUnavailableReason}</div>}
              {saveAsPlace && (
                <input
                  className={styles.formInput}
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="Name, e.g. Home"
                  aria-label="Place name"
                  maxLength={100}
                />
              )}
            </div>
          )}

          <p className={styles.formHint}>
            Your iPhone reminds you when you arrive; the web only sets it. Searches go to OpenStreetMap.
          </p>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={confirm} disabled={!spot || (saveAsPlace && !saveName.trim())}>Remind me here</Button>
      </ModalFooter>
    </Modal>
  );
}
