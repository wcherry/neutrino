'use client';

import React, { useCallback } from 'react';
import { FillPicker } from '@neutrino/ui';
import type { Background, DriveImageItem, FillImageChoice } from '@neutrino/ui';
import { storageApi } from '@/lib/api';
import {
  driveImageRef,
  importUrlAttachment,
  resolveImageSrc,
  uploadAttachment,
} from '@/lib/driveImages';
import type { ShapeFill, ShapeStyle } from '../types';
import { representativeColor, shapeFillOf } from './utils/shapeFill';

const DRIVE_IMAGE_PAGE = 200;

export interface DiagramFillPickerProps {
  style: ShapeStyle;
  /**
   * Both halves of the change at once: the fill the picker produced and the
   * colour to keep in `fill` beside it, so no caller has to remember that a
   * shape carries a representative colour as well as its fill.
   */
  onChange: (change: { fill: string; fillStyle?: ShapeFill }) => void;
}

/**
 * The shared fill picker, wired to Drive.
 *
 * The connected half lives here for the same reason the slides one does:
 * `@neutrino/ui` has no API dependencies, so listing Drive images and turning a
 * picked one into a stored value are the caller's to supply.
 */
export function DiagramFillPicker({ style, onChange }: DiagramFillPickerProps) {
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
        thumbnailUrl: storageApi.getThumbnailUrl(f.coverThumbnailUrl) ?? undefined,
      }));
  }, []);

  /**
   * A shape fill is part of the diagram, so an image is stored the way every
   * other image in the product is: as a reference to a Drive file. Local files
   * and linked URLs are copied into Attachments first so there is a file to
   * point at.
   */
  const storeImage = useCallback(async (choice: FillImageChoice): Promise<string> => {
    if (choice.kind === 'drive') return driveImageRef(choice.item.id);
    const stored = choice.kind === 'file'
      ? await uploadAttachment(choice.file)
      : await importUrlAttachment(choice.url);
    return driveImageRef(stored.id);
  }, []);

  const resolveImageValue = useCallback((value: string) => resolveImageSrc(value), []);

  const handleChange = useCallback((bg: Background) => {
    const fill = bg as ShapeFill;
    onChange({
      fill: representativeColor(fill, style.fill),
      // A plain colour is stored in `fill` alone: carrying an equivalent
      // `fillStyle` beside it would be a second copy of the same fact, and every
      // diagram written before this has none.
      fillStyle: fill.type === 'color' ? undefined : fill,
    });
  }, [onChange, style.fill]);

  return (
    <FillPicker
      background={shapeFillOf(style) as Background}
      onChange={handleChange}
      presetsKey="neutrino:diagrams:gradientPresets"
      triggerLabel=""
      showAlpha
      onFetchDriveImages={fetchDriveImages}
      onStoreImage={storeImage}
      onResolveImageValue={resolveImageValue}
    />
  );
}
