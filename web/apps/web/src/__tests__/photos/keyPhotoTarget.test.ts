/**
 * Who sees **Choose Key Photo** (issue #317): an Apple Live Photo with its clip,
 * that the user may edit — and nothing else.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getFileInfo = vi.fn();
const listPhotosByFiles = vi.fn();
const getFolderContents = vi.fn();

vi.mock('@neutrino/api-drive', () => ({
  storageApi: { getFileInfo: (...a: unknown[]) => getFileInfo(...a) },
  filesystemApi: { getFolderContents: (...a: unknown[]) => getFolderContents(...a) },
}));
vi.mock('@neutrino/api-photos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@neutrino/api-photos')>();
  return { ...actual, photosApi: { listPhotosByFiles: (...a: unknown[]) => listPhotosByFiles(...a) } };
});
vi.mock('@neutrino/auth', () => ({ useUser: () => ({ id: 'user-1' }) }));

import { resolveKeyPhotoTarget } from '@/app/(apps)/photos/useKeyPhotoTarget';

function info(id: string, name: string, mimeType: string, role = 'owner') {
  return { id, name, mimeType, folderId: 'folder-1', sizeBytes: 1, yourRole: role, contentVersion: 1, coverThumbnailUrl: null };
}

function record(fileId: string, metadata: Record<string, unknown>) {
  return { id: `photo-${fileId}`, fileId, fileName: fileId, mimeType: 'image/heic', metadata };
}

const roles: Record<string, string> = {};

beforeEach(() => {
  getFileInfo.mockReset();
  listPhotosByFiles.mockReset();
  getFolderContents.mockReset();
  for (const k of Object.keys(roles)) delete roles[k];
  getFileInfo.mockImplementation(async (id: string) =>
    id === 'still' ? info('still', 'IMG_1.HEIC', 'image/heic', roles.still) : info(id, 'IMG_1.MOV', 'video/quicktime', roles[id]),
  );
  listPhotosByFiles.mockResolvedValue([]);
  getFolderContents.mockResolvedValue({ folder: null, folders: [], files: [] });
});

describe('resolveKeyPhotoTarget', () => {
  it('offers it for a still whose record links its clip', async () => {
    listPhotosByFiles.mockImplementation(async (ids: string[]) =>
      ids[0] === 'still' ? [record('still', { device: { liveVideoFileID: 'clip' } })] : [],
    );
    const target = await resolveKeyPhotoTarget('still', 'user-1');
    expect(target).toMatchObject({ stillFileId: 'still', clipFileId: 'clip', keyPhoto: null });
  });

  it('offers it for a same-named clip beside the still', async () => {
    getFolderContents.mockResolvedValue({
      folder: null,
      folders: [],
      files: [{ id: 'mov', name: 'IMG_1.MOV', mimeType: 'video/quicktime', folderId: 'folder-1', sizeBytes: 2 }],
    });
    expect(await resolveKeyPhotoTarget('still', 'user-1')).toMatchObject({ clipFileId: 'mov', photo: null });
  });

  it('carries the key-photo record, which is what offers Revert', async () => {
    const keyPhoto = { originalVersionId: 'v1', originalName: 'IMG_1.HEIC', originalMimeType: 'image/heic' };
    listPhotosByFiles.mockImplementation(async (ids: string[]) =>
      ids[0] === 'still' ? [record('still', { device: { liveVideoFileID: 'clip' }, keyPhoto })] : [],
    );
    expect((await resolveKeyPhotoTarget('still', 'user-1'))?.keyPhoto).toMatchObject(keyPhoto);
  });

  it('is not offered to someone who may only view the still', async () => {
    roles.still = 'viewer';
    listPhotosByFiles.mockResolvedValue([record('still', { device: { liveVideoFileID: 'clip' } })]);
    expect(await resolveKeyPhotoTarget('still', 'user-1')).toBeNull();
  });

  it('is not offered when the clip cannot be edited', async () => {
    roles.clip = 'commenter';
    listPhotosByFiles.mockImplementation(async (ids: string[]) =>
      ids[0] === 'still' ? [record('still', { device: { liveVideoFileID: 'clip' } })] : [],
    );
    expect(await resolveKeyPhotoTarget('still', 'user-1')).toBeNull();
  });

  it('is not offered for a Google Motion Photo, whose clip is inside the JPEG', async () => {
    listPhotosByFiles.mockResolvedValue([
      record('still', { motionPhoto: { subtype: 'motion_photo_google', signal: 'x', embedded: { offset: 1, length: 2 } } }),
    ]);
    expect(await resolveKeyPhotoTarget('still', 'user-1')).toBeNull();
  });

  it('is not offered for a picture with no clip', async () => {
    expect(await resolveKeyPhotoTarget('still', 'user-1')).toBeNull();
  });
});
