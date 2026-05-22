'use client';

import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Heading, Spinner } from '@neutrino/ui';
import { MapPin } from 'lucide-react';
import { photosApi, type MapPhotoItem } from '@/lib/api';
import styles from './page.module.css';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function PhotoMap({ items }: { items: MapPhotoItem[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current || items.length === 0) return;

    // Dynamically import leaflet to avoid SSR issues
    import('leaflet').then((L) => {
      if (!mapRef.current) return;

      // Fix default icon paths for leaflet in Next.js
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }

      const map = L.map(mapRef.current).setView([0, 0], 2);
      leafletMapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      const bounds: [number, number][] = [];

      items.forEach((item) => {
        const thumbSrc = `/api/v1/photos/${item.id}/thumbnail`;
        const popupHtml = `
          <div class="${styles.popup}">
            <img src="${thumbSrc}" class="${styles.popupThumb}" alt="" onerror="this.style.display='none'" />
            <div class="${styles.popupDate}">${formatDate(item.captureDate)}</div>
          </div>
        `;
        L.marker([item.latitude, item.longitude])
          .addTo(map)
          .bindPopup(popupHtml);
        bounds.push([item.latitude, item.longitude]);
      });

      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    });

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  return <div ref={mapRef} className={styles.mapEl} />;
}

export default function PhotoMapPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['photos-map'],
    queryFn: () => photosApi.getMap(),
  });

  const items = data?.items ?? [];

  return (
    <div className={styles.page}>
      {/* Leaflet CSS */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        crossOrigin=""
      />
      <div className={styles.header}>
        <MapPin size={20} />
        <Heading level={1} size="xl">Photo Map</Heading>
        {!isLoading && (
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            {items.length} photo{items.length !== 1 ? 's' : ''} with location
          </span>
        )}
      </div>

      <div className={styles.mapContainer}>
        {isLoading ? (
          <div className={styles.empty}>
            <Spinner size="lg" />
          </div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>
            <MapPin size={48} />
            <p>No photos with GPS data found.</p>
            <p style={{ fontSize: 'var(--font-size-sm)' }}>
              Photos with location metadata will appear here.
            </p>
          </div>
        ) : (
          <PhotoMap items={items} />
        )}
      </div>
    </div>
  );
}
