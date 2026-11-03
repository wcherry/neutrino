'use client';

import React, { useEffect, useState } from 'react';
import { ChevronRight, File, Folder, Image as ImageIcon } from 'lucide-react';
import { Button, Modal, ModalBody, ModalFooter, Spinner } from '@neutrino/ui';
import type { AtlasModel, DriveItem } from './atlasModel';
import styles from './atlas.module.css';

/**
 * Picks files in the user's Neutrino Drive, the Mac app's `DrivePicker`: images to copy into the
 * page (`images`), or files of any kind to link to (`links`), as chips or as previews. The
 * vault's own folder is left out. Names are file names, which Drive keeps in plaintext; nothing
 * is read until the pick is made.
 */
export function DrivePicker({ model, purpose, onClose }: { model: AtlasModel; purpose: 'images' | 'links'; onClose(): void }) {
  const [trail, setTrail] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'My Drive' }]);
  const [items, setItems] = useState<DriveItem[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Map<string, DriveItem>>(() => new Map());
  const here = trail[trail.length - 1];

  useEffect(() => {
    let live = true;
    setItems(null);
    setFailed(null);
    model.driveFolder(here.id, purpose === 'images').then(
      (found) => live && setItems(found),
      (e) => live && setFailed(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [model, here.id, purpose]);

  const toggle = (item: DriveItem) =>
    setChosen((c) => {
      const next = new Map(c);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });

  const picked = [...chosen.values()];
  const finish = (asPreviews = false) => {
    onClose();
    if (purpose === 'images') void model.insertFromDrive(picked);
    else model.insertLinks(picked, asPreviews);
  };

  return (
    <Modal open onClose={onClose} title={purpose === 'images' ? 'Insert images from Neutrino Drive' : 'Link to Neutrino files'} size="md">
      <ModalBody>
        <nav className={styles.trail} aria-label="Folder">
          {trail.map((t, k) => (
            <React.Fragment key={`${t.id}:${k}`}>
              {k > 0 && <ChevronRight size={14} aria-hidden />}
              <button type="button" className={styles.link} disabled={k === trail.length - 1} onClick={() => setTrail(trail.slice(0, k + 1))}>
                {t.name}
              </button>
            </React.Fragment>
          ))}
        </nav>
        {failed ? (
          <p className={styles.subtitle}>Couldn&rsquo;t list this folder: {failed}</p>
        ) : items === null ? (
          <Spinner size="sm" />
        ) : items.length === 0 ? (
          <p className={styles.subtitle}>{purpose === 'images' ? 'No images or folders here.' : 'Nothing here.'}</p>
        ) : (
          <ul className={styles.pickerList} aria-label="Files">
            {items.map((item) => (
              <li key={item.id}>
                {item.isFolder ? (
                  <button type="button" className={styles.node} onClick={() => setTrail([...trail, { id: item.id, name: item.name }])}>
                    <Folder size={14} />
                    <span>{item.name}</span>
                  </button>
                ) : (
                  <label className={styles.node}>
                    <input type="checkbox" checked={chosen.has(item.id)} onChange={() => toggle(item)} />
                    {(item.mimeType ?? '').startsWith('image/') ? <ImageIcon size={14} /> : <File size={14} />}
                    <span>{item.name}</span>
                  </label>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className={styles.quickHint}>
          {purpose === 'images'
            ? 'The images are copied into this vault, encrypted, so the page keeps them whatever happens to the originals.'
            : 'A link shows as a chip with the file’s name; a preview shows its picture, on a line of its own.'}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        {purpose === 'links' && (
          <Button variant="secondary" disabled={picked.length === 0} onClick={() => finish(true)}>
            Insert as previews
          </Button>
        )}
        <Button disabled={picked.length === 0} onClick={() => finish()}>
          {purpose === 'images' ? 'Insert' : 'Insert links'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
