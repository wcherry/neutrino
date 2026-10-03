'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@neutrino/auth';
import { ApiClientError } from '@neutrino/api-core';
import { calendarApi } from '@neutrino/api-calendar';
import {
  getActiveKeyVersion,
  getSessionKeyPair,
  getSessionKeyPairForVersion,
  initSodium,
  openPlace,
  placeKeyVersion,
  sealPlace,
  type PlacePayload,
} from '@neutrino/e2e-crypto';
import { useSessionKeyPair } from '@/hooks/useSessionKeyPair';
import type { Place } from './places';

export interface PlacesState {
  /** The places this device could open, oldest first. */
  places: Place[];
  /** Places it couldn't: no key for their version yet, or damaged. Not shown, not watched. */
  unreadable: number;
  /** The account key is locked, so places can be neither read nor saved. */
  locked: boolean;
  /** False against a server older than geofencing (`GET /task-places` is 404). */
  supported: boolean;
  isLoading: boolean;
  /** Seals and saves a new place. Throws while locked. */
  create: (payload: PlacePayload) => Promise<Place>;
  rename: (place: Place, name: string) => Promise<void>;
  remove: (place: Place) => Promise<void>;
}

/**
 * The user's saved places, decrypted on this device. The server holds only envelopes, so
 * everything about a place — its name, where it is, how wide — is read and written here.
 *
 * Decryption depends on the session key as a reactive value (`useSessionKeyPair`), so places
 * appear as soon as the vault is unlocked rather than staying empty for a page loaded locked.
 */
export function usePlaces(): PlacesState {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const keyPair = useSessionKeyPair(userId);

  const records = useQuery({
    queryKey: ['task-places'],
    queryFn: () => calendarApi.listTaskPlaces(),
    enabled: !!userId,
    retry: (count, err) => !(err instanceof ApiClientError && err.statusCode === 404) && count < 2,
  });
  const supported = !(records.error instanceof ApiClientError && records.error.statusCode === 404);

  const opened = useQuery({
    queryKey: ['task-places', 'opened', userId, !!keyPair, records.dataUpdatedAt],
    enabled: !!userId && !!keyPair && !!records.data,
    queryFn: async () => {
      await initSodium();
      const places: Place[] = [];
      let unreadable = 0;
      for (const record of records.data?.places ?? []) {
        try {
          const pair = getSessionKeyPairForVersion(userId!, placeKeyVersion(record.encryptedPayload));
          if (!pair) throw new Error('No key for this place');
          places.push({ id: record.id, ...openPlace(record.encryptedPayload, pair.publicKey, pair.secretKey) });
        } catch {
          // Never log the payload: it is the user's location, even if it is ciphertext.
          unreadable += 1;
        }
      }
      return { places, unreadable };
    },
    staleTime: Infinity,
  });

  /** Seals to the active key; the version goes in the envelope for whoever opens it later. */
  async function seal(payload: PlacePayload): Promise<string> {
    await initSodium();
    const pair = userId ? getSessionKeyPair(userId) : null;
    const version = userId ? getActiveKeyVersion(userId) : null;
    if (!pair || version === null) throw new Error('Unlock your encryption key to save places');
    return sealPlace(payload, pair.publicKey, version);
  }

  const refresh = () => qc.invalidateQueries({ queryKey: ['task-places'] });

  const createMutation = useMutation({
    mutationFn: async (payload: PlacePayload): Promise<Place> => {
      const saved = await calendarApi.createTaskPlace(await seal(payload));
      return { id: saved.id, ...payload };
    },
    onSuccess: refresh,
  });

  const renameMutation = useMutation({
    mutationFn: async ({ place, name }: { place: Place; name: string }) => {
      const { id: _id, ...payload } = place;
      await calendarApi.updateTaskPlace(place.id, await seal({ ...payload, name }));
    },
    onSuccess: refresh,
  });

  const removeMutation = useMutation({
    mutationFn: (place: Place) => calendarApi.deleteTaskPlace(place.id),
    onSuccess: () => {
      refresh();
      // The server took the place off its tasks.
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  return {
    places: opened.data?.places ?? [],
    unreadable: opened.data?.unreadable ?? 0,
    locked: !keyPair,
    supported,
    isLoading: records.isLoading || opened.isLoading,
    create: (payload) => createMutation.mutateAsync(payload),
    rename: async (place, name) => { await renameMutation.mutateAsync({ place, name }); },
    remove: async (place) => { await removeMutation.mutateAsync(place); },
  };
}
