'use client';

/**
 * The picture on a library tile, and the Live Photo motion behind it.
 *
 * A Live Photo tile shows its still like any other, with a LIVE badge, and
 * plays the paired clip over the top while the pointer is on the card — the
 * clip is never listed as a tile of its own, which is what issue #154 asked
 * for. Nothing is fetched until the first hover: the clip is a megabyte or two
 * and a library screen holds dozens of them.
 *
 * Playback has to decrypt. Photos are E2EE, so `contentUrl` serves ciphertext
 * and a `<video>` pointed straight at it plays nothing and reports no error —
 * the bytes are downloaded, unsealed with the session key and handed to the
 * element as an object URL, the same sequence `PhotoEditor` uses for stills.
 * Files stored before E2EE have no key on the server; those are used as they
 * arrive.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { storageApi, encryptionApi } from '@neutrino/api-drive';
import { initSodium, openSealedFileKey, decryptFile } from '@neutrino/e2e-crypto';
import type { LibraryItem, PhotoResponse } from '@neutrino/api-photos';
import { useUser } from '@neutrino/auth';
import { useSessionKeyPair } from '@/hooks/useSessionKeyPair';
import styles from './page.module.css';

async function loadPlayableBlob(
  photo: PhotoResponse,
  userId: string,
  unlocked: boolean,
): Promise<Blob> {
  const mimeType = photo.mimeType.startsWith('video/') ? photo.mimeType : 'video/quicktime';
  const downloaded = await storageApi.downloadFile(photo.fileId);
  if (!unlocked) return new Blob([downloaded], { type: mimeType });

  await initSodium();
  const keyRef = await encryptionApi.getFileKey(photo.fileId);
  // No key on the server means the file was stored in the clear.
  if (!keyRef) return new Blob([downloaded], { type: mimeType });

  const dek = openSealedFileKey(userId, keyRef.encryptedFileKey, keyRef.keyVersion);
  const plain = decryptFile(new Uint8Array(await downloaded.arrayBuffer()), dek);
  return new Blob([plain.buffer as ArrayBuffer], { type: mimeType });
}

/**
 * Fetch and decrypt a clip the first time `wanted` goes true, then keep it.
 *
 * The URL outlives the hover on purpose — moving on and off a tile is cheap
 * after the first pass, and the blob is released when the tile unmounts.
 */
function useMotionUrl(motion: PhotoResponse | null, wanted: boolean): string | null {
  const user = useUser();
  const keyPair = useSessionKeyPair(user?.id);
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!wanted || !motion || !user?.id || startedRef.current) return;
    startedRef.current = true;

    loadPlayableBlob(motion, user.id, keyPair !== null)
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        // Unmounting mid-download is the pointer leaving a tile that then
        // scrolled away; the blob has to go with it.
        if (!mountedRef.current) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        urlRef.current = objectUrl;
        setUrl(objectUrl);
      })
      .catch((err) => {
        // A clip that will not decrypt just means no motion; the still stays.
        // Clearing the guard lets the next hover try again.
        console.warn('[photos] live photo motion could not be loaded', err);
        startedRef.current = false;
      });
  }, [wanted, motion, user?.id, keyPair]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [],
  );

  return url;
}

interface Props {
  item: LibraryItem;
  /** The still to paint; null when the photo has no thumbnail yet. */
  imgSrc: string | null;
  /** True while the pointer or keyboard focus is on the card. */
  active: boolean;
}

export function LivePhotoMedia({ item, imgSrc, active }: Props) {
  const { photo, motion, isLive } = item;
  const motionUrl = useMotionUrl(motion, active);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playing = active && motionUrl !== null;

  // `autoPlay` only fires for the first source a element is given, so playback
  // is driven explicitly — a tile is hovered many times over its life.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.currentTime = 0;
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing]);

  return (
    <>
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={photo.fileName}
          className={styles.photoImg}
          loading="lazy"
          style={playing ? { opacity: 0 } : undefined}
        />
      ) : (
        <div className={styles.photoPlaceholder}>
          <ImageIcon size={32} />
          <span>{photo.fileName}</span>
        </div>
      )}

      {motionUrl && (
        <video
          ref={videoRef}
          className={styles.photoMotion}
          src={motionUrl}
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          style={playing ? undefined : { opacity: 0 }}
        />
      )}

      {isLive && (
        <span className={styles.liveBadge} title="Live Photo">
          <span className={styles.liveBadgeDot} aria-hidden="true" />
          LIVE
        </span>
      )}
    </>
  );
}
