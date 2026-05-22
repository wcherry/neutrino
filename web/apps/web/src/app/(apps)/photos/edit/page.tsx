'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Button, Heading, Spinner } from '@neutrino/ui';
import { Sliders, Image as ImageIcon, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { photosApi, type PhotoEditParams } from '@/lib/api';
import styles from './page.module.css';

const FILTERS = ['none', 'vintage', 'bw', 'sepia', 'vivid', 'cool', 'warm'];

const DEFAULT_EDITS: PhotoEditParams = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  highlights: 0,
  shadows: 0,
  rotate: 0,
  filter: 'none',
};

function SliderRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className={styles.sliderRow}>
      <div className={styles.sliderLabel}>
        <span>{label}</span>
        <span className={styles.sliderValue}>{value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        className={styles.slider}
        min={-1}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export default function PhotoEditPage() {
  const searchParams = useSearchParams();
  const photoId = searchParams.get('id');
  const queryClient = useQueryClient();

  const [edits, setEdits] = useState<PhotoEditParams>(DEFAULT_EDITS);
  const [isDirty, setIsDirty] = useState(false);

  const photoQuery = useQuery({
    queryKey: ['photo', photoId],
    queryFn: () => photosApi.getPhoto(photoId!),
    enabled: !!photoId,
  });

  const editsQuery = useQuery({
    queryKey: ['photo-edits', photoId],
    queryFn: () => photosApi.getEdits(photoId!),
    enabled: !!photoId,
  });

  useEffect(() => {
    if (editsQuery.data) {
      setEdits({ ...DEFAULT_EDITS, ...editsQuery.data.edits });
    }
  }, [editsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => photosApi.saveEdits(photoId!, edits),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['photo-edits', photoId] });
      setIsDirty(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => photosApi.deleteEdits(photoId!),
    onSuccess: () => {
      setEdits(DEFAULT_EDITS);
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ['photo-edits', photoId] });
    },
  });

  const updateField = useCallback(<K extends keyof PhotoEditParams>(key: K, value: PhotoEditParams[K]) => {
    setEdits((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }, []);

  const rotate = useCallback((dir: 'cw' | 'ccw') => {
    setEdits((prev) => {
      const current = prev.rotate ?? 0;
      const next = ((current + (dir === 'cw' ? 90 : -90)) + 360) % 360;
      return { ...prev, rotate: next };
    });
    setIsDirty(true);
  }, []);

  const photo = photoQuery.data;
  const thumbSrc = photo?.thumbnail && photo?.thumbnailMimeType
    ? `data:${photo.thumbnailMimeType};base64,${photo.thumbnail}`
    : photo
    ? `/api/v1/photos/${photoId}/thumbnail`
    : null;

  if (!photoId) {
    return (
      <div className={styles.noPhoto}>
        <ImageIcon size={48} />
        <p>No photo selected. Add ?id=PHOTO_ID to the URL.</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Sliders size={20} />
        <Heading level={1} size="xl">
          {photo ? photo.fileName : 'Photo Editor'}
        </Heading>
        <div className={styles.headerActions}>
          {isDirty && (
            <span className={styles.saving}>Unsaved changes</span>
          )}
          <Button
            variant="ghost"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            icon={<Trash2 size={14} />}
          >
            Reset
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!isDirty || saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Edits'}
          </Button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.preview}>
          {photoQuery.isLoading ? (
            <Spinner size="lg" />
          ) : thumbSrc ? (
            <img
              src={thumbSrc}
              alt={photo?.fileName ?? 'Photo'}
              className={styles.previewImg}
              style={{
                filter: [
                  `brightness(${1 + (edits.brightness ?? 0)})`,
                  `contrast(${1 + (edits.contrast ?? 0)})`,
                  `saturate(${1 + (edits.saturation ?? 0)})`,
                  edits.filter === 'bw' ? 'grayscale(1)' : '',
                  edits.filter === 'sepia' ? 'sepia(0.8)' : '',
                ]
                  .filter(Boolean)
                  .join(' '),
                transform: `rotate(${edits.rotate ?? 0}deg)`,
              }}
            />
          ) : (
            <div className={styles.previewPlaceholder}>
              <ImageIcon size={48} />
              <span>No preview available</span>
            </div>
          )}
        </div>

        <div className={styles.controls}>
          {editsQuery.isLoading ? (
            <Spinner size="md" />
          ) : (
            <>
              <div className={styles.section}>
                <p className={styles.sectionTitle}>Light</p>
                <SliderRow
                  label="Brightness"
                  value={edits.brightness ?? 0}
                  onChange={(v) => updateField('brightness', v)}
                />
                <SliderRow
                  label="Contrast"
                  value={edits.contrast ?? 0}
                  onChange={(v) => updateField('contrast', v)}
                />
                <SliderRow
                  label="Highlights"
                  value={edits.highlights ?? 0}
                  onChange={(v) => updateField('highlights', v)}
                />
                <SliderRow
                  label="Shadows"
                  value={edits.shadows ?? 0}
                  onChange={(v) => updateField('shadows', v)}
                />
              </div>

              <div className={styles.section}>
                <p className={styles.sectionTitle}>Color</p>
                <SliderRow
                  label="Saturation"
                  value={edits.saturation ?? 0}
                  onChange={(v) => updateField('saturation', v)}
                />
                <SliderRow
                  label="Warmth"
                  value={edits.warmth ?? 0}
                  onChange={(v) => updateField('warmth', v)}
                />
              </div>

              <div className={styles.section}>
                <p className={styles.sectionTitle}>Orientation</p>
                <div className={styles.rotateRow}>
                  <button className={styles.rotateBtn} onClick={() => rotate('ccw')}>
                    <RotateCcw size={14} /> CCW
                  </button>
                  <button className={styles.rotateBtn} onClick={() => rotate('cw')}>
                    <RotateCw size={14} /> CW
                  </button>
                </div>
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  Current: {edits.rotate ?? 0}&deg;
                </p>
              </div>

              <div className={styles.section}>
                <p className={styles.sectionTitle}>Filters</p>
                <div className={styles.filterGrid}>
                  {FILTERS.map((f) => (
                    <button
                      key={f}
                      className={`${styles.filterBtn} ${edits.filter === f ? styles.filterBtnActive : ''}`}
                      onClick={() => updateField('filter', f === 'none' ? undefined : f)}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
