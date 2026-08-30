'use client';

/**
 * The picture on a library tile, and the motion behind it.
 *
 * A motion photo tile shows its still like any other, with a LIVE or MOTION
 * badge, and plays the clip over the top while the pointer is on the card. The
 * clip is never listed as a tile of its own, which is what issues #154 and #156
 * asked for. Nothing is fetched until the first hover: a clip is a megabyte or
 * two and a library screen holds dozens of them.
 *
 * The motion comes from one of two places and this component hides the
 * difference. Apple splits a Live Photo into two Drive files, so the clip is
 * downloaded on its own; Google appends the MP4 to the JPEG's own bytes, so the
 * still is downloaded and the clip sliced out of it at the offset recorded at
 * upload time. Either way the original file is untouched — nothing is
 * re-encoded, and the still keeps being the still.
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
import { motionPhotoLabel, type LibraryItem, type PhotoResponse } from '@neutrino/api-photos';
import { useUser } from '@neutrino/auth';
import { useSessionKeyPair } from '@/hooks/useSessionKeyPair';
import styles from './page.module.css';

/** Download one Drive file and decrypt it, when the session can. */
async function loadPlainBlob(fileId: string, userId: string, unlocked: boolean): Promise<Blob> {
  const downloaded = await storageApi.downloadFile(fileId);
  if (!unlocked) return downloaded;

  await initSodium();
  const keyRef = await encryptionApi.getFileKey(fileId);
  // No key on the server means the file was stored in the clear.
  if (!keyRef) return downloaded;

  const dek = openSealedFileKey(userId, keyRef.encryptedFileKey, keyRef.keyVersion);
  const plain = decryptFile(new Uint8Array(await downloaded.arrayBuffer()), dek);
  return new Blob([plain.buffer as ArrayBuffer]);
}

/** The playable clip for a tile, from whichever file is carrying it. */
async function loadMotionBlob(item: LibraryItem, userId: string, unlocked: boolean): Promise<Blob> {
  const { photo, motion, embedded } = item;
  if (motion) {
    const mimeType = motion.mimeType.startsWith('video/') ? motion.mimeType : 'video/quicktime';
    const blob = await loadPlainBlob(motion.fileId, userId, unlocked);
    return new Blob([blob], { type: mimeType });
  }
  if (embedded) {
    // Google's MP4 is appended to the still, so the clip is a slice of it.
    const blob = await loadPlainBlob(photo.fileId, userId, unlocked);
    return blob.slice(embedded.offset, embedded.offset + embedded.length, 'video/mp4');
  }
  throw new Error('no motion to load');
}

/**
 * Fetch and decrypt a clip the first time `wanted` goes true, then keep it.
 *
 * The URL outlives the hover on purpose — moving on and off a tile is cheap
 * after the first pass, and the blob is released when the tile unmounts.
 */
function useMotionUrl(item: LibraryItem, wanted: boolean): string | null {
  const user = useUser();
  const keyPair = useSessionKeyPair(user?.id);
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);
  const playable = item.motion !== null || item.embedded !== null;

  useEffect(() => {
    if (!wanted || !playable || !user?.id || startedRef.current) return;
    startedRef.current = true;

    loadMotionBlob(item, user.id, keyPair !== null)
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
        console.warn('[photos] motion photo clip could not be loaded', err);
        startedRef.current = false;
      });
  }, [wanted, playable, item, user?.id, keyPair]);

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

export function MotionPhotoMedia({ item, imgSrc, active }: Props) {
  const { photo, isMotionPhoto, subtype } = item;
  const motionUrl = useMotionUrl(item, active);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playing = active && motionUrl !== null;

  // `autoPlay` only fires for the first source an element is given, so playback
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

      {isMotionPhoto && (
        <span
          className={styles.liveBadge}
          title={subtype === 'motion_photo_google' ? 'Google Motion Photo' : 'Apple Live Photo'}
        >
          <span className={styles.liveBadgeDot} aria-hidden="true" />
          {motionPhotoLabel(subtype)}
        </span>
      )}
    </>
  );
}
