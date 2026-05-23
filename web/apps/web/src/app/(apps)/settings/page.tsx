'use client';

import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, ChevronRight, Copy, Link2, Link2Off, Loader2, RefreshCw, ShieldCheck, ShieldX, Upload } from 'lucide-react';
import { Button, Modal, ModalHeader, ModalBody, ModalFooter, Spinner, useToast } from '@neutrino/ui';
import { authApi, calendarApi, useAuth, type UpdateProfileRequest, type ConnectionProvider, type ConnectionResponse, type CreateAppleConnectionRequest } from '@/lib/api';
import { initSodium, generateKeyPair, loadKeyPair, saveKeyPair, hasKeyPair, toBase64url, fromBase64url } from '@neutrino/e2e-crypto';
import { useAiSettings, type AiSettings } from '@/hooks/useAiSettings';
import { useTheme, type ThemeChoice } from '@/providers/ThemeProvider';
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

const THEME_OPTIONS: { value: ThemeChoice; label: string; bg: string; accent: string }[] = [
  { value: 'light',       label: 'Light',       bg: '#ffffff',                                                           accent: '#2563eb' },
  { value: 'dark',        label: 'Dark',        bg: '#0f172a',                                                           accent: '#3b82f6' },
  { value: 'system',      label: 'System',      bg: 'linear-gradient(135deg, #ffffff 50%, #0f172a 50%)',                 accent: '#6b7280' },
  { value: 'light-glass', label: 'Light Glass', bg: 'linear-gradient(135deg, #dbeafe 0%, #ede9fe 55%, #fce7f3 100%)',   accent: '#6366f1' },
  { value: 'glass',       label: 'Glass',       bg: '#0e1621',                                                           accent: '#38bdf8' },
  { value: 'midnight',    label: 'Midnight',    bg: '#06060f',                                                           accent: '#818cf8' },
  { value: 'beach',       label: 'Beach',       bg: '#fdf8f0',                                                           accent: '#0ea5e9' },
  { value: 'forest',      label: 'Forest',      bg: '#1a2416',                                                           accent: '#4ade80' },
  { value: 'sunbeams',    label: 'Sunbeams',    bg: '#fdfaf0',                                                           accent: '#d97706' },
];

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

type Tab = 'ai' | 'appearance' | 'notifications' | 'account' | 'calendar';

const TABS: { id: Tab; label: string }[] = [
  { id: 'ai', label: 'AI Assistant' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'account', label: 'Account' },
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

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('tab') as Tab | null;
      if (param && TABS.some((t) => t.id === param)) return param;
    }
    return 'ai';
  });

  const { theme: activeTheme, setTheme: applyTheme } = useTheme();

  // ── AI settings ────────────────────────────────────────────────────────────
  const { settings: aiSettings, setSettings: setAiSettings } = useAiSettings();
  const [aiProvider, setAiProvider] = useState<AiSettings['provider']>(aiSettings.provider);
  const [aiApiKey, setAiApiKey] = useState(aiSettings.apiKey);
  const [aiSaved, setAiSaved] = useState(false);

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

  // ── Appearance state ───────────────────────────────────────────────────────
  const [theme, setTheme] = useState(activeTheme);
  const [themeSaved, setThemeSaved] = useState(false);

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
  const [keyStatus, setKeyStatus] = useState<'loading' | 'set' | 'unset'>('loading');
  const [showExportKey, setShowExportKey] = useState(false);
  const [exportedKeyJson, setExportedKeyJson] = useState('');
  const [keyCopied, setKeyCopied] = useState(false);
  const [importKeyValue, setImportKeyValue] = useState('');
  const [importKeyError, setImportKeyError] = useState('');
  const [importKeySaved, setImportKeySaved] = useState(false);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);

  // ── Calendar state ─────────────────────────────────────────────────────────
  const { success: toastSuccess, error: toastError } = useToast();
  const [weekStart, setWeekStart] = useState<number>(0);
  const [dayStartHour, setDayStartHourState] = useState<number>(DEFAULT_DAY_START_HOUR);
  const [dayEndHour, setDayEndHourState] = useState<number>(DEFAULT_DAY_END_HOUR);
  const [showAppleModal, setShowAppleModal] = useState(false);

  useEffect(() => {
    if (!user) return;
    setKeyStatus(hasKeyPair(user.id) ? 'set' : 'unset');
  }, [user]);

  useEffect(() => {
    const stored = localStorage.getItem(WEEK_START_KEY);
    if (stored !== null) setWeekStart(Number(stored));

    const storedStart = localStorage.getItem(DAY_START_HOUR_KEY);
    if (storedStart !== null) setDayStartHourState(Number(storedStart));

    const storedEnd = localStorage.getItem(DAY_END_HOUR_KEY);
    if (storedEnd !== null) setDayEndHourState(Number(storedEnd));
  }, []);

  async function handleExportKey() {
    if (!user) return;
    await initSodium();
    const kp = loadKeyPair(user.id);
    if (!kp) return;
    const exported = JSON.stringify({
      publicKey: toBase64url(kp.publicKey),
      secretKey: toBase64url(kp.secretKey),
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
      const parsed = JSON.parse(importKeyValue.trim()) as { publicKey?: string; secretKey?: string };
      if (typeof parsed.publicKey !== 'string' || typeof parsed.secretKey !== 'string') {
        throw new Error('Invalid format — paste the full exported key JSON');
      }
      const publicKey = fromBase64url(parsed.publicKey);
      const secretKey = fromBase64url(parsed.secretKey);
      if (publicKey.length !== 32 || secretKey.length !== 32) {
        throw new Error('Key has wrong length — make sure you pasted the complete key');
      }
      saveKeyPair(user.id, publicKey, secretKey);
      await authApi.setPublicKey({ publicKey: parsed.publicKey });
      setKeyStatus('set');
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
      saveKeyPair(user.id, publicKey, secretKey);
      await authApi.setPublicKey({ publicKey: toBase64url(publicKey) });
      setKeyStatus('set');
      setShowRegenerateDialog(false);
      setShowExportKey(false);
    } catch {
      toastError('Failed to generate key. Please try again.');
    } finally {
      setGeneratingKey(false);
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
      setTheme((details.theme ?? 'system') as ThemeChoice);
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

  function handleThemeSave() {
    applyTheme(theme);
    save.mutate({ theme });
    setThemeSaved(true);
    setTimeout(() => setThemeSaved(false), 2000);
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
          {TABS.map((tab) => (
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
                <div className={styles.settingDesc}>Choose the color scheme for the interface</div>
              </div>
              <div className={styles.themeGrid}>
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`${styles.themeCard} ${theme === opt.value ? styles.themeCardActive : ''}`}
                    onClick={() => { setTheme(opt.value); applyTheme(opt.value); }}
                    title={opt.label}
                  >
                    <span className={styles.themeSwatch} style={{ background: opt.bg }}>
                      <span className={styles.themeSwatchAccent} style={{ background: opt.accent }} />
                    </span>
                    <span className={styles.themeCardLabel}>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.saveBar}>
              {save.isError && (
                <span className={styles.saveError}>Failed to save. Please try again.</span>
              )}
              <button
                type="button"
                className={styles.saveBtn}
                onClick={handleThemeSave}
                disabled={save.isPending}
              >
                {save.isPending ? (
                  <><Loader2 size={15} className={styles.spinner} /> Saving…</>
                ) : themeSaved ? (
                  <><Check size={15} /> Saved</>
                ) : (
                  'Save appearance'
                )}
              </button>
            </div>
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
                  {keyStatus === 'set'
                    ? 'Your encryption key is set up on this device'
                    : keyStatus === 'unset'
                      ? 'No encryption key found — files uploaded here will not be end-to-end encrypted'
                      : 'Checking…'}
                </div>
              </div>
              {keyStatus === 'set' && <ShieldCheck size={20} color="var(--color-success, #16a34a)" />}
              {keyStatus === 'unset' && <ShieldX size={20} color="var(--color-warning, #d97706)" />}
            </div>

            {keyStatus === 'set' && (
              <div className={styles.keyActions}>
                <button type="button" className={styles.outlineBtn} onClick={handleExportKey}>
                  Export key
                </button>
                <button type="button" className={styles.outlineBtn} onClick={() => setShowRegenerateDialog(true)}>
                  Regenerate key
                </button>
              </div>
            )}

            {keyStatus === 'unset' && (
              <div className={styles.keyActions}>
                <button type="button" className={styles.saveBtn} onClick={handleGenerateKey} disabled={generatingKey}>
                  {generatingKey ? <><Loader2 size={14} className={styles.spinner} /> Generating…</> : 'Generate key'}
                </button>
              </div>
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

      {/* ── Apple CalDAV connect modal ───────────────────────────────────── */}
      {showAppleModal && (
        <AppleConnectModal
          onClose={() => setShowAppleModal(false)}
          onConnect={(req) => connectApple.mutate(req)}
          isPending={connectApple.isPending}
        />
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
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.dialogTitle}>Delete your account?</h2>
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
