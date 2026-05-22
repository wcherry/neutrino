'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '@neutrino/ui';
import { Image as ImageIcon } from 'lucide-react';
import { personsApi, type PersonResponse, type PhotoResponse } from '@/lib/api';
import styles from './PersonTimelinePanel.module.css';

function isImageMime(mime: string) {
  return mime.startsWith('image/');
}

function TimelinePhoto({ photo }: { photo: PhotoResponse }) {
  const src =
    photo.thumbnail && photo.thumbnailMimeType
      ? `data:${photo.thumbnailMimeType};base64,${photo.thumbnail}`
      : null;

  return (
    <div className={styles.timelinePhoto} title={photo.fileName}>
      {src || isImageMime(photo.mimeType) ? (
        <img
          src={src ?? photo.contentUrl}
          alt={photo.fileName}
          className={styles.timelinePhotoImg}
          loading="lazy"
        />
      ) : (
        <div className={styles.timelinePhotoPlaceholder}>
          <ImageIcon size={18} />
        </div>
      )}
    </div>
  );
}

export function PersonTimelinePanel({ person }: { person: PersonResponse }) {
  const timelineQuery = useQuery({
    queryKey: ['personTimeline', person.id],
    queryFn: () => personsApi.getPersonTimeline(person.id),
  });

  if (timelineQuery.isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="sm" />
      </div>
    );
  }

  if (timelineQuery.isError) {
    return <p className={styles.empty}>Failed to load timeline.</p>;
  }

  const groups = timelineQuery.data?.groups ?? [];

  if (groups.length === 0) {
    return <p className={styles.empty}>No photos with date information yet.</p>;
  }

  return (
    <div className={styles.timeline}>
      {groups.map((group) => (
        <div key={group.month} className={styles.timelineGroup}>
          <h4 className={styles.timelineGroupLabel}>{group.label}</h4>
          <div className={styles.timelinePhotoGrid}>
            {group.photos.map((photo) => (
              <TimelinePhoto key={photo.id} photo={photo} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
