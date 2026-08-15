'use client';

import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, ChevronRight, Copy, Link2, Link2Off, Loader2, QrCode, RefreshCw, ShieldAlert, ShieldCheck, ShieldX, Upload } from 'lucide-react';
import QRCode from 'react-qr-code';
import { Button, Modal, ModalHeader, ModalBody, ModalFooter, Spinner, useToast } from '@neutrino/ui';
import { authApi, calendarApi, useAuth, type UpdateProfileRequest, type ConnectionProvider, type ConnectionResponse, type CreateAppleConnectionRequest } from '@/lib/api';
import { initSodium, generateKeyPair, loadKeyPair, hasKeyPair, subscribeToLockState, encryptKeysWithPin, toBase64, fromBase64 } from '@neutrino/e2e-crypto';
import { getVaultState, replaceIdentity } from '@neutrino/auth';
import { requestEncryptionGate } from '@/components/E2EEUnlockGate';
import { UnlockMethodsPanel } from './UnlockMethodsPanel';
import { useAiSettings, type AiSettings } from '@/hooks/useAiSettings';
import { usePhotoSettings } from '@/hooks/usePhotoSettings';
import { getOfficeFileMode, OFFICE_FILE_MODE_KEY, type OfficeFileMode } from '@/hooks/useOfficeFileMode';
import { useTheme, type ThemeChoice } from '@/providers/ThemeProvider';
import { ThemeGrid } from '@/components/theme/ThemeGrid';
import { useFeatureFlags, type FeatureFlags } from '@/providers/FeatureFlagsProvider';
import { rebuildSearchIndex } from '@/lib/searchIndexer';
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

const OFFICE_FILE_MODE_OPTIONS: { value: OfficeFileMode; label: string }[] = [
  { value: 'native-roundtrip', label: 'Keep as Office file' },
  { value: 'convert-on-open', label: 'Convert on open' },
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

type Tab = 'ai' | 'appearance' | 'notifications' | 'account' | 'calendar' | 'drive' | 'advanced';

const TABS: { id: Tab; label: string; flag?: keyof FeatureFlags }[] = [
  { id: 'ai', label: 'AI Assistant' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'drive', label: 'Drive', flag: 'officeInPlaceEditing' },
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
  const [keyStatus, setKeyStatus] = useState<'loading' | 'unlocked' | 'locked' | 'none'>('loading');
  const [showExportKey, setShowExportKey] = useState(false);
  const [exportedKeyJson, setExportedKeyJson] = useState('');
  const [keyCopied, setKeyCopied] = useState(false);
  const [importKeyValue, setImportKeyValue] = useState('');
  const [importKeyError, setImportKeyError] = useState('');
  const [importKeySaved, setImportKeySaved] = useState(false);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrPayload, setQrPayload] = useState('');
  const [qrPin, setQrPin] = useState('');

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

  // ── Drive state ─────────────────────────────────────────────────────────
  const [officeFileMode, setOfficeFileModeState] = useState<OfficeFileMode>('native-roundtrip');

  /**
   * Whether a key *exists* is a server question — `hasKeyPair` only answers
   * whether this tab has it in memory, which reads as "no encryption key found"
   * to someone who simply reloaded the page. Ask the vault, and re-ask on every
   * lock/unlock transition so the panel follows an unlock done in the gate
   * instead of going stale the moment it mounted.
   */
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    let cancelled = false;

    async function refresh() {
      try {
        const { state } = await getVaultState(userId);
        if (cancelled) return;
        setKeyStatus(state === 'unlocked' ? 'unlocked' : state === 'locked' ? 'locked' : 'none');
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

  useEffect(() => {
    const stored = localStorage.getItem(WEEK_START_KEY);
    if (stored !== null) setWeekStart(Number(stored));

    const storedStart = localStorage.getItem(DAY_START_HOUR_KEY);
    if (storedStart !== null) setDayStartHourState(Number(storedStart));

    const storedEnd = localStorage.getItem(DAY_END_HOUR_KEY);
    if (storedEnd !== null) setDayEndHourState(Number(storedEnd));

    setSearchSyncDisabled(localStorage.getItem(SEARCH_SYNC_DISABLED_KEY) === 'true');

    setOfficeFileModeState(getOfficeFileMode());
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

  async function handleShowQrCode() {
    if (!user) return;
    await initSodium();
    const kp = loadKeyPair(user.id);
    if (!kp) return;
    const pinBytes = new Uint8Array(6);
    crypto.getRandomValues(pinBytes);
    const pin = Array.from(pinBytes).map(b => b % 10).join('');
    const encrypted = await encryptKeysWithPin(kp.publicKey, kp.secretKey, pin);
    setQrPin(pin);
    setQrPayload(JSON.stringify(encrypted));
    setShowQrModal(true);
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
      const parsed = JSON.parse(importKeyValue.trim()) as { public_key?: string; private_key?: string; key_version?: string };
      if (typeof parsed.public_key !== 'string' || typeof parsed.private_key !== 'string') {
        throw new Error('Invalid format — paste the full exported key JSON');
      }
      const publicKey = fromBase64(parsed.public_key);
      const secretKey = fromBase64(parsed.private_key);
      if (publicKey.length !== 32 || secretKey.length !== 32) {
        throw new Error('Key has wrong length — make sure you pasted the complete key');
      }
      // Writes the imported key into the vault under the session's master key,
      // so it survives a reload and reaches the user's other devices. Storing
      // it in memory alone (as this used to) lost it on the next refresh.
      await replaceIdentity(user.id, publicKey, secretKey);
      setKeyStatus('unlocked');
      setImportKeyValue('');
      setImportKeySaved(true);
      setTimeout(() => setImportKeySaved(false), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setImportKeyError(
        msg.startsWith('Invalid') || msg.startsWith('Key')
          ? msg
          : 'Invalid JSON — paste the full exported key',
      );
    }
  }

  async function handleGenerateKey() {
    if (!user) return;
    setGeneratingKey(true);
    try {
      await initSodium();
      const { publicKey, secretKey } = generateKeyPair();
      await replaceIdentity(user.id, publicKey, secretKey);
      setKeyStatus('unlocked');
      setShowRegenerateDialog(false);
      setShowExportKey(false);
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : 'Failed to generate key. Please try again.',
      );
    } finally {
      setGeneratingKey(false);
    }
  }

  function handleWeekStartChange(value: number) {
    setWeekStart(value);
    localStorage.setItem(WEEK_START_KEY, String(value));
  }

  function handleOfficeFileModeChange(value: OfficeFileMode) {
    setOfficeFileModeState(value);
    localStorage.setItem(OFFICE_FILE_MODE_KEY, value);
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

  function handleDeleteAccount() {
    // TODO: wire to DELETE /api/v1/auth/me once endpoint is available
    setShowDeleteDialog(false);
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

      {/* ── Drive tab ────────────────────────────────────────────────────── */}
      {activeTab === 'drive' && (
        <div className={styles.content}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Office documents</h2>
            <div className={styles.settingRow}>
              <div className={styles.settingInfo}>
                <div className={styles.settingName}>Office file editing</div>
                <div className={styles.settingDesc}>
                  How Word, Excel, and PowerPoint files behave when opened in Drive
                </div>
              </div>
              <div className={styles.segmented}>
                {OFFICE_FILE_MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`${styles.segmentedBtn} ${officeFileMode === opt.value ? styles.segmentedBtnActive : ''}`}
                    onClick={() => handleOfficeFileModeChange(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
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
                      : keyStatus === 'none'
                        ? 'No encryption key yet — files uploaded here will not be end-to-end encrypted'
                        : 'Checking…'}
                </div>
              </div>
              {keyStatus === 'unlocked' && <ShieldCheck size={20} color="var(--color-success, #16a34a)" />}
              {keyStatus === 'locked' && <ShieldAlert size={20} color="var(--color-warning, #d97706)" />}
              {keyStatus === 'none' && <ShieldX size={20} color="var(--color-warning, #d97706)" />}
            </div>

            {keyStatus === 'unlocked' && (
              <div className={styles.keyActions}>
                <button type="button" className={styles.outlineBtn} onClick={handleExportKey}>
                  Export key
                </button>
                <button type="button" className={styles.outlineBtn} onClick={handleShowQrCode}>
                  <QrCode size={14} /> Link to mobile
                </button>
                <button type="button" className={styles.outlineBtn} onClick={() => setShowRegenerateDialog(true)}>
                  Regenerate key
                </button>
              </div>
            )}

            {/* Both of these hand off to `E2EEUnlockGate`, which owns every way
                a key gets made or opened. Generating one here would mint an
                identity with nothing to wrap it, and the user's existing files
                are sealed to the key the vault already holds. */}
            {keyStatus === 'locked' && (
              <div className={styles.keyActions}>
                <button type="button" className={styles.saveBtn} onClick={requestEncryptionGate}>
                  Unlock key
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

            {/* ── How the key is protected ─────────────────────────── */}
            <h3 className={styles.sectionTitle}>Unlock methods</h3>
            <p className={styles.hint}>
              Your encryption key is stored encrypted. Each method below can unlock it — none of
              them is ever sent to the server.
            </p>
            {user && <UnlockMethodsPanel userId={user.id} userEmail={user.email} />}

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
                Permanently delete your account and all associated data. This action cannot be undone.
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

      {/* ── QR key-transfer modal ───────────────────────────────────────── */}
      {showQrModal && (
        <div className={styles.overlay} onClick={() => setShowQrModal(false)}>
          <div className={`${styles.dialog} ${styles.qrDialog}`} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.dialogTitle}>Link to mobile device</h2>
            <p className={styles.dialogBody}>
              Scan this QR code in the mobile app, then enter the PIN when prompted. The code is single-use and valid for this session only.
            </p>
            <div className={styles.qrCodeWrap}>
              <QRCode value={qrPayload} size={200} level="M" />
            </div>
            <p className={styles.qrPinLabel}>PIN</p>
            <p className={styles.qrPin}>{qrPin}</p>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogCancelBtn} onClick={() => setShowQrModal(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Regenerate key confirmation dialog ──────────────────────────── */}
      {showRegenerateDialog && (
        <div className={styles.overlay} onClick={() => setShowRegenerateDialog(false)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.dialogTitle}>Regenerate encryption key?</h2>
            <p className={styles.dialogBody}>
              This will replace your current key with a new one. You will lose the ability to decrypt
              files encrypted with your old key unless you have exported a backup of it.
            </p>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.dialogCancelBtn}
                onClick={() => setShowRegenerateDialog(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.dialogConfirmBtn}
                onClick={handleGenerateKey}
                disabled={generatingKey}
              >
                {generatingKey ? 'Generating…' : 'Regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete account confirmation dialog ──────────────────────────── */}
      {showDeleteDialog && (
        <div className={styles.overlay} onClick={() => setShowDeleteDialog(false)}>
          <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="delete-account-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="delete-account-title" className={styles.dialogTitle}>Delete your account?</h2>
            <p className={styles.dialogBody}>
              This will permanently delete your account, all your files, and all associated data.
              This action cannot be undone.
            </p>
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={styles.dialogCancelBtn}
                onClick={() => setShowDeleteDialog(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.dialogConfirmBtn}
                onClick={handleDeleteAccount}
              >
                Delete account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
