'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ShapeType } from '../../types';
import { SHAPE_CATEGORIES } from './ShapeLibrary';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CustomLibraryShape {
  id: string;
  type: ShapeType;
  label: string;
}

export interface CustomShapeLibrary {
  id: string;
  name: string;
  shapes: CustomLibraryShape[];
}

export interface DrawioShape {
  id: string;
  title: string;
  w: number;
  h: number;
  xml: string;
  /** Direct data URI for image-based shapes (e.g. flat-color-icons format) */
  previewUrl?: string;
}

export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface ThirdPartyLibrary {
  id: string;
  name: string;
  url: string;
  shapes: DrawioShape[];
  loadStatus: LoadStatus;
  error?: string;
}

// ---------------------------------------------------------------------------
// Known libraries
// ---------------------------------------------------------------------------

export const KNOWN_DRAWIO_LIBRARIES = [
  { name: 'Cisco SAFE', url: 'https://raw.githubusercontent.com/jgraph/drawio-libs/master/libs/cisco_safe.xml' },
  { name: 'Computer Network', url: 'https://raw.githubusercontent.com/jgraph/drawio-libs/master/libs/computer_network.xml' },
  { name: 'Rack Diagrams', url: 'https://raw.githubusercontent.com/jgraph/drawio-libs/master/libs/rack_general.xml' },
  { name: 'Floor Plan', url: 'https://raw.githubusercontent.com/jgraph/drawio-libs/master/libs/floorplan.xml' },
  { name: 'ArchiMate 3', url: 'https://raw.githubusercontent.com/jgraph/drawio-libs/master/libs/archimate3.xml' },
  { name: 'C4 Architecture', url: 'https://raw.githubusercontent.com/jgraph/drawio-libs/master/libs/c4.xml' },
];

// ---------------------------------------------------------------------------
// Persistence types — thirdPartyMeta is no longer stored; server is source of truth
// ---------------------------------------------------------------------------

interface PersistedConfig {
  hiddenBuiltins: string[];
  hiddenThirdParty: string[];
  customLibraries: CustomShapeLibrary[];
  libraryOrder?: string[];
}

const STORAGE_KEY = 'neutrino:diagrams:shapeLibraries';

function loadFromStorage(): PersistedConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedConfig;
  } catch {
    return null;
  }
}

function saveToStorage(config: PersistedConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage errors
  }
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

interface PrivateLibraryListItem {
  id: string;
  name: string;
  url: string;
  storagePath: string;
  createdAt: string;
}

interface PrivateLibraryDetail {
  id: string;
  name: string;
  url: string;
  xmlContent: string;
}

function getAuthToken(): string {
  return typeof window !== 'undefined'
    ? (localStorage.getItem('access_token') ?? '')
    : '';
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getAuthToken()}` };
}

async function apiListPrivateLibraries(): Promise<PrivateLibraryListItem[]> {
  const res = await fetch('/api/v1/diagrams/private-libraries', {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { libraries: PrivateLibraryListItem[] };
  return data.libraries;
}

async function apiGetPrivateLibrary(id: string): Promise<PrivateLibraryDetail> {
  const res = await fetch(`/api/v1/diagrams/private-libraries/${id}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<PrivateLibraryDetail>;
}

async function apiCreatePrivateLibrary(
  name: string,
  url: string
): Promise<PrivateLibraryListItem> {
  const res = await fetch('/api/v1/diagrams/private-libraries', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, url }),
  });
  if (res.status === 409) throw new ConflictError('Library with this URL already exists');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<PrivateLibraryListItem>;
}

async function apiDeletePrivateLibrary(id: string): Promise<void> {
  const res = await fetch(`/api/v1/diagrams/private-libraries/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  // 404 is acceptable — treat as already deleted
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
}

class ConflictError extends Error {
  readonly isConflict = true;
}

// ---------------------------------------------------------------------------
// Drawio XML parser
// ---------------------------------------------------------------------------

interface RawDrawioItem {
  title?: string;
  label?: string;
  w?: number;
  h?: number;
  xml?: string;
  style?: string;
  aspect?: string;
  /** Direct data URI — used by flat-color-icons, kubernetes, and many modern drawio-libs */
  data?: string;
}

export function parseDrawioXml(xmlText: string): DrawioShape[] {
  // The opening tag may carry a title attribute: <mxlibrary title="Kubernetes">
  const match = /<mxlibrary[^>]*>([\s\S]*?)<\/mxlibrary>/.exec(xmlText);
  if (!match) return [];
  try {
    const items = JSON.parse(match[1]) as RawDrawioItem[];
    return items.map((item, idx) => ({
      id: `tp-shape-${idx}`,
      title: item.title ?? item.label ?? `Shape ${idx + 1}`,
      w: item.w ?? 100,
      h: item.h ?? 100,
      xml: item.xml ?? item.style ?? '',
      // data is a ready-made data URI — use it directly as the preview image
      previewUrl: item.data,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useShapeLibraries() {
  const [ready, setReady] = useState(false);
  const [hiddenBuiltins, setHiddenBuiltins] = useState<string[]>([]);
  const [hiddenThirdParty, setHiddenThirdParty] = useState<string[]>([]);
  const [customLibraries, setCustomLibraries] = useState<CustomShapeLibrary[]>([]);
  const [thirdParty, setThirdParty] = useState<ThirdPartyLibrary[]>([]);
  const [libraryOrder, setLibraryOrder] = useState<string[]>([]);

  // Track which library IDs we have already queued/fetched
  const fetchedRef = useRef<Set<string>>(new Set());

  // Load local prefs from localStorage and third-party list from server on mount
  useEffect(() => {
    const stored = loadFromStorage();
    const builtinKeys = (SHAPE_CATEGORIES as readonly string[]).map((cat) => `builtin:${cat}`);

    // Restore local-only prefs immediately
    const localHiddenBuiltins: string[] = stored?.hiddenBuiltins ?? [];
    const localHiddenThirdParty: string[] = stored?.hiddenThirdParty ?? [];
    const localCustomLibraries: CustomShapeLibrary[] = stored?.customLibraries ?? [];
    setHiddenBuiltins(localHiddenBuiltins);
    setHiddenThirdParty(localHiddenThirdParty);
    setCustomLibraries(localCustomLibraries);

    // Fetch third-party library list from server
    apiListPrivateLibraries()
      .then((list) => {
        const restored: ThirdPartyLibrary[] = list.map((item) => ({
          id: item.id,
          name: item.name,
          url: item.url,
          shapes: [],
          loadStatus: 'idle' as LoadStatus,
        }));
        setThirdParty(restored);

        // Merge stored order with all current keys (handles new builtins, additions, removals)
        const customKeys = localCustomLibraries.map((l) => `custom:${l.id}`);
        const tpKeys = list.map((l) => `tp:${l.id}`);
        const allKeys = [...builtinKeys, ...customKeys, ...tpKeys];
        const storedOrder = stored?.libraryOrder ?? [];
        setLibraryOrder([
          ...storedOrder.filter((k) => allKeys.includes(k)),
          ...allKeys.filter((k) => !storedOrder.includes(k)),
        ]);
      })
      .catch(() => {
        // If the API fails, fall back to an empty third-party list but still
        // apply the stored order for built-in and custom libraries
        const customKeys = localCustomLibraries.map((l) => `custom:${l.id}`);
        const allKeys = [...builtinKeys, ...customKeys];
        const storedOrder = stored?.libraryOrder ?? [];
        setLibraryOrder([
          ...storedOrder.filter((k) => allKeys.includes(k)),
          ...allKeys.filter((k) => !storedOrder.includes(k)),
        ]);
      })
      .finally(() => {
        setReady(true);
      });
  }, []);

  // Persist local prefs whenever state changes (but only after initial load).
  // thirdPartyMeta is intentionally excluded — the server is now the source of truth.
  useEffect(() => {
    if (!ready) return;
    const config: PersistedConfig = {
      hiddenBuiltins,
      hiddenThirdParty,
      customLibraries,
      libraryOrder,
    };
    saveToStorage(config);
  }, [ready, hiddenBuiltins, hiddenThirdParty, customLibraries, libraryOrder]);

  // Auto-fetch content for third-party libraries that are idle and not yet queued
  useEffect(() => {
    const idle = thirdParty.filter(
      (lib) => lib.loadStatus === 'idle' && !fetchedRef.current.has(lib.id)
    );
    if (idle.length === 0) return;

    // Mark all idle as loading immediately (prevents double-processing)
    const idleIds = new Set(idle.map((l) => l.id));
    idle.forEach((lib) => fetchedRef.current.add(lib.id));

    setThirdParty((prev) =>
      prev.map((lib) =>
        idleIds.has(lib.id) ? { ...lib, loadStatus: 'loading' as LoadStatus } : lib
      )
    );

    // Fetch each one from the backend
    idle.forEach((lib) => {
      apiGetPrivateLibrary(lib.id)
        .then((detail) => {
          const shapes = parseDrawioXml(detail.xmlContent);
          setThirdParty((prev) =>
            prev.map((l) =>
              l.id === lib.id
                ? { ...l, shapes, loadStatus: 'loaded' as LoadStatus, error: undefined }
                : l
            )
          );
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Unknown error';
          setThirdParty((prev) =>
            prev.map((l) =>
              l.id === lib.id
                ? { ...l, loadStatus: 'error' as LoadStatus, error: message }
                : l
            )
          );
        });
    });
  }, [thirdParty]);

  // ---------------------------------------------------------------------------
  // Built-in visibility
  // ---------------------------------------------------------------------------

  const isBuiltinVisible = useCallback(
    (cat: string) => !hiddenBuiltins.includes(cat),
    [hiddenBuiltins]
  );

  const setBuiltinVisible = useCallback((cat: string, vis: boolean) => {
    setHiddenBuiltins((prev) =>
      vis ? prev.filter((c) => c !== cat) : prev.includes(cat) ? prev : [...prev, cat]
    );
  }, []);

  const isThirdPartyVisible = useCallback(
    (id: string) => !hiddenThirdParty.includes(id),
    [hiddenThirdParty]
  );

  const setThirdPartyVisible = useCallback((id: string, vis: boolean) => {
    setHiddenThirdParty((prev) =>
      vis ? prev.filter((i) => i !== id) : prev.includes(id) ? prev : [...prev, id]
    );
  }, []);

  // ---------------------------------------------------------------------------
  // Custom libraries
  // ---------------------------------------------------------------------------

  const generateId = (): string =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const createCustomLibrary = useCallback((name: string): string => {
    const id = generateId();
    setCustomLibraries((prev) => [...prev, { id, name, shapes: [] }]);
    setLibraryOrder((prev) => [...prev, `custom:${id}`]);
    return id;
  }, []);

  const deleteCustomLibrary = useCallback((id: string) => {
    setCustomLibraries((prev) => prev.filter((lib) => lib.id !== id));
    setLibraryOrder((prev) => prev.filter((k) => k !== `custom:${id}`));
  }, []);

  const renameCustomLibrary = useCallback((id: string, name: string) => {
    setCustomLibraries((prev) =>
      prev.map((lib) => (lib.id === id ? { ...lib, name } : lib))
    );
  }, []);

  const addToCustom = useCallback(
    (libraryId: string, shape: Omit<CustomLibraryShape, 'id'>) => {
      setCustomLibraries((prev) =>
        prev.map((lib) => {
          if (lib.id !== libraryId) return lib;
          // Skip if a shape with the same type already exists
          if (lib.shapes.some((s) => s.type === shape.type)) return lib;
          return {
            ...lib,
            shapes: [...lib.shapes, { id: generateId(), ...shape }],
          };
        })
      );
    },
    []
  );

  const removeFromCustom = useCallback((libraryId: string, shapeId: string) => {
    setCustomLibraries((prev) =>
      prev.map((lib) =>
        lib.id === libraryId
          ? { ...lib, shapes: lib.shapes.filter((s) => s.id !== shapeId) }
          : lib
      )
    );
  }, []);

  // ---------------------------------------------------------------------------
  // Third-party libraries
  // ---------------------------------------------------------------------------

  const addThirdParty = useCallback(async (name: string, url: string): Promise<void> => {
    // Optimistically add a loading entry so the UI responds immediately
    const tempId = `tmp-${Date.now()}`;
    const placeholderLib: ThirdPartyLibrary = {
      id: tempId,
      name,
      url,
      shapes: [],
      loadStatus: 'loading',
    };
    setThirdParty((prev) => [...prev, placeholderLib]);
    setLibraryOrder((prev) => [...prev, `tp:${tempId}`]);

    try {
      const created = await apiCreatePrivateLibrary(name, url);
      // Fetch the XML content from the server
      const detail = await apiGetPrivateLibrary(created.id);
      const shapes = parseDrawioXml(detail.xmlContent);

      // Replace the placeholder with the real entry
      fetchedRef.current.add(created.id);
      setThirdParty((prev) =>
        prev.map((lib) =>
          lib.id === tempId
            ? {
                id: created.id,
                name: created.name,
                url: created.url,
                shapes,
                loadStatus: 'loaded' as LoadStatus,
                error: undefined,
              }
            : lib
        )
      );
      setLibraryOrder((prev) =>
        prev.map((k) => (k === `tp:${tempId}` ? `tp:${created.id}` : k))
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to add library';
      // Update the placeholder to show the error state
      setThirdParty((prev) =>
        prev.map((lib) =>
          lib.id === tempId
            ? { ...lib, loadStatus: 'error' as LoadStatus, error: message }
            : lib
        )
      );
    }
  }, []);

  const removeThirdParty = useCallback((id: string) => {
    // Remove from local state immediately (optimistic)
    fetchedRef.current.delete(id);
    setThirdParty((prev) => prev.filter((lib) => lib.id !== id));
    setLibraryOrder((prev) => prev.filter((k) => k !== `tp:${id}`));

    // Best-effort server delete — 404 is treated as already gone
    apiDeletePrivateLibrary(id).catch(() => {
      // Deletion already reflected in local state; nothing further to do
    });
  }, []);

  const reorderLibraries = useCallback((newOrder: string[]) => {
    setLibraryOrder(newOrder);
  }, []);

  const retryThirdParty = useCallback((id: string) => {
    // Remove from the fetched set so the effect will re-process it
    fetchedRef.current.delete(id);
    setThirdParty((prev) =>
      prev.map((lib) =>
        lib.id === id
          ? { ...lib, loadStatus: 'idle' as LoadStatus, error: undefined, shapes: [] }
          : lib
      )
    );
  }, []);

  return {
    ready,
    isBuiltinVisible,
    setBuiltinVisible,
    isThirdPartyVisible,
    setThirdPartyVisible,
    libraryOrder,
    reorderLibraries,
    custom: customLibraries,
    createCustomLibrary,
    deleteCustomLibrary,
    renameCustomLibrary,
    addToCustom,
    removeFromCustom,
    thirdParty,
    addThirdParty,
    removeThirdParty,
    retryThirdParty,
  };
}
