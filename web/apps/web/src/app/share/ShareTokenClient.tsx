'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Heading, Spinner, Text } from '@neutrino/ui';
import { ApiClientError, getShareDownloadUrl, getSharePreviewUrl, sharingApi } from '@/lib/api';
import styles from './page.module.css';

const DOC_MIME = 'application/x-neutrino-doc';
const SHEET_MIME = 'application/x-neutrino-sheet';
const SLIDE_MIME = 'application/x-neutrino-slide';

function formatExpiresAt(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return expiresAt;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ShareTokenClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['share-token', token],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => sharingApi.resolveToken(token),
  });

  const guestSessionMutation = useMutation({
    mutationFn: () => sharingApi.createGuestSession(token),
    onSuccess: (session) => {
      localStorage.setItem('access_token', session.accessToken);
      const mime = data?.mimeType;
      if (mime === DOC_MIME) {
        router.push(`/docs/editor?id=${data!.resourceId}`);
      } else if (mime === SHEET_MIME) {
        router.push(`/sheets/editor?id=${data!.resourceId}`);
      } else if (mime === SLIDE_MIME) {
        router.push(`/slides/editor?id=${data!.resourceId}`);
      } else {
        router.push('/drive');
      }
    },
  });

  if (!token) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Invalid share link"
          description="This share link is missing a token."
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.page}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    const status = error instanceof ApiClientError ? error.statusCode : null;
    const title = status === 410 ? 'This link has expired' : 'Share link not found';
    const description = status === 410
      ? 'Ask the owner to generate a new share link.'
      : 'The link may have expired or been removed.';
    return (
      <div className={styles.page}>
        <EmptyState title={title} description={description} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Share link not found"
          description="The link may have expired or been removed."
        />
      </div>
    );
  }

  const expiresAt = formatExpiresAt(data.expiresAt);
  const mime = data.mimeType;
  const isNeutrinoDoc = mime === DOC_MIME || mime === SHEET_MIME || mime === SLIDE_MIME;
  const isPlainFile = data.resourceType === 'file' && !isNeutrinoDoc;
  const downloadUrl = getShareDownloadUrl(token);
  const previewUrl = getSharePreviewUrl(token);

  const openLabel =
    mime === DOC_MIME ? 'Open document' :
    mime === SHEET_MIME ? 'Open spreadsheet' :
    mime === SLIDE_MIME ? 'Open presentation' :
    'Open in Drive';

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <div className={styles.header}>
          <Text size="xs" color="muted" weight="semibold">Shared item</Text>
          <Heading level={1} size="lg">{data.resourceName}</Heading>
          <div className={styles.badges}>
            <Badge size="sm" >{data.resourceType}</Badge>
            <Badge size="sm" >{data.role}</Badge>
            <Badge size="sm" >{data.visibility}</Badge>
          </div>
        </div>

        <div className={styles.meta}>
          {expiresAt && (
            <Text size="sm" color="muted">Expires {expiresAt}</Text>
          )}
        </div>

        <div className={styles.actions}>
          {isPlainFile ? (
            <>
              <Button onClick={() => window.location.assign(previewUrl)}>
                View
              </Button>
              <Button variant="secondary" onClick={() => window.location.assign(downloadUrl)}>
                Download
              </Button>
            </>
          ) : (
            <Button
              onClick={() => guestSessionMutation.mutate()}
              disabled={guestSessionMutation.isPending}
            >
              {guestSessionMutation.isPending ? 'Opening…' : openLabel}
            </Button>
          )}
          <Button variant="secondary" onClick={() => router.push('/')}>
            Go to home
          </Button>
        </div>

        {guestSessionMutation.isError && (
          <p style={{ color: '#d93025', fontSize: '0.875rem', margin: 0 }}>
            Failed to open. Please try again.
          </p>
        )}
      </Card>
    </div>
  );
}
