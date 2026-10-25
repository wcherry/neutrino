/**
 * The local import runner (`lib/localImport/runLocalImport.ts`).
 *
 * Every collaborator is injected through `deps`, so what is under test is the
 * sequencing the import page cannot see: nothing is written without a key,
 * each file lands in the folder its path names, a photo is registered with
 * Photos and a note is indexed, dates are carried across, one failure does not
 * stop the rest, a retry runs only what it is given, and Stop stops.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// The runner's defaults reach for the real API and search index. Every test
// injects its own deps, so these only keep the imports inert.
vi.mock('@/lib/api', () => ({
  uploadDriveFile: vi.fn(),
  photosApi: { registerPhoto: vi.fn() },
  storageApi: { setImportMetadata: vi.fn(), getQuota: vi.fn() },
  filesystemApi: { getFolderContents: vi.fn(), createFolder: vi.fn() },
  encryptionApi: { setFileKey: vi.fn() },
  getCurrentUserId: () => 'user-1',
}));
vi.mock('@/lib/searchIndexUpdate', () => ({ indexOnSave: vi.fn() }));

import {
  runLocalImportStep,
  buildLocalImportSteps,
  type LocalImportDeps,
} from '@/lib/localImport/runLocalImport';
import type { PlannedFile, ImportProduct } from '@/lib/localImport/destinations';
import type { ImportKind } from '@/lib/localImport/classify';
import type { ImportProgress } from '@/lib/takeout';

const USER = 'user-1';
const LAST_MODIFIED = Date.UTC(2021, 5, 14, 9, 30, 15); // 2021-06-14T09:30:15Z

function planned(
  path: string,
  product: ImportProduct,
  opts: { mimeType?: string; kind?: ImportKind; content?: string; lastModified?: number } = {},
): PlannedFile {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const kind: ImportKind =
    opts.kind ?? (product === 'Photos' ? 'media' : product === 'Notes' ? 'markdown' : 'other');
  const mimeType =
    opts.mimeType ?? (product === 'Photos' ? 'image/jpeg' : product === 'Notes' ? 'text/markdown' : 'application/pdf');
  const file = new File([opts.content ?? `bytes of ${name}`], name, {
    type: '',
    lastModified: opts.lastModified ?? LAST_MODIFIED,
  });
  return { source: { file, path, kind, mimeType }, product, mimeType };
}

interface Harness {
  deps: LocalImportDeps;
  upload: ReturnType<typeof vi.fn>;
  registerPhoto: ReturnType<typeof vi.fn>;
  readMotionPhotoInfo: ReturnType<typeof vi.fn>;
  applyImportMetadata: ReturnType<typeof vi.fn>;
  indexNote: ReturnType<typeof vi.fn>;
  canEncrypt: ReturnType<typeof vi.fn>;
  folderFor: ReturnType<typeof vi.fn>;
}

function harness(): Harness {
  let n = 0;
  const upload = vi.fn(async (_file: File, _userId: string, _opts: { folderId: string | null }) => ({
    id: `file-${++n}`,
  }));
  const registerPhoto = vi.fn(async () => ({}));
  const readMotionPhotoInfo = vi.fn(async () => null);
  const applyImportMetadata = vi.fn(async () => {});
  const indexNote = vi.fn();
  const canEncrypt = vi.fn(async () => true);
  const folderFor = vi.fn(async (path: string[]) => (path.length ? `folder:${path.join('/')}` : 'base'));
  return {
    deps: {
      upload,
      registerPhoto,
      readMotionPhotoInfo,
      applyImportMetadata,
      indexNote,
      canEncrypt,
      folderResolver: { folderFor },
    } as unknown as LocalImportDeps,
    upload,
    registerPhoto,
    readMotionPhotoInfo,
    applyImportMetadata,
    indexNote,
    canEncrypt,
    folderFor,
  };
}

function run(
  h: Harness,
  product: ImportProduct,
  files: PlannedFile[],
  extra: Partial<Parameters<typeof runLocalImportStep>[0]> = {},
) {
  return runLocalImportStep({
    product,
    files,
    baseFolderId: 'base',
    userId: USER,
    onProgress: () => {},
    signal: new AbortController().signal,
    deps: h.deps,
    ...extra,
  });
}

let h: Harness;
beforeEach(() => {
  h = harness();
});

describe('runLocalImportStep — encryption', () => {
  it('writes nothing and says so when this device cannot encrypt', async () => {
    h.canEncrypt.mockResolvedValue(false);
    const summary = await run(h, 'Drive', [planned('a/x.pdf', 'Drive'), planned('a/y.pdf', 'Drive')]);

    expect(h.upload).not.toHaveBeenCalled();
    expect(h.folderFor).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ unencrypted: true, cancelled: true, imported: 0 });
  });

  it('asks about the importing user', async () => {
    await run(h, 'Drive', [planned('x.pdf', 'Drive')]);
    expect(h.canEncrypt).toHaveBeenCalledWith(USER);
  });
});

describe('runLocalImportStep — folders and uploads', () => {
  it("puts each file in the folder its path's directories name", async () => {
    await run(h, 'Drive', [planned('Trip/day1/a.pdf', 'Drive'), planned('loose.pdf', 'Drive')]);

    expect(h.folderFor).toHaveBeenCalledWith(['Trip', 'day1']);
    expect(h.folderFor).toHaveBeenCalledWith([]);
    const byName = new Map(h.upload.mock.calls.map((c) => [(c[0] as File).name, c[2]]));
    expect(byName.get('a.pdf')).toMatchObject({ folderId: 'folder:Trip/day1' });
    expect(byName.get('loose.pdf')).toMatchObject({ folderId: 'base' });
  });

  it('uploads the file under its base name with the planned mime type', async () => {
    const md = planned('Notes/ideas.md', 'Drive', { mimeType: 'text/plain', kind: 'markdown' });
    await run(h, 'Drive', [md]);

    const [file, userId] = h.upload.mock.calls[0] as [File, string];
    expect(file.name).toBe('ideas.md');
    expect(file.type).toBe('text/plain');
    expect(userId).toBe(USER);
  });

  it('uploads the original bytes', async () => {
    await run(h, 'Drive', [planned('a/x.pdf', 'Drive', { content: 'exact bytes' })]);
    const [file] = h.upload.mock.calls[0] as [File];
    expect(await file.text()).toBe('exact bytes');
  });

  it('keeps the file dates and records the relative path as the import source', async () => {
    await run(h, 'Drive', [planned('Trip/a.pdf', 'Drive')]);
    const iso = new Date(LAST_MODIFIED).toISOString();
    expect(h.applyImportMetadata).toHaveBeenCalledWith({
      fileId: 'file-1',
      scope: 'local',
      source: 'Trip/a.pdf',
      dates: { createdAt: iso, updatedAt: iso },
    });
  });
});

describe('runLocalImportStep — per product', () => {
  it('registers a photo with Photos, dated in the one format the server parses', async () => {
    await run(h, 'Photos', [planned('Trip/IMG_1.jpg', 'Photos')]);

    expect(h.registerPhoto).toHaveBeenCalledTimes(1);
    const body = h.registerPhoto.mock.calls[0][0] as {
      fileId: string;
      captureDate: string;
      metadata: unknown;
    };
    expect(body.fileId).toBe('file-1');
    expect(body.captureDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(body.metadata).toBeNull();
  });

  it('carries motion-photo info into the registration when the bytes have it', async () => {
    const info = { subtype: 'live_photo_apple', signal: 'content.identifier' };
    h.readMotionPhotoInfo.mockResolvedValue(info);
    await run(h, 'Photos', [planned('Trip/IMG_1.mov', 'Photos', { mimeType: 'video/quicktime' })]);

    expect(h.readMotionPhotoInfo).toHaveBeenCalledTimes(1);
    expect(h.registerPhoto.mock.calls[0][0]).toMatchObject({ metadata: { motionPhoto: info } });
  });

  it('neither registers photos nor indexes notes for Drive files', async () => {
    await run(h, 'Drive', [
      planned('a/IMG.jpg', 'Drive', { mimeType: 'image/jpeg' }),
      planned('a/n.md', 'Drive', { mimeType: 'text/plain' }),
    ]);
    expect(h.registerPhoto).not.toHaveBeenCalled();
    expect(h.indexNote).not.toHaveBeenCalled();
  });

  it('indexes a note for search under its name without the extension', async () => {
    await run(h, 'Notes', [planned('Notes/ideas.md', 'Notes', { content: '# Ideas\n\n- one\n' })]);

    expect(h.indexNote).toHaveBeenCalledWith(USER, {
      id: 'file-1',
      title: 'ideas',
      text: '# Ideas\n\n- one\n',
    });
    expect(h.registerPhoto).not.toHaveBeenCalled();
  });

  it('uploads a note as text/markdown', async () => {
    await run(h, 'Notes', [planned('ideas.md', 'Notes')]);
    expect((h.upload.mock.calls[0][0] as File).type).toBe('text/markdown');
  });
});

describe('runLocalImportStep — results', () => {
  it('reports a failed upload against its path and imports the rest', async () => {
    h.upload.mockImplementation(async (file: File) => {
      if (file.name === 'bad.pdf') throw new Error('HTTP 413 too_large: File too large');
      return { id: `ok-${file.name}` };
    });
    const summary = await run(h, 'Drive', [
      planned('a/good1.pdf', 'Drive'),
      planned('a/bad.pdf', 'Drive'),
      planned('a/good2.pdf', 'Drive'),
    ]);

    expect(summary).toMatchObject({ total: 3, imported: 2, failed: 1, cancelled: false, unencrypted: false });
    const bad = summary.items.find((i) => i.file === 'a/bad.pdf');
    expect(bad).toMatchObject({ file: 'a/bad.pdf', title: 'bad.pdf', status: 'failed' });
    expect(bad?.reason).toContain('File too large');
  });

  it('keys every item by its relative path', async () => {
    const summary = await run(h, 'Drive', [planned('A/b/c.pdf', 'Drive'), planned('d.pdf', 'Drive')]);
    expect(summary.items.map((i) => i.file).sort()).toEqual(['A/b/c.pdf', 'd.pdf']);
    expect(summary.items.every((i) => i.status === 'imported')).toBe(true);
  });

  it('runs only the files a retry names, and counts only them', async () => {
    const summary = await run(
      h,
      'Drive',
      [planned('a/1.pdf', 'Drive'), planned('a/2.pdf', 'Drive'), planned('a/3.pdf', 'Drive')],
      { only: new Set(['a/2.pdf']) },
    );
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect((h.upload.mock.calls[0][0] as File).name).toBe('2.pdf');
    expect(summary.total).toBe(1);
    expect(summary.items.map((i) => i.file)).toEqual(['a/2.pdf']);
  });

  it('reports progress up to the total, naming a file each time', async () => {
    const progress: ImportProgress[] = [];
    const files = [planned('a/1.pdf', 'Drive'), planned('a/2.pdf', 'Drive'), planned('a/3.pdf', 'Drive')];
    await run(h, 'Drive', files, { onProgress: (p) => progress.push({ ...p }) });

    expect(progress.length).toBeGreaterThan(0);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i].done).toBeGreaterThanOrEqual(progress[i - 1].done);
    }
    expect(progress[progress.length - 1].done).toBe(3);
    expect(progress.every((p) => p.total === 3)).toBe(true);
    const names = new Set(['1.pdf', '2.pdf', '3.pdf', 'a/1.pdf', 'a/2.pdf', 'a/3.pdf']);
    expect(progress.every((p) => names.has(p.current))).toBe(true);
  });

  it('stops when the signal aborts, and says it was cancelled', async () => {
    const controller = new AbortController();
    h.upload.mockImplementation(async (file: File) => {
      controller.abort();
      return { id: `id-${file.name}` };
    });
    const files = Array.from({ length: 5 }, (_, i) => planned(`a/${i}.pdf`, 'Drive'));
    const summary = await run(h, 'Drive', files, { signal: controller.signal, concurrency: 1 });

    expect(summary.cancelled).toBe(true);
    expect(h.upload.mock.calls.length).toBeLessThan(5);
  });

  it('keeps no more than `concurrency` uploads in flight', async () => {
    let inFlight = 0;
    let max = 0;
    h.upload.mockImplementation(async (file: File) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { id: `id-${file.name}` };
    });
    const files = Array.from({ length: 8 }, (_, i) => planned(`a/${i}.pdf`, 'Drive'));
    const summary = await run(h, 'Drive', files, { concurrency: 2 });

    expect(max).toBe(2);
    expect(summary.imported).toBe(8);
  });
});

describe('buildLocalImportSteps', () => {
  const mixed = [
    planned('a/n.md', 'Notes'),
    planned('a/x.pdf', 'Drive'),
    planned('a/IMG_1.jpg', 'Photos'),
    planned('a/y.pdf', 'Drive'),
    planned('a/IMG_2.jpg', 'Photos'),
  ];

  it('makes one step per product, Photos then Drive then Notes, counting its files', () => {
    const steps = buildLocalImportSteps({ planned: mixed, baseFolderId: 'base', userId: USER, deps: h.deps });
    expect(steps.map((s) => [s.product, s.count])).toEqual([
      ['Photos', 2],
      ['Drive', 2],
      ['Notes', 1],
    ]);
  });

  it('leaves out products with nothing to import', () => {
    const steps = buildLocalImportSteps({
      planned: [planned('a/x.pdf', 'Drive')],
      baseFolderId: null,
      userId: USER,
      deps: h.deps,
    });
    expect(steps.map((s) => s.product)).toEqual(['Drive']);
  });

  it('makes no steps for an empty plan', () => {
    expect(buildLocalImportSteps({ planned: [], baseFolderId: null, userId: USER, deps: h.deps })).toEqual([]);
  });

  it("runs only its own product's files", async () => {
    const steps = buildLocalImportSteps({ planned: mixed, baseFolderId: 'base', userId: USER, deps: h.deps });
    const photos = steps.find((s) => s.product === 'Photos')!;

    const summary = await photos.run({ onProgress: () => {}, signal: new AbortController().signal });

    expect(summary.total).toBe(2);
    expect(h.upload.mock.calls.map((c) => (c[0] as File).name).sort()).toEqual(['IMG_1.jpg', 'IMG_2.jpg']);
    expect(h.registerPhoto).toHaveBeenCalledTimes(2);
  });

  it('passes a retry set through to the step', async () => {
    const steps = buildLocalImportSteps({ planned: mixed, baseFolderId: 'base', userId: USER, deps: h.deps });
    const drive = steps.find((s) => s.product === 'Drive')!;

    const summary = await drive.run({
      onProgress: () => {},
      signal: new AbortController().signal,
      only: new Set(['a/y.pdf']),
    });

    expect(summary.items.map((i) => i.file)).toEqual(['a/y.pdf']);
  });
});
