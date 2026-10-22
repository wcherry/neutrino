'use client';

import dynamic from 'next/dynamic';

/**
 * `ChartRenderer`, loaded the first time a sheet shows or creates a chart. It is the only
 * importer of recharts (≈ 340 KB parsed with its d3 modules), which every sheet used to pay for
 * on open whether it had a chart or not.
 */
export const ChartRenderer = dynamic(() => import('./ChartRenderer').then((m) => m.ChartRenderer), {
  ssr: false,
});
