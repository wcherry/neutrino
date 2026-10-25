'use client';

/**
 * The state behind `<LocalImport>`: what was picked, where each kind goes, the
 * target folder, the space check, and handing the run to `ImportRunProvider`.
 *
 * The run itself is the provider's, not this hook's — closing the dialog or
 * leaving the wizard step must not stop it — so `start` builds the steps and
 * lets go. What stays here is only what the user is choosing.
 */

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@neutrino/auth';
import { canEncryptFor, storageApi, type QuotaInfo } from '@neutrino/api-drive';
import { useImportRun } from '@/components/ImportRun';
import {
  buildLocalImportSteps,
  checkQuota,
  DEFAULT_DESTINATIONS,
  plannedBytes,
  routeFiles,
  scanFiles,
  type Destination,
  type DestinationChoice,
  type ImportKind,
  type PickedFile,
  type PlannedFile,
  type QuotaCheck,
  type ScanResult,
} from '@/lib/localImport';

/** Shown when the device holds no unlocked key pair — the same words as Drive's Upload. */
export const LOCAL_IMPORT_LOCKED_MESSAGE =
  'Unlock your encryption keys and try again — files are never uploaded unencrypted.';

export interface LocalImportFolder {
  /** `null` is My Drive. */
  id: string | null;
  name: string;
}

export interface UseLocalImportOptions {
  defaultFolderId?: string | null;
  defaultFolderName?: string;
}

/** "“Work” and “Holiday 2026”", "“A”, “B” and 3 more", or "12 files". */
export function pickedLabel(scan: ScanResult): string {
  const quoted = scan.roots.map((r) => `“${r}”`);
  const loose = scan.files.length - scan.files.filter((f) => f.path.includes('/')).length;
  if (quoted.length === 0) return `${scan.files.length.toLocaleString()} ${scan.files.length === 1 ? 'file' : 'files'}`;
  const named =
    quoted.length === 1
      ? quoted[0]
      : quoted.length <= 3
        ? `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
        : `${quoted.slice(0, 2).join(', ')} and ${quoted.length - 2} more`;
  return loose > 0 ? `${named} and ${loose.toLocaleString()} ${loose === 1 ? 'file' : 'files'}` : named;
}

export function useLocalImport({ defaultFolderId = null, defaultFolderName = 'My Drive' }: UseLocalImportOptions = {}) {
  const user = useUser();
  const run = useImportRun();

  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [scanning, setScanning] = useState(false);
  const [choice, setChoice] = useState<DestinationChoice>(DEFAULT_DESTINATIONS);
  const [folder, setFolder] = useState<LocalImportFolder>({ id: defaultFolderId, name: defaultFolderName });
  const [error, setError] = useState<string | null>(null);

  const quotaQuery = useQuery<QuotaInfo>({
    queryKey: ['quota'],
    queryFn: () => storageApi.getQuota(),
    staleTime: 30_000,
  });

  const scan = useMemo<ScanResult | null>(() => (picked.length > 0 ? scanFiles(picked) : null), [picked]);
  const planned = useMemo<PlannedFile[]>(() => (scan ? routeFiles(scan.files, choice) : []), [scan, choice]);
  const bytes = useMemo(() => plannedBytes(planned), [planned]);
  const fileCount = planned.length;
  // No answer yet (or the call failed) is not a reason to refuse: the server
  // still refuses an upload over quota, and the item says why.
  const quotaCheck = useMemo<QuotaCheck>(
    () => (quotaQuery.data ? checkQuota(quotaQuery.data, bytes) : { ok: true }),
    [quotaQuery.data, bytes],
  );

  /** Add a pick to what was picked before, one entry per path. */
  const addPicked = useCallback((more: PickedFile[]) => {
    setError(null);
    setPicked((prev) => {
      const seen = new Set(prev.map((p) => p.path));
      const added = more.filter((p) => {
        if (seen.has(p.path)) return false;
        seen.add(p.path);
        return true;
      });
      return added.length > 0 ? [...prev, ...added] : prev;
    });
  }, []);

  /** Run an async producer of picked files (a drop's directory walk), with `scanning` set meanwhile. */
  const addPickedAsync = useCallback(
    async (producer: Promise<PickedFile[]>) => {
      setScanning(true);
      try {
        addPicked(await producer);
      } catch {
        setError('Those files could not be read. Try choosing them with the buttons instead.');
      } finally {
        setScanning(false);
      }
    },
    [addPicked],
  );

  const clear = useCallback(() => {
    setPicked([]);
    setChoice(DEFAULT_DESTINATIONS);
    setError(null);
  }, []);

  const setDestination = useCallback((kind: ImportKind, destination: Destination) => {
    setChoice((prev) => ({ ...prev, [kind]: destination }));
  }, []);

  const isRunning = run.state.status === 'running';
  const canStart = !!scan && fileCount > 0 && quotaCheck.ok && !isRunning;

  /** Hand the run to the provider. Resolves to whether it started. */
  const start = useCallback(async (): Promise<boolean> => {
    if (!scan || fileCount === 0 || !quotaCheck.ok || run.state.status === 'running') return false;
    if (!(await canEncryptFor(user?.id))) {
      setError(LOCAL_IMPORT_LOCKED_MESSAGE);
      return false;
    }
    setError(null);
    run.start({
      fileName: pickedLabel(scan),
      archive: { close: async () => {} },
      steps: buildLocalImportSteps({ planned, baseFolderId: folder.id, userId: user?.id }),
      kind: 'local',
    });
    return true;
  }, [scan, fileCount, quotaCheck.ok, run, user?.id, planned, folder.id]);

  return {
    scan,
    scanning,
    choice,
    folder,
    quota: quotaQuery.data ?? null,
    planned,
    fileCount,
    bytes,
    quotaCheck,
    error,
    canStart,
    addPicked,
    addPickedAsync,
    clear,
    setDestination,
    setFolder,
    start,
  };
}

export type UseLocalImportResult = ReturnType<typeof useLocalImport>;
