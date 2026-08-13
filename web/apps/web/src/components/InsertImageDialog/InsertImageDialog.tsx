'use client';

import React, { useCallback } from 'react';
import {
  ImagePickerDialog,
  type ImagePickerDriveItem,
  type ImagePickerResult,
  type ImageSource,
} from '@neutrino/ui';
import { storageApi } from '@/lib/api';
import {
  importUrlAttachment,
  resolveDriveImageUrl,
  uploadAttachment,
} from '@/lib/driveImages';
import type { FileItem } from '@neutrino/api-drive';

export type { ImagePickerResult, ImageSource };

interface InsertImageDialogProps {
  onInsert: (result: ImagePickerResult) => void;
  onClose: () => void;
  defaultSource?: ImageSource;
  title?: string;
  confirmLabel?: string;
}

/** Files are listed a page at a time; the server applies this limit in SQL. */
const PAGE_SIZE = 200;
/** Stop once the grid has this many images — more than anyone browses by eye. */
const TARGET_IMAGES = 200;
/** Hard ceiling on files scanned, so a huge Drive can't spin here forever. */
const MAX_PAGES = 12;

/**
 * Prefix test rather than a fixed list: Drive stores whatever MIME type the
 * browser reported at upload (or `mime_guess` inferred from the name), so
 * `image/heic`, `image/x-icon` and friends turn up and are all insertable.
 */
function isImageFile(item: FileItem): boolean {
  return typeof item.mimeType === 'string' && item.mimeType.startsWith('image/');
}

function toPickerItem(item: FileItem): ImagePickerDriveItem {
  return {
    id: item.id,
    name: item.name,
    url: storageApi.getFileDownloadUrl(item.id),
    // Browse the grid off the stored thumbnails where they exist, so opening the
    // picker doesn't download every full-size image in the user's Drive.
    thumbnailUrl: item.coverThumbnail
      ? `data:${item.coverThumbnailMimeType ?? 'image/jpeg'};base64,${item.coverThumbnail}`
      : undefined,
  };
}

/**
 * The app-wide "add an image" control — Drive, local file, or URL, each with a
 * preview before it is inserted. This wrapper supplies the Drive plumbing that
 * `@neutrino/ui` deliberately does not depend on; every editor should use it
 * rather than growing its own picker.
 */
export function InsertImageDialog({
  onInsert,
  onClose,
  defaultSource,
  title,
  confirmLabel,
}: InsertImageDialogProps) {
  const fetchDriveImages = useCallback(async (): Promise<ImagePickerDriveItem[]> => {
    // There is no server-side image filter: `listFiles` accepts a `type` in its
    // query type but drops it before building the request, and the repository's
    // only MIME filter is an exact match on a single type — which cannot express
    // "any image". So the limit is applied by the server and the filtering
    // happens here, and a single page is not enough: every doc/note/sheet
    // autosave bumps `updatedAt`, so the newest pages are almost entirely
    // documents and a Drive of a few hundred files pushes every image past the
    // cutoff. Page through instead, newest first, until enough images turn up.
    const images: ImagePickerDriveItem[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const { items } = await storageApi.listFiles({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        orderBy: 'updatedAt',
        direction: 'desc',
      });

      images.push(...items.filter(isImageFile).map(toPickerItem));

      // A short page means the listing is exhausted. The response's `total` is
      // no help — the backend sets it to the length of the page it just built,
      // not the number of files that matched.
      if (items.length < PAGE_SIZE || images.length >= TARGET_IMAGES) break;
    }

    return images.slice(0, TARGET_IMAGES);
  }, []);

  /** Resolution (download + decrypt when encrypted) is shared with the renderers. */
  const resolveDriveImage = useCallback(
    (item: ImagePickerDriveItem) => resolveDriveImageUrl(item.id),
    [],
  );

  const uploadLocalFile = useCallback(
    async (file: File, onProgress: (percent: number) => void): Promise<ImagePickerDriveItem> => {
      return toPickerItem(await uploadAttachment(file, onProgress));
    },
    [],
  );

  const importUrlImage = useCallback(
    async (url: string, onProgress: (percent: number) => void): Promise<ImagePickerDriveItem> => {
      return toPickerItem(await importUrlAttachment(url, onProgress));
    },
    [],
  );

  return (
    <ImagePickerDialog
      title={title}
      confirmLabel={confirmLabel}
      defaultSource={defaultSource}
      onFetchDriveImages={fetchDriveImages}
      onResolveDriveImage={resolveDriveImage}
      onUploadLocalFile={uploadLocalFile}
      onImportUrlImage={importUrlImage}
      onInsert={onInsert}
      onClose={onClose}
    />
  );
}
