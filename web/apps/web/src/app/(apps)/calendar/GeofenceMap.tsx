'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import styles from './page.module.css';

interface GeofenceMapProps {
  lat: number;
  lng: number;
  radiusM: number;
  /** A click on the map moves the point there. */
  onMove: (lat: number, lng: number) => void;
}

/**
 * The point a task reminds you at, and the circle you have to enter, on OpenStreetMap tiles as
 * the photo map uses. Leaflet loads only when this is shown. Vector shapes only, so there are no
 * marker images to fetch.
 */
export function GeofenceMap({ lat, lng, radiusM, onMove }: GeofenceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const circleRef = useRef<import('leaflet').Circle | null>(null);
  const dotRef = useRef<import('leaflet').CircleMarker | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  // The map, once.
  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView([lat, lng], 15);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      circleRef.current = L.circle([lat, lng], { radius: radiusM, color: '#d97706', weight: 2, fillOpacity: 0.15 }).addTo(map);
      dotRef.current = L.circleMarker([lat, lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#d97706', fillOpacity: 1 }).addTo(map);
      map.on('click', (e: import('leaflet').LeafletMouseEvent) => onMoveRef.current(e.latlng.lat, e.latlng.lng));
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Created once; the effect below follows the point and radius.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    circleRef.current?.setLatLng([lat, lng]).setRadius(radiusM);
    dotRef.current?.setLatLng([lat, lng]);
    const map = mapRef.current;
    if (map && circleRef.current) map.fitBounds(circleRef.current.getBounds(), { padding: [24, 24], maxZoom: 17 });
  }, [lat, lng, radiusM]);

  return <div ref={containerRef} className={styles.geofenceMap} data-testid="geofence-map" />;
}
