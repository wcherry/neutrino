'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Heading, Spinner, Text } from '@neutrino/ui';
import { ApiClientError } from '@neutrino/api-core';
import {
  getShareDownloadUrl,
  getSharePreviewUrl,
  linkKeyMatches,
  sharingApi,
  type GuestSessionResponse,
  type LinkSession,
} from '@neutrino/api-drive';
import dynamic from 'next/dynamic';

// Only a folder link needs the browser (and its crypto), and `/share` is a signed-out page with a
// tight route budget, so it is loaded when a folder link opens rather than for every visitor.
const LinkFolderBrowser = dynamic(
  () => import('./LinkFolderBrowser').then((m) => m.LinkFolderBrowser),
  { ssr: false, loading: () => <Spinner size="lg" /> },
);

/**
 * The link key in a URL fragment (`#k=<43 base64url chars>`), or null. The same rule as
 * `seedFromFragment` in `@neutrino/e2e-crypto`, inlined so this page does not import the crypto
 * package's barrel (and libsodium's wrappers with it) just to read a string.
 */
function seedFromHash(hash: string): string | null {
  const seed = new URLSearchParams(hash.replace(/^#/, '')).get('k');
  return seed && /^[A-Za-z0-9_-]{43}$/.test(seed) ? seed : null;
}
import { officeAppForFile, type OfficeApp } from '@/lib/officeFormats';
import styles from './page.module.css';

const EDITOR_PATH: Record<OfficeApp, string> = {
  docs: '/docs/editor?id=',
  sheets: '/sheets/editor?id=',
  slides: '/slides/editor?id=',
};

const OPEN_LABEL: Record<OfficeApp, string> = {
  docs: 'Open document',
  sheets: 'Open spreadsheet',
  slides: 'Open presentation',
};

/**
 * Which editor a shared file opens in, or null for a file that has none.
 *
 * The mime type alone is not enough since issue #127: a document written here
 * is a real `.docx`, so the suite's own documents reach this page looking like
 * any other upload. Treating them as one offered the recipient a raw download
 * of bytes that are E2EE ciphertext, with no way to open the document at all.
 */
function editorAppFor(
  resource: { resourceType: string; mimeType?: string | null; resourceName: string },
): OfficeApp | null {
  if (resource.resourceType !== 'file') return null;
  const mime = resource.mimeType ?? '';
  return officeAppForFile(mime, resource.resourceName);
}

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

  // The link key (#321) travels in the fragment, which the server never sees. Read once: the
  // fragment is not part of `useSearchParams`, and nothing here changes it.
  const [seed, setSeed] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    setSeed(seedFromHash(window.location.hash));
  }, []);

  // A password-protected link's session, and the password it was opened with, kept in memory
  // only so an hour-old session can be renewed without asking again.
  const passwordRef = React.useRef<string | undefined>(undefined);
  const [unlocked, setUnlocked] = React.useState<GuestSessionResponse | null>(null);
  const [folder, setFolder] = React.useState<LinkSession | null>(null);
  const [folderProblem, setFolderProblem] = React.useState<string | null>(null);

  const isFolder = data?.resourceType === 'folder';

  /** Open a folder link: a session, then the check that the URL's key is this link's key. */
  const openFolder = React.useCallback(
    async (session: GuestSessionResponse) => {
      if (!session.publicKey) {
        // A folder link from before link keys: plaintext files only, but browsable.
        setFolder({ session, seed: seed ?? '' });
        return;
      }
      if (!seed) {
        setFolderProblem(
          'This link is incomplete. The part after the # is missing, and it holds the key to the files. Ask the person who shared it to send the whole link.',
        );
        return;
      }
      const candidate = { session, seed };
      if (!(await linkKeyMatches(candidate))) {
        setFolderProblem('This link is damaged: its key does not match the folder. Ask for the link again.');
        return;
      }
      setFolder(candidate);
    },
    [seed],
  );

  const renew = React.useCallback(async (): Promise<LinkSession | null> => {
    try {
      const session = await sharingApi.createGuestSession(token, passwordRef.current);
      return { session, seed: seed ?? '' };
    } catch {
      return null;
    }
  }, [token, seed]);

  const unlockMutation = useMutation({
    mutationFn: (password: string) => sharingApi.createGuestSession(token, password),
    onSuccess: (session, password) => {
      passwordRef.current = password;
      setUnlocked(session);
      if (session.resourceType === 'folder') void openFolder(session);
    },
  });

  // A folder link with no password opens straight away once the fragment has been read.
  const folderSessionMutation = useMutation({
    mutationFn: () => sharingApi.createGuestSession(token),
    onSuccess: (session) => void openFolder(session),
    onError: (e) =>
      setFolderProblem(
        e instanceof ApiClientError && e.statusCode === 410
          ? 'This link has expired.'
          : 'This link could not be opened.',
      ),
  });
  const startFolder = folderSessionMutation.mutate;
  const folderStarted = folderSessionMutation.isIdle === false;
  React.useEffect(() => {
    if (isFolder && !data?.passwordRequired && seed !== undefined && !folderStarted) startFolder();
  }, [isFolder, data?.passwordRequired, seed, folderStarted, startFolder]);

  const guestSessionMutation = useMutation({
    mutationFn: () =>
      unlocked ? Promise.resolve(unlocked) : sharingApi.createGuestSession(token, passwordRef.current),
    onSuccess: (session) => {
      localStorage.setItem('access_token', session.accessToken);
      const resource = unlocked ?? data;
      const app = resource
        ? editorAppFor({
            resourceType: session.resourceType ?? resource.resourceType,
            resourceName: session.resourceName ?? '',
            mimeType: data?.mimeType,
          })
        : null;
      router.push(app ? `${EDITOR_PATH[app]}${session.resourceId}` : '/drive');
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

  if (data.passwordRequired && !unlocked) {
    return (
      <div className={styles.page}>
        <Card className={styles.card}>
          <PasswordGate
            pending={unlockMutation.isPending}
            error={
              unlockMutation.error instanceof ApiClientError
                ? unlockMutation.error.statusCode === 429
                  ? 'Too many wrong passwords. Wait a few minutes and try again.'
                  : unlockMutation.error.statusCode === 401
                    ? 'That password is not right.'
                    : 'This link could not be opened.'
                : unlockMutation.error
                  ? 'This link could not be opened.'
                  : null
            }
            onSubmit={(password) => unlockMutation.mutate(password)}
          />
        </Card>
      </div>
    );
  }

  if (isFolder) {
    if (folderProblem) {
      return (
        <div className={styles.page}>
          <EmptyState title="This folder cannot be opened" description={folderProblem} />
        </div>
      );
    }
    if (!folder) {
      return (
        <div className={styles.page}>
          <Spinner size="lg" />
        </div>
      );
    }
    return (
      <div className={styles.browserPage}>
        <LinkFolderBrowser token={token} initial={folder} renew={renew} />
      </div>
    );
  }

  const resourceName = unlocked?.resourceName ?? data.resourceName;
  const role = unlocked?.role ?? data.role;
  const expiresAt = formatExpiresAt(data.expiresAt);
  const editorApp = editorAppFor({ ...data, resourceName });
  const isPlainFile = data.resourceType === 'file' && !editorApp;
  // A password-protected link's public download needs that link's session as the bearer.
  const sessionQuery = unlocked ? `?token=${encodeURIComponent(unlocked.accessToken)}` : '';
  const downloadUrl = getShareDownloadUrl(token) + sessionQuery;
  const previewUrl = getSharePreviewUrl(token) + sessionQuery;

  const openLabel = editorApp ? OPEN_LABEL[editorApp] : 'Open in Drive';

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <div className={styles.header}>
          <Text size="xs" color="muted" weight="semibold">Shared item</Text>
          <Heading level={1} size="lg">{resourceName}</Heading>
          <div className={styles.badges}>
            <Badge size="sm" >{data.resourceType}</Badge>
            <Badge size="sm" >{role}</Badge>
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
          <p style={{ color: 'var(--palette-red-50)', fontSize: '0.875rem', margin: 0 }}>
            Failed to open. Please try again.
          </p>
        )}
      </Card>
    </div>
  );
}

/** The password prompt a protected link shows before revealing anything about what it shares. */
function PasswordGate({
  pending,
  error,
  onSubmit,
}: {
  pending: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
}) {
  const [value, setValue] = React.useState('');
  return (
    <form
      className={styles.header}
      onSubmit={(e) => {
        e.preventDefault();
        if (value) onSubmit(value);
      }}
    >
      <Text size="xs" color="muted" weight="semibold">Shared item</Text>
      <Heading level={1} size="lg">This link needs a password</Heading>
      <Text size="sm" color="muted">Enter the password the person who shared it gave you.</Text>
      <input
        type="password"
        className={styles.textInput}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Link password"
        autoComplete="current-password"
        autoFocus
        disabled={pending}
      />
      {error && (
        <div role="alert">
          <Text size="sm" color="error">{error}</Text>
        </div>
      )}
      <div className={styles.actions}>
        <Button type="submit" disabled={pending || !value}>
          {pending ? 'Checking…' : 'Open'}
        </Button>
      </div>
    </form>
  );
}
