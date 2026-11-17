'use client';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Smartphone, Trash2 } from 'lucide-react';
import { AlertDialog, Button, Spinner } from '@neutrino/ui';
import { authApi, useAuth, type AppPassword, type CreatedAppPassword } from '@neutrino/auth';
import styles from './page.module.css';
import appStyles from './CalendarAppsSection.module.css';

const QUERY_KEY = ['app-passwords'];

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Settings → Calendar → Calendar & Reminders apps: Neutrino as a CalDAV account, so a Neutrino
 * calendar and task list can be the iPhone's defaults. That is what makes "Siri Found an Event →
 * Add" in Messages, and "Hey Siri, remind me…", land in Neutrino.
 *
 * Each device signs in with its own app password. It is shown once, when it is made, and can be
 * revoked here on its own; the account password never works for CalDAV.
 */
export function CalendarAppsSection() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedAppPassword | null>(null);
  const [revoking, setRevoking] = useState<AppPassword | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: passwords = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => authApi.listAppPasswords(),
  });

  const create = useMutation({
    mutationFn: (deviceName: string) => authApi.createAppPassword(deviceName),
    onSuccess: (made) => {
      setCreated(made);
      setName('');
      setError(null);
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e) => setError(e instanceof Error && e.message ? e.message : 'Could not make a password'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => authApi.revokeAppPassword(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (e) => setError(e instanceof Error && e.message ? e.message : 'Could not revoke the password'),
  });

  const server = typeof window === 'undefined' ? '' : window.location.host;

  return (
    <section className={styles.section} data-testid="calendar-apps-section">
      <h2 className={styles.sectionTitle}>Calendar &amp; Reminders apps</h2>
      <p className={styles.sectionDesc}>
        Add Neutrino to Apple Calendar and Reminders on your iPhone or Mac, or to any app that
        supports CalDAV. Then make a Neutrino calendar and list your defaults, and events you add
        from Messages, and reminders you give Siri, land here. Each device signs in with its own
        password, which you can revoke on its own.
      </p>

      {created ? (
        <div className={appStyles.created} data-testid="app-password-created">
          <div className={appStyles.createdTitle}>
            Password for “{created.appPassword.name}”. Copy it now: it won&apos;t be shown again.
          </div>
          <dl className={appStyles.details}>
            <Detail label="Server" value={server} />
            <Detail label="User name" value={user?.email ?? ''} />
            <Detail label="Password" value={created.password} mono />
          </dl>
          <ol className={appStyles.steps}>
            <li>On your iPhone, open Settings › Apps › Calendar › Calendar Accounts › Add Account › Other.</li>
            <li>Choose Add CalDAV Account, and enter the server, user name and password above.</li>
            <li>Turn on Calendars and Reminders for the account.</li>
            <li>
              In Settings › Apps › Calendar, set Default Calendar to a Neutrino calendar, and in
              Settings › Apps › Reminders, set Default List to a Neutrino list.
            </li>
          </ol>
          <div>
            <Button size="sm" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          className={appStyles.addRow}
          onSubmit={(e) => {
            e.preventDefault();
            const deviceName = name.trim();
            if (deviceName) create.mutate(deviceName);
          }}
        >
          <input
            className={styles.formInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Device name, like “iPhone”"
            aria-label="Device name"
            maxLength={100}
          />
          <Button type="submit" size="sm" disabled={!name.trim()} loading={create.isPending}>
            Add a device
          </Button>
        </form>
      )}

      {isLoading ? (
        <Spinner size="sm" />
      ) : passwords.length > 0 ? (
        <div className={styles.connectionList}>
          {passwords.map((p) => (
            <div key={p.id} className={styles.connectionRow} data-testid="app-password-row">
              <Smartphone size={16} aria-hidden />
              <div className={styles.connectionInfo}>
                <div className={styles.connectionName}>{p.name}</div>
                <div className={styles.connectionDesc}>
                  Added {day(p.createdAt)} · {p.lastUsedAt ? `last used ${day(p.lastUsedAt)}` : 'not used yet'}
                </div>
              </div>
              <div className={styles.connectionActions}>
                <button
                  className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                  onClick={() => setRevoking(p)}
                  aria-label={`Revoke ${p.name}`}
                  title="Revoke"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {error && (
        <p className={appStyles.error} role="alert">
          {error}
        </p>
      )}

      <AlertDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        variant="error"
        title={`Revoke the password for ${revoking?.name ?? 'this device'}?`}
        description="The device is signed out at once, and its Neutrino calendars and lists disappear from it. You can add it again with a new password."
        confirmLabel="Revoke"
        onConfirm={() => {
          const target = revoking;
          setRevoking(null);
          if (target) revoke.mutate(target.id);
        }}
      />
    </section>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={appStyles.detail}>
      <dt className={appStyles.detailLabel}>{label}</dt>
      <dd className={`${appStyles.detailValue} ${mono ? appStyles.mono : ''}`}>
        <span>{value}</span>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={`Copy ${label.toLowerCase()}`}
          title="Copy"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </dd>
    </div>
  );
}
