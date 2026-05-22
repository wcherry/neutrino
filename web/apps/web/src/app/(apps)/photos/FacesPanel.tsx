'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, X } from 'lucide-react';
import { facesApi, type FaceResponse, type PhotoResponse } from '@/lib/api';
import styles from './FacesPanel.module.css';

interface Props {
  photo: PhotoResponse;
  onClose: () => void;
  onHoverFace?: (face: FaceResponse | null) => void;
}

export function FacesPanel({ photo, onClose, onHoverFace }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['faces', photo.id],
    queryFn: () => facesApi.listFaces(photo.id),
    staleTime: 60_000,
  });

  const faces = data?.faces ?? [];

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Users size={15} />
          <span>Faces in this photo</span>
          {faces.length > 0 && (
            <span className={styles.count}>{faces.length}</span>
          )}
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close faces panel">
          <X size={14} />
        </button>
      </div>

      <div className={styles.body}>
        {isLoading ? (
          <p className={styles.hint}>Detecting faces…</p>
        ) : faces.length === 0 ? (
          <p className={styles.hint}>No faces detected</p>
        ) : (
          <div className={styles.grid}>
            {faces.map((face) => (
              <FaceThumbnail
                key={face.id}
                face={face}
                onMouseEnter={() => onHoverFace?.(face)}
                onMouseLeave={() => onHoverFace?.(null)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FaceThumbnail({
  face,
  onMouseEnter,
  onMouseLeave,
}: {
  face: FaceResponse;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const src =
    face.thumbnail && face.thumbnailMimeType
      ? `data:${face.thumbnailMimeType};base64,${face.thumbnail}`
      : null;

  const pct = Math.round((face.boundingBox?.confidence ?? 0) * 100);

  return (
    <div
      className={styles.thumb}
      title={`${pct}% confidence`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {src ? (
        <img src={src} alt="Detected face" className={styles.thumbImg} />
      ) : (
        <div className={styles.thumbPlaceholder}>
          <Users size={20} />
        </div>
      )}
    </div>
  );
}
