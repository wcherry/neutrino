'use client';

import React, { useEffect, useState } from 'react';
import { BLANK_IMAGE, parseDriveImageRef, peekDriveImageUrl, resolveDriveImageUrl } from '@/lib/driveImages';

/**
 * Resolves a src that may be a `neutrino-drive:<fileId>` reference.
 *
 * Anything else — an http URL, a data URL — is returned unchanged, so surfaces
 * using this keep rendering documents written before images became references.
 */
export function useResolvedImageSrc(src: string | null | undefined): string {
  const fileId = parseDriveImageRef(src);

  // Seeded from the cache so an image that has already resolved paints on the
  // first render, with no blank frame — the common case once one slide has
  // been shown, or when the same photo appears more than once.
  const [resolved, setResolved] = useState<string>(() =>
    fileId ? peekDriveImageUrl(fileId) ?? BLANK_IMAGE : src ?? BLANK_IMAGE,
  );

  useEffect(() => {
    if (!fileId) {
      setResolved(src ?? BLANK_IMAGE);
      return;
    }

    const cached = peekDriveImageUrl(fileId);
    if (cached) {
      setResolved(cached);
      return;
    }

    let cancelled = false;
    setResolved(BLANK_IMAGE);
    resolveDriveImageUrl(fileId)
      .then((url) => { if (!cancelled) setResolved(url); })
      .catch(() => { if (!cancelled) setResolved(BLANK_IMAGE); });
    return () => { cancelled = true; };
  }, [fileId, src]);

  return resolved;
}

export type DriveImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | null | undefined;
};

/** An `<img>` that understands Drive references. */
export function DriveImage({ src, alt = '', ...rest }: DriveImageProps) {
  const resolved = useResolvedImageSrc(src);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={resolved} alt={alt} {...rest} />;
}
