'use client';

import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, ChevronRight, Copy, Link2, Link2Off, Loader2, RefreshCw, ShieldAlert, ShieldCheck, ShieldX, Upload } from 'lucide-react';
import { Button, Modal, ModalHeader, ModalBody, ModalFooter, Spinner, useToast } from '@neutrino/ui';
import { authApi, calendarApi, useAuth, type UpdateProfileRequest, type ConnectionProvider, type ConnectionResponse, type CreateAppleConnectionRequest } from '@/lib/api';
import { initSodium, loadKeyPair, hasKeyPair, subscribeToLockState, toBase64, fromBase64, toBase64url, fingerprintFor, keyPairMatches, clearSession } from '@neutrino/e2e-crypto';
import { clearSearchIndex } from '@neutrino/search';
import { clearDriveImageCache } from '@/lib/driveImages';
import { getKeyringState, adoptKeyPair } from '@neutrino/auth';
import { requestEncryptionGate } from '@/components/E2EEUnlockGate';
import { KeyManagementPanel } from './KeyManagementPanel';
import { useAiSettings, type AiSettings } from '@/hooks/useAiSettings';
import { usePhotoSettings } from '@/hooks/usePhotoSettings';
import { useTheme, type ThemeChoice } from '@/providers/ThemeProvider';
import { ThemeGrid } from '@/components/theme/ThemeGrid';
import { useFeatureFlags, type FeatureFlags } from '@/providers/FeatureFlagsProvider';
import { rebuildSearchIndex } from '@/lib/searchIndexer';
import { APP_VERSION, BUILD_ID } from '@/lib/version';
import { forceUploadSnapshot } from '@/lib/searchIndexSnapshot';
import {
  WEEK_START_KEY,
  DAY_START_HOUR_KEY,
  DAY_END_HOUR_KEY,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_DAY_END_HOUR,
} from '../calendar/constants';
import styles from './page.module.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEK_START_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 6, label: 'Saturday' },
];

function fmtHour(h: number): string {
  if (h === 0) return '12:00 AM';
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return '12:00 PM';
  if (h === 24) return 'Midnight';
  return `${h - 12}:00 PM`;
}

const DAY_START_OPTIONS: { value: number; label: string }[] = Array.from(
  { length: 24 },
  (_, i) => ({ value: i, label: fmtHour(i) })
);

const DAY_END_OPTIONS: { value: number; label: string }[] = Array.from(
  { length: 24 },
  (_, i) => ({ value: i + 1, label: fmtHour(i + 1) })
);

const PROVIDER_LABELS: Record<ConnectionProvider, string> = {
  google: 'Google Calendar',
  outlook: 'Outlook / Microsoft 365',
  apple: 'Apple Calendar (iCloud)',
};

const PROVIDER_DESCRIPTIONS: Record<ConnectionProvider, string> = {
  google: 'Sync via Google Calendar API',
  outlook: 'Sync via Microsoft Graph API',
  apple: 'Sync via CalDAV',
};

/** Read by `useSearchIndexSync` to skip the periodic background index sync. */
const SEARCH_SYNC_DISABLED_KEY = 'neutrino:search:syncDisabled';

type Tab = 'ai' | 'appearance' | 'notifications' | 'account' | 'calendar' | 'advanced';

const TABS: { id: Tab; label: string; flag?: keyof FeatureFlags }[] = [
  { id: 'ai', label: 'AI Assistant' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'account', label: 'Account' },
  { id: 'advanced', label: 'Advanced' },
];

// ---------------------------------------------------------------------------
// Calendar sub-components
// ---------------------------------------------------------------------------

function AppleConnectModal({
  onClose,
  onConnect,
  isPending,
}: {
  onClose: () => void;
  onConnect: (req: CreateAppleConnectionRequest) => void;
  isPending: boolean;
}) {
  const [caldavUrl, setCaldavUrl] = useState('https://caldav.icloud.com');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!caldavUrl.trim() || !username.trim() || !password.trim()) return;
    onConnect({ caldavUrl: caldavUrl.trim(), username: username.trim(), password });
  }

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title="Connect Apple Calendar" onClose={onClose} />
      <ModalBody>
        <p className={styles.modalNote}>
          Apple Calendar uses CalDAV. Generate an app-specific password at
          appleid.apple.com and use your Apple ID email as the username.
        </p>
        <form id="apple-connect-form" onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>CalDAV Server URL</label>
            <input className={styles.formInput} value={caldavUrl} onChange={(e) => setCaldavUrl(e.target.value)} placeholder="https://caldav.icloud.com" required />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Apple ID (email)</label>
            <input className={styles.formInput} type="email" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@icloud.com" autoFocus required />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>App-specific password</label>
            <input className={styles.formInput} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="xxxx-xxxx-xxxx-xxxx" required />
          </div>
        </form>
      </ModalBody>
      <ModalFooter>
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button form="apple-connect-form" type="submit" disabled={isPending}>{isPending ? 'Connecting…' : 'Connect'}</Button>
      </ModalFooter>
    </Modal>
  );
}

function ConnectionRow({
  provider, connection, onConnect, onDisconnect, onSync, isSyncing, isDisconnecting,
}: {
  provider: ConnectionProvider;
  connection: ConnectionResponse | undefined;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
  isSyncing: boolean;
  isDisconnecting: boolean;
}) {
  const connected = !!connection;
  return (
    <div className={styles.connectionRow}>
      <div className={styles.connectionInfo}>
        <div className={styles.connectionName}>{PROVIDER_LABELS[provider]}</div>
        <div className={styles.connectionDesc}>
          {connected && connection.email ? connection.email : PROVIDER_DESCRIPTIONS[provider]}
        </div>
      </div>
      <div className={styles.connectionActions}>
        {connected && (
          <button className={styles.iconBtn} onClick={onSync} disabled={isSyncing} title="Sync now">
            <RefreshCw size={14} className={isSyncing ? styles.spinning : undefined} />
          </button>
        )}
        {connected ? (
          <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={onDisconnect} disabled={isDisconnecting} title="Disconnect">
            <Link2Off size={14} />
          </button>
        ) : (
          <button className={styles.connectBtn} onClick={onConnect}>
            <Link2 size={13} />Connect<ChevronRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const router = useRouter();

const qc = useQueryClient();
  const { user } = useAuth();
  const flags = useFeatureFlags();
  const visibleTabs = TABS.filter((tab) => !tab.flag || flags[tab.flag]);

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('tab') as Tab | null;
      if (param && visibleTabs.some((t) => t.id === param)) return param;
    }
    return 'ai';
  });

  const { setTheme: applyTheme } = useTheme();

  // ── AI settings ────────────────────────────────────────────────────────────
  const { settings: aiSettings, setSettings: setAiSettings } = useAiSettings();
  const [aiProvider, setAiProvider] = useState<AiSettings['provider']>(aiSettings.provider);
  const [aiApiKey, setAiApiKey] = useState(aiSettings.apiKey);
  const [aiSaved, setAiSaved] = useState(false);

  // ── Photos settings ──────────────────────────────────────────────────────────
  const { autoFaceDetect, setAutoFaceDetect } = usePhotoSettings();

  function handleAiSave() {
    setAiSettings({ provider: aiProvider, apiKey: aiApiKey });
    setAiSaved(true);
    setTimeout(() => setAiSaved(false), 2000);
  }

  // ── Profile data ───────────────────────────────────────────────────────────
  const { data: details, isLoading } = useQuery({
    queryKey: ['profile-details'],
    queryFn: () => authApi.getProfileDetails(),
    enabled: !!user,
  });

  // ── Notifications state ────────────────────────────────────────────────────
  const [emailMarketing, setEmailMarketing] = useState(false);
  const [emailGeneral, setEmailGeneral] = useState(true);
  const [emailUpdates, setEmailUpdates] = useState(true);
  const [emailCritical, setEmailCritical] = useState(true);

  // ── Account state ──────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [nameSaved, setNameSaved] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // ── Encryption key state ───────────────────────────────────────────────────
  const [keyStatus, setKeyStatus] = useState<'loading' | 'unlocked' | 'locked' | 'needs-device' | 'none'>('loading');
  const [showExportKey, setShowExportKey] = useState(false);
  const [exportedKeyJson, setExportedKeyJson] = useState('');
  const [keyCopied, setKeyCopied] = useState(false);
  const [importKeyValue, setImportKeyValue] = useState('');
  const [importKeyError, setImportKeyError] = useState('');
  const [importKeySaved, setImportKeySaved] = useState(false);
  const [keyFingerprint, setKeyFingerprint] = useState('');

  // ── Advanced state ─────────────────────────────────────────────────────────
  const [searchSyncDisabled, setSearchSyncDisabled] = useState<boolean>(false);
  const [rebuildingIndex, setRebuildingIndex] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState<{ done: number; total: number } | null>(null);

  // ── Calendar state ─────────────────────────────────────────────────────────
  const { success: toastSuccess, error: toastError } = useToast();
  const [weekStart, setWeekStart] = useState<number>(0);
  const [dayStartHour, setDayStartHourState] = useState<number>(DEFAULT_DAY_START_HOUR);
  const [dayEndHour, setDayEndHourState] = useState<number>(DEFAULT_DAY_END_HOUR);
  const [showAppleModal, setShowAppleModal] = useState(false);

  /**
   * Whether a key exists is partly a local question (does this device hold a
   * wrapped copy?) and partly a server one (has the account published a public
   * key at all?) — `hasKeyPair` answers neither, only whether this tab has it in
   * memory, which reads as "no encryption key found" to someone who simply
   * reloaded. `getKeyringState` asks both, and this re-asks on every lock/unlock
   * transition so the panel follows an unlock done in the gate instead of going
   * stale the moment it mounted.
   */
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    let cancelled = false;

    async function refresh() {
      try {
        const { state } = await getKeyringState(userId);
        if (cancelled) return;
        setKeyStatus(state);
      } catch {
        // Offline or the server is down — the local session is still the truth
        // about what this tab can decrypt right now.
        if (!cancelled) setKeyStatus(hasKeyPair(userId) ? 'unlocked' : 'loading');
      }
    }

    void refresh();
    const unsubscribe = subscribeToLockState(() => void refresh());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user]);

  /**
   * The fingerprint of this account's own public key.
   *
   * Someone sharing a file with you sees this same value derived from the key
   * the server handed them; if the two match, the server did not substitute a
   * key of its own. That comparison has to happen over a channel this app does
   * not control — a phone call, or in person — so the only job here is to put
   * the string somewhere it can be read aloud.
   *
   * Derived from the session keypair rather than fetched, so a server that lies
   * about your key cannot make its lie agree with itself.
   */
  useEffect(() => {
    if (!user || keyStatus !== 'unlocked') {
      setKeyFingerprint('');
      return;
    }
    const userId = user.id;
    let cancelled = false;

    void (async () => {
      await initSodium();
      if (cancelled) return;
      const kp = loadKeyPair(userId);
      if (!kp) return;
      setKeyFingerprint(fingerprintFor(userId, toBase64url(kp.publicKey)));
    })();

    return () => {
      cancelled = true;
    };
  }, [user, keyStatus]);

  useEffect(() => {
    const stored = localStorage.getItem(WEEK_START_KEY);
    if (stored !== null) setWeekStart(Number(stored));

    const storedStart = localStorage.getItem(DAY_START_HOUR_KEY);
    if (storedStart !== null) setDayStartHourState(Number(storedStart));

    const storedEnd = localStorage.getItem(DAY_END_HOUR_KEY);
    if (storedEnd !== null) setDayEndHourState(Number(storedEnd));

    setSearchSyncDisabled(localStorage.getItem(SEARCH_SYNC_DISABLED_KEY) === 'true');
  }, []);

  async function handleExportKey() {
    if (!user) return;
    await initSodium();
    const kp = loadKeyPair(user.id);
    if (!kp) return;
    const exported = JSON.stringify({
      public_key: toBase64(kp.publicKey),
      private_key: toBase64(kp.secretKey),
      key_version: '1',
    });
    setExportedKeyJson(exported);
    setShowExportKey(true);
  }

  async function handleCopyExportedKey() {
    try {
      await navigator.clipboard.writeText(exportedKeyJson);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    } catch {
      // ignore — clipboard access denied
    }
  }

  async function handleImportKey() {
    if (!user) return;
    setImportKeyError('');
    try {
      await initSodium();

      let parsed: { public_key?: string; private_key?: string; key_version?: string };
      try {
        parsed = JSON.parse(importKeyValue.trim());
      } catch {
        throw new Error('Invalid JSON — paste the full exported key');
      }
      if (typeof parsed.public_key !== 'string' || typeof parsed.private_key !== 'string') {
        throw new Error('Invalid format — the file needs both public_key and private_key');
      }

      // Decoding is its own step with its own message. Rolling it in with the
      // JSON parse is what made a good key file report "invalid JSON".
      let publicKey: Uint8Array;
      let secretKey: Uint8Array;
      try {
        publicKey = fromBase64(parsed.public_key);
        secretKey = fromBase64(parsed.private_key);
      } catch {
        throw new Error('Key is not readable base64 — it may have been truncated or edited');
      }
      if (publicKey.length !== 32 || secretKey.length !== 32) {
        throw new Error('Key has wrong length — make sure you pasted the complete key');
      }
      if (!keyPairMatches(publicKey, secretKey)) {
        throw new Error('Key halves do not match — these came from two different keys');
      }
      // Adopts the imported keypair as a version-1 keyring and wraps it to this
      // device, so it survives a reload. Storing it in memory alone (as this
      // once did) lost it on the next refresh.
      await adoptKeyPair(user.id, user.email, publicKey, secretKey, {
        method: 'passphrase',
        passphrase: window.prompt('Choose a passphrase to protect this key on this device') ?? '',
      });
      setKeyStatus('unlocked');
      setImportKeyValue('');
      setImportKeySaved(true);
      setTimeout(() => setImportKeySaved(false), 2500);
    } catch (err) {
      // Every rejection above is thrown with the sentence to show, so it is
      // shown. Matching on the message prefix (as this did) meant anything
      // unrecognised was relabelled "invalid JSON" — including a base64 error
      // about JSON that had parsed perfectly well, which is how a good key file
      // came to be reported as a bad one.
      setImportKeyError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not import that key — check the file and try again.',
      );
    }
  }

  function handleWeekStartChange(value: number) {
    setWeekStart(value);
    localStorage.setItem(WEEK_START_KEY, String(value));
  }

  function handleDayStartHourChange(value: number) {
    const clamped = Math.min(value, dayEndHour - 1);
    setDayStartHourState(clamped);
    localStorage.setItem(DAY_START_HOUR_KEY, String(clamped));
  }

  function handleDayEndHourChange(value: number) {
    const clamped = Math.max(value, dayStartHour + 1);
    setDayEndHourState(clamped);
    localStorage.setItem(DAY_END_HOUR_KEY, String(clamped));
  }

  const { data: connectionsData, isLoading: connectionsLoading } = useQuery({
    queryKey: ['calendar-connections'],
    queryFn: () => calendarApi.listConnections(),
    enabled: activeTab === 'calendar',
  });
  const connections = connectionsData?.connections ?? [];

  const connectGoogle = useMutation({
    mutationFn: () => calendarApi.connectGoogle(),
    onSuccess: ({ authUrl }) => { window.location.href = authUrl; },
  });

  const connectOutlook = useMutation({
    mutationFn: () => calendarApi.connectOutlook(),
    onSuccess: ({ authUrl }) => { window.location.href = authUrl; },
  });

  const connectApple = useMutation({
    mutationFn: (req: CreateAppleConnectionRequest) => calendarApi.connectApple(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-connections'] });
      setShowAppleModal(false);
    },
  });

  const disconnect = useMutation({
    mutationFn: (id: string) => calendarApi.disconnectConnection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar-connections'] }),
  });

  const syncCal = useMutation({
    mutationFn: (id: string) => calendarApi.triggerSync(id),
    onSuccess: ({ eventsSynced }) => {
      toastSuccess(`Synced ${eventsSynced} event${eventsSynced === 1 ? '' : 's'}`);
      qc.invalidateQueries({ queryKey: ['events'] });
    },
    onError: () => toastError('Sync failed. Please try again.'),
  });

  // ── Populate form when data arrives ───────────────────────────────────────
  useEffect(() => {
    if (!details && !user) return;
    setName(user?.name ?? '');
    if (details) {
      setEmailMarketing(details.emailPreferences?.marketing ?? false);
      setEmailGeneral(details.emailPreferences?.general ?? true);
      setEmailUpdates(details.emailPreferences?.updates ?? true);
      setEmailCritical(details.emailPreferences?.critical ?? true);
    }
  }, [details, user]);

  // ── Save mutation ──────────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: (req: UpdateProfileRequest) => authApi.updateProfileDetails(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile-details'] });
    },
  });

  function handleThemeSelect(themeId: string) {
    applyTheme(themeId as ThemeChoice);
    save.mutate({ theme: themeId });
  }

  function handleNotificationsSave() {
    save.mutate({
      emailPreferences: {
        marketing: emailMarketing,
        general: emailGeneral,
        updates: emailUpdates,
        critical: emailCritical,
      },
    });
  }

  function handleNameSave(e: React.FormEvent) {
    e.preventDefault();
    // NOTE: name is stored on the UserProfile record, not UserProfileDetails.
    // The updateProfileDetails endpoint accepts the common UpdateProfileRequest
    // fields; name updates would go through a separate endpoint when available.
    // For now we persist what we can.
    save.mutate({});
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  }

  /**
   * Deleting the account has to take the local copies with it. The server row
   * going away leaves this device holding the decrypted identity key, the
   * search index (which is plaintext content, in IndexedDB) and the cached
   * image bytes — all of it readable by whoever opens the browser next, and
   * none of it reachable once the account can no longer sign in to clear it.
   *
   * Local cleanup runs even if a step throws: `authApi.deleteAccount` has
   * already succeeded by then, so there is no account to keep the data for and
   * failing here would strand it. The redirect is `replace` so Back cannot
   * return to a settings page for an account that no longer exists.
   */
  const deleteAccount = useMutation({
    mutationFn: () => authApi.deleteAccount(),
    onSuccess: async () => {
      setShowDeleteDialog(false);
      clearSession();
      clearDriveImageCache();
      await clearSearchIndex().catch(() => {});
      // The React Query cache is deliberately left alone, as sign-out leaves
      // it: clearing it makes every mounted query on the shell refetch, and
      // with the tokens already gone each one 401s into the client's own
      // redirect-to-sign-in — racing the redirect below.
      toastSuccess('Your account has been deleted.');
      router.replace('/');
    },
    onError: () => {
      toastError('Could not delete your account. Please try again.');
    },
  });

  function handleDeleteAccount() {
    deleteAccount.mutate();
  }

  function handleSearchSyncToggle(disabled: boolean) {
    setSearchSyncDisabled(disabled);
    localStorage.setItem(SEARCH_SYNC_DISABLED_KEY, String(disabled));
  }

  async function handleRebuildIndex() {
    if (!user?.id) return;
    setRebuildingIndex(true);
    setRebuildProgress(null);

    try {
      const total = await rebuildSearchIndex(user.id, setRebuildProgress);
      if (total === 0) {
        toastSuccess('Search index rebuilt — nothing to index yet.');
      } else {
        toastSuccess(`Search index rebuilt — ${total} item${total === 1 ? '' : 's'} indexed.`);
      }

      // A rebuild is the user asserting this device's index is the good one, so
      // it overrides the stored snapshot rather than deferring to it. Without
      // the force the upload would lose to whatever version is on the server —
      // very possibly the broken index they just rebuilt to escape.
      //
      // This runs for an empty rebuild too: leaving the old snapshot up there
      // means the next pull imports it straight back over the index we just
      // emptied, so deleted documents keep turning up in search.
      try {
        await forceUploadSnapshot(user.id);
      } catch {
        // The local rebuild succeeded, which is what was asked for. Sharing
        // it can wait for the next background sync.
      }
    } catch {
      toastError('Failed to rebuild search index. Please try again.');
    } finally {
      setRebuildingIndex(false);
      setRebuildProgress(null);
    }
  }

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Loader2 size={24} className={styles.spinner} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.back()} type="button">
          <ArrowLeft size={16} />
          Back
        </button>
        <h1 className={styles.heading}>Settings</h1>

        {/* ── Tab bar ─────────────────────────────────────────────────── */}
        <div className={styles.tabBar}>
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              className={`${styles.tabBtn} ${activeTab === tab.id ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── AI Assistant tab ────────────────────────────────────────────── */}
      {activeTab === 'ai' && (
        <div className={styles.content}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>AI assistant</h2>

            <p className={styles.hint}>
              Used by every AI feature in Neutrino — generating diagrams, exploring a sheet,
              writing slides, reading text out of a photo. The key stays in this browser and is
              sent with each request; the server keeps no key of its own.
            </p>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Provider</label>
              <select
                className={styles.formInput}
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value as AiSettings['provider'])}
              >
                <option value="gemini">Google Gemini (free tier available)</option>
                <option value="claude">Anthropic Claude</option>
                <option value="openai">OpenAI (GPT-4o)</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>API key</label>
              <input
                className={styles.formInput}
                type="password"
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
                placeholder={aiProvider === 'gemini' ? 'Optional — Gemini has a free tier' : 'Required'}
                autoComplete="off"
              />
              {aiProvider === 'gemini' && (
                <p className={styles.hint}>
                  Leave blank to use Gemini&apos;s free tier with rate limits.
                </p>
              )}
            </div>

            <div className={styles.saveBar}>
              <button
                type="button"
                className={styles.saveBtn}
                onClick={handleAiSave}
              >
                {aiSaved ? <><Check size={15} /> Saved</> : 'Save AI settings'}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ── Appearance tab ──────────────────────────────────────────────── */}
      {activeTab === 'appearance' && (
        <div className={styles.content}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Appearance</h2>

            <div className={styles.formGroup}>
              <div className={styles.settingInfo}>
                <div className={styles.settingName}>Theme</div>
                <div className={styles.settingDesc}>Choose the color scheme for the interface — selecting a theme applies and saves it immediately</div>
              </div>
              <ThemeGrid onSelect={handleThemeSelect} />
            </div>

            {save.isError && (
              <span className={styles.saveError}>Failed to save. Please try again.</span>
            )}
          </section>
        </div>
      )}

      {/* ── Notifications tab ───────────────────────────────────────────── */}
      {activeTab === 'notifications' && (
        <div className={styles.content}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Email notifications</h2>
            <div className={styles.checkList}>
              {[
                {
                  id: 'critical',
                  label: 'Critical alerts',
                  desc: 'Security issues, account actions that require your attention',
                  checked: emailCritical,
                  onChange: setEmailCritical,
                },
                {
                  id: 'general',
                  label: 'General',
                  desc: 'Activity summaries, comments, and mentions',
                  checked: emailGeneral,
                  onChange: setEmailGeneral,
                },
                {
                  id: 'updates',
                  label: 'Product updates',
                  desc: 'New features, improvements, and release notes',
                  checked: emailUpdates,
                  onChange: setEmailUpdates,
                },
                {
                  id: 'marketing',
                  label: 'Marketing',
                  desc: 'Tips, promotions, and special offers',
                  checked: emailMarketing,
                  onChange: setEmailMarketing,
                },
              ].map(({ id, label, desc, checked, onChange }) => (
                <label key={id} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                  />
                  <div className={styles.checkInfo}>
                    <div className={styles.checkLabel}>{label}</div>
                    <div className={styles.checkDesc}>{desc}</div>
                  </div>
                </label>
              ))}
            </div>

            <div className={styles.saveBar}>
              {save.isError && (
                <span className={styles.saveError}>Failed to save. Please try again.</span>
              )}
              <button
                type="button"
                className={styles.saveBtn}
                onClick={handleNotificationsSave}
                disabled={save.isPending}
              >
                {save.isPending ? (
                  <><Loader2 size={15} className={styles.spinner} /> Saving…</>
                ) : (
                  'Save notifications'
                )}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ── Calendar tab ────────────────────────────────────────────────── */}
      {activeTab === 'calendar' && (
        <div className={styles.content}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>General</h2>
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <div className={styles.settingName}>Start of week</div>
                <div className={styles.settingDesc}>First day shown in month and week views</div>
              </div>
              <div className={styles.segmented}>
                {WEEK_START_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`${styles.segmentedBtn} ${weekStart === opt.value ? styles.segmentedBtnActive : ''}`}
                    onClick={() => handleWeekStartChange(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.settingRow}>
                  <div className={styles.settingInfo}>
                    <div className={styles.settingName}>Day starts at</div>
                    <div className={styles.settingDesc}>First visible hour in the week view</div>
                  </div>
                  <select
                    className={styles.formInput}
                    style={{ width: 140 }}
                    value={dayStartHour}
                    onChange={(e) => handleDayStartHourChange(Number(e.target.value))}
                  >
                    {DAY_START_OPTIONS.filter((o) => o.value < dayEndHour).map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div className={styles.settingRow}>
                  <div className={styles.settingInfo}>
                    <div className={styles.settingName}>Day ends at</div>
                    <div className={styles.settingDesc}>Last visible hour in the week view</div>
                  </div>
                  <select
                    className={styles.formInput}
                    style={{ width: 140 }}
                    value={dayEndHour}
                    onChange={(e) => handleDayEndHourChange(Number(e.target.value))}
                  >
                    {DAY_END_OPTIONS.filter((o) => o.value > dayStartHour).map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Connected Calendars</h2>
            <p className={styles.sectionDesc}>
              Connect external calendar providers to sync events automatically.
            </p>
            {connectionsLoading ? (
              <Spinner size="sm" />
            ) : (
              <div className={styles.connectionList}>
                {(['google', 'outlook', 'apple'] as ConnectionProvider[]).map((provider) => {
                  const conn = connections.find((c) => c.provider === provider);
                  return (
                    <ConnectionRow
                      key={provider}
                      provider={provider}
                      connection={conn}
                      onConnect={() => {
                        if (provider === 'google') connectGoogle.mutate();
                        else if (provider === 'outlook') connectOutlook.mutate();
                        else setShowAppleModal(true);
                      }}
                      onDisconnect={() => conn && disconnect.mutate(conn.id)}
                      onSync={() => conn && syncCal.mutate(conn.id)}
                      isSyncing={syncCal.isPending}
                      isDisconnecting={disconnect.isPending}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── Account tab ─────────────────────────────────────────────────── */}
      {activeTab === 'account' && (
        <div className={styles.content}>
          {/* ── Identity ─────────────────────────────────────────────── */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Account</h2>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Email</label>
              <input
                className={styles.formInput}
                type="email"
                value={user?.email ?? ''}
                readOnly
                disabled
              />
            </div>

            <form onSubmit={handleNameSave}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Display name</label>
                <input
                  className={styles.formInput}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </div>

              <div className={styles.saveBar}>
                {save.isError && (
                  <span className={styles.saveError}>Failed to save. Please try again.</span>
                )}
                <button
                  type="submit"
                  className={styles.saveBtn}
                  disabled={save.isPending}
                >
                  {save.isPending ? (
                    <><Loader2 size={15} className={styles.spinner} /> Saving…</>
                  ) : nameSaved ? (
                    <><Check size={15} /> Saved</>
                  ) : (
                    'Save account'
                  )}
                </button>
              </div>
            </form>
          </section>

          {/* ── Change password ─────────────────────────────────────── */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Change password</h2>
            {/* TODO: wire to POST /api/v1/auth/change-password once endpoint is available */}
            <div className={styles.comingSoon}>
              Password change is coming soon. Please contact support if you need to reset your password.
            </div>
          </section>

          {/* ── Encryption key ──────────────────────────────────────── */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Encryption key</h2>

            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <div className={styles.settingName}>End-to-end encryption</div>
                <div className={styles.settingDesc}>
                  {keyStatus === 'unlocked'
                    ? 'Your encryption key is set up and unlocked on this device'
                    : keyStatus === 'locked'
                      ? 'Your encryption key is set up but locked on this device — unlock it to read and edit encrypted files'
                      : keyStatus === 'needs-device'
                        ? 'Your account has an encryption key, but this device does not have a copy — restore it from your recovery kit or another device'
                        : keyStatus === 'none'
                          ? 'No encryption key yet — files uploaded here will not be end-to-end encrypted'
                          : 'Checking…'}
                </div>
              </div>
              {keyStatus === 'unlocked' && <ShieldCheck size={20} color="var(--color-success, #16a34a)" />}
              {keyStatus === 'locked' && <ShieldAlert size={20} color="var(--color-warning, #d97706)" />}
              {keyStatus === 'none' && <ShieldX size={20} color="var(--color-warning, #d97706)" />}
            </div>

            {keyFingerprint && (
              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingName}>Key fingerprint</div>
                  <div className={styles.settingDesc}>
                    Read this aloud to someone sharing a file with you, so they can confirm they
                    are encrypting it to your key and not to one substituted along the way.
                  </div>
                  <div className={styles.fingerprint}>{keyFingerprint}</div>
                </div>
              </div>
            )}

            {keyStatus === 'unlocked' && (
              <div className={styles.keyActions}>
                <button type="button" className={styles.outlineBtn} onClick={handleExportKey}>
                  Export key
                </button>
              </div>
            )}

            {/* All three hand off to `E2EEUnlockGate`, which owns every way a
                key gets made, opened or restored. Creating one here would mint a
                second identity and orphan every file sealed to the first. */}
            {keyStatus === 'locked' && (
              <div className={styles.keyActions}>
                <button type="button" className={styles.saveBtn} onClick={requestEncryptionGate}>
                  Unlock key
                </button>
              </div>
            )}

            {keyStatus === 'needs-device' && (
              <div className={styles.keyActions}>
                <button type="button" className={styles.saveBtn} onClick={requestEncryptionGate}>
                  Restore key on this device
                </button>
              </div>
            )}

            {keyStatus === 'none' && (
              <div className={styles.keyActions}>
                <button type="button" className={styles.saveBtn} onClick={requestEncryptionGate}>
                  Set up encryption
                </button>
              </div>
            )}

            {/* ── Managing the key ─────────────────────────────────── */}
            <h3 className={styles.sectionTitle}>Your key</h3>
            <p className={styles.hint}>
              Your key is created on this device and never sent to us — not even encrypted. That
              means we cannot reset it: your recovery kit is the only way back if you lose every
              device that holds it.
            </p>
            {user && (
              <KeyManagementPanel
                userId={user.id}
                unlocked={keyStatus === 'unlocked'}
                onForgotten={() => {
                  setKeyStatus('needs-device');
                  setKeyFingerprint('');
                }}
              />
            )}

            {showExportKey && (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Your encryption key — keep this secret</label>
                <div className={styles.keyExportRow}>
                  <textarea
                    className={styles.keyExportBox}
                    value={exportedKeyJson}
                    readOnly
                    rows={3}
                  />
                  <button type="button" className={styles.outlineBtn} onClick={handleCopyExportedKey}>
                    {keyCopied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                  </button>
                </div>
                <p className={styles.hint}>
                  Store this key somewhere safe. Anyone who has it can decrypt your encrypted files.
                </p>
              </div>
            )}

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Import key from another device</label>
              <textarea
                className={styles.keyExportBox}
                placeholder='Paste exported key JSON here…'
                value={importKeyValue}
                onChange={(e) => { setImportKeyValue(e.target.value); setImportKeyError(''); }}
                rows={3}
              />
              {importKeyError && <span className={styles.saveError}>{importKeyError}</span>}
            </div>

            <div className={styles.saveBar}>
              <button
                type="button"
                className={styles.saveBtn}
                onClick={handleImportKey}
                disabled={!importKeyValue.trim()}
              >
                {importKeySaved
                  ? <><Check size={14} /> Key imported</>
                  : <><Upload size={14} /> Import key</>}
              </button>
            </div>
          </section>

          {/* ── Danger zone ─────────────────────────────────────────── */}
          <section className={styles.section}>
            <div className={styles.dangerZone}>
              <h2 className={styles.dangerTitle}>Danger zone</h2>
              <p className={styles.dangerDesc}>
                Delete your account and all associated data. Your account stops working
                straight away and is permanently erased after 30 days.
              </p>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => setShowDeleteDialog(true)}
              >
                Delete account
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ── Advanced tab ────────────────────────────────────────────────── */}
      {activeTab === 'advanced' && (
        <div className={styles.content}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Search</h2>

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={searchSyncDisabled}
                onChange={(e) => handleSearchSyncToggle(e.target.checked)}
              />
              <div className={styles.checkInfo}>
                <div className={styles.checkLabel}>Disable search index syncing</div>
                <div className={styles.checkDesc}>
                  Stop syncing the encrypted search index to other devices. The local index
                  will still work on this device.
                </div>
              </div>
            </label>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Photos</h2>

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={autoFaceDetect}
                onChange={(e) => setAutoFaceDetect(e.target.checked)}
              />
              <div className={styles.checkInfo}>
                <div className={styles.checkLabel}>Detect faces in new photos</div>
                <div className={styles.checkDesc}>
                  Automatically scan each newly uploaded photo for faces in the background.
                </div>
              </div>
            </label>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Index maintenance</h2>
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <div className={styles.settingName}>Rebuild search index</div>
                <div className={styles.settingDesc}>
                  Wipes the local search index and schedules a full re-index. Use this if
                  search results seem stale or incomplete.
                </div>
              </div>
              <button
                type="button"
                className={styles.outlineBtn}
                onClick={handleRebuildIndex}
                disabled={rebuildingIndex}
              >
                {rebuildingIndex
                  ? rebuildProgress
                    ? <><Loader2 size={14} className={styles.spinner} /> {rebuildProgress.done}/{rebuildProgress.total}</>
                    : <><Loader2 size={14} className={styles.spinner} /> Starting…</>
                  : 'Rebuild index'}
              </button>
            </div>
          </section>

          {/* ── About ────────────────────────────────────────────────── */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>About</h2>
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <div className={styles.settingName}>Version</div>
                <div className={styles.settingDesc}>
                  The version of Neutrino this browser is running — quote it when reporting a bug.
                </div>
                {/* Only a released image carries a version; a build made
                    outside a container says so instead of inventing one. */}
                <div className={styles.fingerprint}>
                  {APP_VERSION ? `v${APP_VERSION}` : 'Development build'}
                </div>
              </div>
            </div>

            {/* Only when the build could name the commit it came from —
                see `lib/version.ts`. */}
            {BUILD_ID && (
              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingName}>Build</div>
                  <div className={styles.settingDesc}>
                    The commit this build was made from.
                  </div>
                  <div className={styles.fingerprint}>{BUILD_ID}</div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── Apple CalDAV connect modal ───────────────────────────────────── */}
      {showAppleModal && (
        <AppleConnectModal
          onClose={() => setShowAppleModal(false)}
          onConnect={(req) => connectApple.mutate(req)}
          isPending={connectApple.isPending}
        />
      )}

      {/* ── Delete account confirmation dialog ──────────────────────────── */}
      {showDeleteDialog && (
        <div className={styles.overlay} onClick={() => { if (!deleteAccount.isPending) setShowDeleteDialog(false); }}>
          <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="delete-account-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="delete-account-title" className={styles.dialogTitle}>Delete your account?</h2>
            {/* Says 30 days because that is what the server enforces —
                `PURGE_GRACE_DAYS` in `src/auth/service.rs` and its twin in
                `worker/src/purge.rs`. Change those and this has to follow. */}
            <p className={styles.dialogBody}>
              You will be signed out immediately and your account will stop working.
              After 30 days it is permanently erased, along with all your files and
              all associated data — that step cannot be undone. Until then, an
              administrator can restore it for you.
            </p>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.dialogCancelBtn}
                onClick={() => setShowDeleteDialog(false)}
                disabled={deleteAccount.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.dialogConfirmBtn}
                onClick={handleDeleteAccount}
                disabled={deleteAccount.isPending}
              >
                {deleteAccount.isPending
                  ? <><Loader2 size={14} className={styles.spinner} /> Deleting…</>
                  : 'Delete account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
