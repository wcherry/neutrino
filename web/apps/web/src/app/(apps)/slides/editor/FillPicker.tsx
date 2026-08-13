'use client';

import { useCallback } from 'react';
import { FillPicker } from '@neutrino/ui';
import type { Background, BackgroundTheme, DriveImageItem, FillImageChoice } from '@neutrino/ui';
import { storageApi } from '@/lib/api';
import {
  driveImageRef,
  importUrlAttachment,
  resolveImageSrc,
  uploadAttachment,
} from '@/lib/driveImages';
import type { SlideBackground, Theme } from './slideEditorTypes';

const DRIVE_IMAGE_PAGE = 200;

export default function SlidesFillPicker({
  background,
  onChange,
  theme,
}: {
  background: SlideBackground;
  onChange: (bg: SlideBackground) => void;
  theme?: Theme;
}) {
  const fetchDriveImages = useCallback(async (): Promise<DriveImageItem[]> => {
    const { items } = await storageApi.listFiles({
      limit: DRIVE_IMAGE_PAGE,
      orderBy: 'updatedAt',
      direction: 'desc',
    });
    return items
      .filter((f) => typeof f.mimeType === 'string' && f.mimeType.startsWith('image/'))
      .map((f) => ({
        id: f.id,
        name: f.name,
        url: storageApi.getFileDownloadUrl(f.id),
        thumbnailUrl: f.coverThumbnail
          ? `data:${f.coverThumbnailMimeType ?? 'image/jpeg'};base64,${f.coverThumbnail}`
          : undefined,
      }));
  }, []);

  /**
   * A background is part of the presentation, so it is stored the same way an
   * image element is: as a reference to a Drive file. Local files and linked
   * URLs are copied into Attachments first so there is a file to point at.
   */
  const storeImage = useCallback(async (choice: FillImageChoice): Promise<string> => {
    if (choice.kind === 'drive') return driveImageRef(choice.item.id);
    const stored = choice.kind === 'file'
      ? await uploadAttachment(choice.file)
      : await importUrlAttachment(choice.url);
    return driveImageRef(stored.id);
  }, []);

  const resolveImageValue = useCallback((value: string) => resolveImageSrc(value), []);

  return (
    <FillPicker
      background={background as Background}
      onChange={onChange as (bg: Background) => void}
      theme={theme as BackgroundTheme | undefined}
      presetsKey="neutrino:slides:gradientPresets"
      triggerLabel="BG"
      onFetchDriveImages={fetchDriveImages}
      onStoreImage={storeImage}
      onResolveImageValue={resolveImageValue}
    />
  );
}
