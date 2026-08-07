'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Spinner, Button, Text, Heading } from '@neutrino/ui';
import { storageApi } from '@/lib/api';
import { hrefForKind, hrefForMime, isAppLinkKind } from './appLink';

type State =
  | { status: 'resolving' }
  | { status: 'error'; message: string };

/**
 * Redirects a `/open/<kind>/<id>` Universal Link to the editor that owns the file.
 *
 * Nothing is rendered on the happy path beyond a spinner: this route exists so the link works in a
 * browser, and the destination is always a page that already exists.
 *
 * The id comes from `useParams` rather than the server, because the app is a static export — the
 * SPA fallback serves `index.html` for every real id and the route is resolved client-side (the
 * same arrangement `/users/[id]` uses).
 */
export default function OpenLinkClient() {
  const params = useParams<{ kind: string; id: string }>();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: 'resolving' });

  const kind = params?.kind ?? '';
  // Ids are path segments, so they arrive percent-encoded.
  const id = decodeURIComponent(params?.id ?? '');

  useEffect(() => {
    // The placeholder `generateStaticParams` entry. Reached only by crawling the exported build,
    // never by a real link.
    if (!id || id === '_') {
      setState({ status: 'error', message: 'This link is missing a file.' });
      return;
    }
    if (!isAppLinkKind(kind)) {
      setState({ status: 'error', message: 'This link points to something Neutrino doesn’t recognise.' });
      return;
    }

    const known = hrefForKind(kind, id);
    if (known) {
      router.replace(known);
      return;
    }

    // `/open/file/<id>` names a file without saying what it is, so the server has to.
    let cancelled = false;
    storageApi
      .getFileMetadata(id)
      .then((file) => {
        if (!cancelled) router.replace(hrefForMime(file.id, file.mimeType));
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: 'That file couldn’t be opened. It may have been deleted, or you may not have access to it.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kind, id, router]);

  if (state.status === 'error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, height: '60vh', textAlign: 'center', padding: 24 }}>
        <Heading level={2}>Can’t open this link</Heading>
        <Text color="secondary">{state.message}</Text>
        <Button onClick={() => router.replace('/drive')}>Go to Drive</Button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <Spinner size="lg" />
    </div>
  );
}
