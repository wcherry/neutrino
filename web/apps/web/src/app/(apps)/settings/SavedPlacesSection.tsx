'use client';

import React, { useState } from 'react';
import { Check, MapPin, Pencil, Trash2, X } from 'lucide-react';
import { AlertDialog, Spinner } from '@neutrino/ui';
import { formatRadius, type Place } from '../calendar/places';
import { usePlaces } from '../calendar/usePlaces';
import styles from './page.module.css';
import placeStyles from './HolidaysSection.module.css';

/**
 * Settings → Calendar → Saved places: the places tasks can remind you at. They are end-to-end
 * encrypted, so names and coordinates are read here with the account key; the server holds only
 * ciphertext. New places are made from a task's "Remind me when I arrive".
 */
export function SavedPlacesSection() {
  const places = usePlaces();
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Place | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!places.supported) return null;

  async function run(action: () => Promise<void>, fallback: string) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : fallback);
    }
  }

  return (
    <section className={styles.section} data-testid="saved-places-section">
      <h2 className={styles.sectionTitle}>Saved places</h2>
      <p className={styles.sectionDesc}>
        Places a task can remind you at when you arrive, on your iPhone. They are end-to-end
        encrypted: only your devices can read their names and where they are. Add one from a
        task&apos;s “Remind me when I arrive”.
      </p>

      {places.locked ? (
        <p className={placeStyles.credit}>Unlock your encryption key to see your saved places.</p>
      ) : places.isLoading ? (
        <Spinner size="sm" />
      ) : places.places.length === 0 ? (
        <p className={placeStyles.credit}>No saved places yet.</p>
      ) : (
        <div className={styles.connectionList}>
          {places.places.map((place) => (
            <div key={place.id} className={`${styles.connectionRow} ${placeStyles.row}`} data-testid="saved-place-row">
              <div className={placeStyles.rowMain}>
                <MapPin size={14} aria-hidden />
                {editing?.id === place.id ? (
                  <form
                    className={placeStyles.rowMain}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = editing.name.trim();
                      if (!name) return;
                      void run(async () => {
                        await places.rename(place, name);
                        setEditing(null);
                      }, 'Could not rename the place');
                    }}
                  >
                    <input
                      className={styles.formInput}
                      value={editing.name}
                      onChange={(e) => setEditing({ id: place.id, name: e.target.value })}
                      aria-label={`New name for ${place.name}`}
                      autoFocus
                      maxLength={100}
                    />
                    <button type="submit" className={styles.iconBtn} aria-label="Save name"><Check size={14} /></button>
                    <button type="button" className={styles.iconBtn} aria-label="Cancel" onClick={() => setEditing(null)}>
                      <X size={14} />
                    </button>
                  </form>
                ) : (
                  <div className={styles.connectionInfo}>
                    <div className={styles.connectionName}>{place.name}</div>
                    <div className={styles.connectionDesc}>
                      {place.lat.toFixed(4)}, {place.lng.toFixed(4)} · {formatRadius(place.radiusM)}
                    </div>
                  </div>
                )}
              </div>
              {editing?.id !== place.id && (
                <div className={styles.connectionActions}>
                  <button
                    className={styles.iconBtn}
                    onClick={() => setEditing({ id: place.id, name: place.name })}
                    aria-label={`Rename ${place.name}`}
                    title="Rename"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                    onClick={() => setDeleting(place)}
                    aria-label={`Delete ${place.name}`}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {places.unreadable > 0 && (
        <p className={placeStyles.credit}>
          {places.unreadable === 1 ? 'One saved place' : `${places.unreadable} saved places`} can’t be read
          with this device’s keys, so {places.unreadable === 1 ? 'it isn’t' : 'they aren’t'} shown.
        </p>
      )}
      {error && <p className={placeStyles.error} role="alert">{error}</p>}

      <AlertDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        variant="error"
        title={`Delete ${deleting?.name ?? 'place'}?`}
        description="Tasks that remind you there will stop reminding you."
        confirmLabel="Delete"
        onConfirm={() => {
          const place = deleting;
          setDeleting(null);
          if (place) void run(() => places.remove(place), 'Could not delete the place');
        }}
      />
    </section>
  );
}
