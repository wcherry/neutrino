'use client';

import dynamic from 'next/dynamic';
import { Spinner } from '@neutrino/ui';

/**
 * Neutrino Atlas: a knowledge base of Markdown pages in a Drive folder, end-to-end encrypted,
 * the web counterpart of the Mac app (agent_docs/neutrino-atlas.md). The app, its parser and
 * its editor load after the page, so they don't weigh on its first load.
 */
const AtlasApp = dynamic(() => import('./AtlasApp').then((m) => m.AtlasApp), {
  ssr: false,
  loading: () => <Spinner label="Opening Atlas" />,
});

export default function AtlasPage() {
  return <AtlasApp />;
}
