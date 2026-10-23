'use client';

/**
 * Admin › Organisation: what an administrator decides for everyone on the instance
 * (customization roadmap §6).
 *
 * - **Branding** (§6.1) — name, accent, sign-in message, logos and favicon. The server writes them
 *   into every page it serves, so they apply at first paint; saving here takes effect on the next
 *   page load.
 * - **Defaults and locks** (§6.2) — a default for any preference an organisation may set, and
 *   optionally a lock, which overrides each user's own choice and disables the control in their
 *   Settings with "Set by your organisation".
 * - **Apps** (§6.3) — which apps the instance offers. Hiding one takes it out of the sidebar, the
 *   New menu and the command palette; it does not 404 the routes (that is a feature flag's job).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Lock, Trash2 } from 'lucide-react';
import { Button, Spinner, useToast } from '@neutrino/ui';
import { organisationApi, type Branding, type BrandingAsset, type OrgLayer, type OrgPreferenceChange } from '@neutrino/api-admin';
import { ApiClientError } from '@neutrino/api-core';
import { APPS, REGISTRY, isValid, specFor, type AppKey, type PreferenceSpec } from '@neutrino/preferences';
import styles from './OrganisationTab.module.css';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiClientError && err.message ? err.message : fallback;
}

// ── Branding ─────────────────────────────────────────────────────────────────

/** WCAG 2 contrast against white — the same check the server makes, shown while typing. */
export function contrastOnWhite(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const lum = m.slice(1).map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  return 1.05 / (l + 0.05);
}

const ASSETS: { kind: BrandingAsset; label: string; hint: string; urlOf: (b: Branding) => string | null }[] = [
  { kind: 'logo-light', label: 'Logo', hint: 'For light backgrounds. PNG or WebP, up to 256 KB; shown 30 px tall.', urlOf: (b) => b.logoLightUrl },
  { kind: 'logo-dark', label: 'Logo for dark mode', hint: 'Optional — the light logo is used if this is not set.', urlOf: (b) => b.logoDarkUrl },
  { kind: 'favicon', label: 'Favicon', hint: 'The browser tab icon. ICO or PNG.', urlOf: (b) => b.faviconUrl },
];

function BrandingSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-branding'], queryFn: () => organisationApi.getBranding() });
  const [name, setName] = useState('');
  const [accent, setAccent] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!data) return;
    setName(data.name ?? '');
    setAccent(data.accent ?? '');
    setMessage(data.signInMessage ?? '');
  }, [data]);

  const save = useMutation({
    mutationFn: () => organisationApi.putBranding({ name: name || null, accent: accent || null, signInMessage: message || null }),
    onSuccess: (b) => {
      qc.setQueryData(['admin-branding'], b);
      toast.success('Saved. It shows on every page from the next load.');
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not save the branding')),
  });
  const upload = useMutation({
    mutationFn: ({ kind, file }: { kind: BrandingAsset; file: File }) => organisationApi.putAsset(kind, file),
    onSuccess: (b) => qc.setQueryData(['admin-branding'], b),
    onError: (e) => toast.error(errorMessage(e, 'Could not upload the image')),
  });
  const remove = useMutation({
    mutationFn: (kind: BrandingAsset) => organisationApi.deleteAsset(kind),
    onSuccess: (b) => qc.setQueryData(['admin-branding'], b),
    onError: (e) => toast.error(errorMessage(e, 'Could not remove the image')),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <p className={styles.error}>Could not load the branding.</p>;

  const ratio = accent ? contrastOnWhite(accent) : null;
  const accentProblem =
    accent && ratio === null ? 'Use a colour like #3346e8.'
    : ratio !== null && ratio < 4.5 ? `${ratio.toFixed(1)}:1 on white — text in it needs 4.5:1. Pick a darker shade.`
    : null;

  return (
    <section className={styles.section} aria-labelledby="org-branding">
      <h2 id="org-branding" className={styles.title}>Branding</h2>
      <p className={styles.desc}>
        Your instance&rsquo;s name and look, on every page — the sign-in page included. Leave a field
        empty to use Neutrino&rsquo;s own.
      </p>

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <input className={styles.input} value={name} maxLength={60} placeholder="Neutrino" onChange={(e) => setName(e.target.value)} />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Accent colour</span>
          <span className={styles.accentRow}>
            <input
              type="color"
              className={styles.swatch}
              value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : '#3346e8'}
              onChange={(e) => setAccent(e.target.value)}
              aria-label="Pick the accent colour"
            />
            <input className={styles.input} value={accent} placeholder="#3346e8" onChange={(e) => setAccent(e.target.value)} />
          </span>
          {accentProblem ? (
            <span className={styles.problem}>{accentProblem}</span>
          ) : (
            ratio !== null && <span className={styles.hint}>{ratio.toFixed(1)}:1 on white. Lightened automatically for dark mode.</span>
          )}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Sign-in page message</span>
          <textarea
            className={styles.input}
            rows={3}
            maxLength={280}
            value={message}
            placeholder="For example: Use your company email. Help: it@example.com"
            onChange={(e) => setMessage(e.target.value)}
          />
          <span className={styles.hint}>Plain text, shown under the sign-in form.</span>
        </label>
      </div>

      <div className={styles.actions}>
        <Button variant="primary" size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!!accentProblem}>
          Save branding
        </Button>
      </div>

      <div className={styles.assets}>
        {ASSETS.map((a) => {
          const url = a.urlOf(data);
          return (
            <div key={a.kind} className={styles.asset}>
              <div className={styles.assetPreview} data-dark={a.kind === 'logo-dark' || undefined}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a static export has no image optimiser */}
                {url ? <img src={url} alt="" /> : <span className={styles.hint}>Not set</span>}
              </div>
              <div className={styles.assetText}>
                <span className={styles.label}>{a.label}</span>
                <span className={styles.hint}>{a.hint}</span>
                <span className={styles.assetButtons}>
                  <label className={styles.uploadBtn}>
                    <ImageUp size={14} aria-hidden="true" /> {url ? 'Replace' : 'Upload'}
                    <input
                      type="file"
                      accept="image/png,image/webp,image/x-icon,.ico"
                      className={styles.fileInput}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) upload.mutate({ kind: a.kind, file });
                      }}
                    />
                  </label>
                  {url && (
                    <button type="button" className={styles.linkBtn} onClick={() => remove.mutate(a.kind)}>
                      <Trash2 size={14} aria-hidden="true" /> Remove
                    </button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Defaults and locks ───────────────────────────────────────────────────────

const OPTION_LABELS: Record<string, Record<string, string>> = {
  'appearance.look': { classic: 'Classic', lightflow: 'Light Flow', precision: 'Quiet Precision', blended: 'Blended Flow' },
  'appearance.density': { compact: 'Compact', comfortable: 'Comfortable', spacious: 'Spacious' },
  'appearance.theme': {
    system: 'Match the device', light: 'Light', dark: 'Dark', glass: 'Glass', midnight: 'Midnight', beach: 'Beach',
    forest: 'Forest', sunbeams: 'Sunbeams', 'light-glass': 'Light glass',
  },
  'keyboard.preset': { neutrino: 'Neutrino', google: 'Google Workspace', microsoft: 'Microsoft 365' },
  'ai.provider': { gemini: 'Google Gemini', claude: 'Anthropic Claude', openai: 'OpenAI' },
  'calendar.weekStart': { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' },
};

/** The values an admin can pick for `spec`, as [stored value, label]. */
function choicesFor(spec: PreferenceSpec): [unknown, string][] {
  const labels = OPTION_LABELS[spec.key] ?? {};
  const t = spec.type;
  if (t.kind === 'enum') return t.options.map((o) => [o, labels[o] ?? o]);
  if (t.kind === 'boolean') return [[true, 'On'], [false, 'Off']];
  if (t.kind === 'integer') {
    return Array.from({ length: t.max - t.min + 1 }, (_, i) => [t.min + i, labels[t.min + i] ?? String(t.min + i)]);
  }
  // A theme: the built-in presets (an organisation's own custom theme is per user today).
  if (t.kind === 'string') return Object.entries(labels).map(([v, l]) => [v, l]);
  return [];
}

interface Row {
  key: string;
  on: boolean;
  value: unknown;
  locked: boolean;
}

/** The keys an organisation may give a default, apps aside (they have their own section). */
export const ORG_KEYS = REGISTRY.filter((s) => s.scopes.includes('org') && s.key !== 'apps.enabled' && choicesFor(s).length > 0);

function rowsFrom(layer: OrgLayer): Row[] {
  return ORG_KEYS.map((spec) => {
    const has = spec.key in layer.values && isValid(spec, layer.values[spec.key]);
    return { key: spec.key, on: has, value: has ? layer.values[spec.key] : spec.default, locked: layer.locked.includes(spec.key) };
  });
}

/** The PATCH that turns `before` into `after`: only rows that changed. */
export function orgChanges(before: Row[], after: Row[]): Record<string, OrgPreferenceChange> {
  const out: Record<string, OrgPreferenceChange> = {};
  for (const row of after) {
    const old = before.find((r) => r.key === row.key);
    const same = old && old.on === row.on && old.locked === row.locked && JSON.stringify(old.value) === JSON.stringify(row.value);
    if (same) continue;
    out[row.key] = row.on ? { value: row.value, locked: row.locked } : null;
  }
  return out;
}

function DefaultsSection({ layer }: { layer: OrgLayer }) {
  const qc = useQueryClient();
  const toast = useToast();
  const initial = useMemo(() => rowsFrom(layer), [layer]);
  const [rows, setRows] = useState(initial);
  useEffect(() => setRows(initial), [initial]);
  const changes = orgChanges(initial, rows);
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () => organisationApi.patchPreferences(changes),
    onSuccess: (l) => {
      qc.setQueryData(['admin-org-preferences'], l);
      toast.success('Saved. Everyone signed in picks it up now.');
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not save the defaults')),
  });

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <section className={styles.section} aria-labelledby="org-defaults">
      <h2 id="org-defaults" className={styles.title}>Defaults and locks</h2>
      <p className={styles.desc}>
        A default is where everyone starts; they can still change it. A <strong>locked</strong> default
        is the value for everyone — their own choice no longer applies, and Settings shows the control
        disabled with &ldquo;Set by your organisation&rdquo;.
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Setting</th>
            <th scope="col">Default</th>
            <th scope="col">Lock</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const spec = specFor(row.key)!;
            const choices = choicesFor(spec);
            const index = choices.findIndex(([v]) => JSON.stringify(v) === JSON.stringify(row.value));
            return (
              <tr key={row.key}>
                <th scope="row" className={styles.settingName}>{spec.label}</th>
                <td>
                  <select
                    className={styles.select}
                    aria-label={`Default for ${spec.label}`}
                    value={row.on ? String(index) : ''}
                    onChange={(e) => {
                      if (e.target.value === '') update(row.key, { on: false, locked: false });
                      else update(row.key, { on: true, value: choices[Number(e.target.value)][0] });
                    }}
                  >
                    <option value="">No default (each person&rsquo;s own)</option>
                    {choices.map(([, label], i) => (
                      <option key={label} value={String(i)}>{label}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <label className={styles.lock}>
                    <input
                      type="checkbox"
                      checked={row.locked}
                      disabled={!row.on}
                      onChange={(e) => update(row.key, { locked: e.target.checked })}
                    />
                    <Lock size={13} aria-hidden="true" />
                    <span>Lock</span>
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={styles.actions}>
        <Button variant="secondary" size="sm" onClick={() => setRows(initial)} disabled={!dirty || save.isPending}>Discard</Button>
        <Button variant="primary" size="sm" onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>Save defaults</Button>
      </div>
    </section>
  );
}

// ── Apps ─────────────────────────────────────────────────────────────────────

const APP_LABELS: Record<AppKey, string> = {
  docs: 'Docs', sheets: 'Sheets', slides: 'Slides', notes: 'Notes', diagrams: 'Diagrams', drawing: 'Drawings',
  photos: 'Photos', calendar: 'Calendar',
};

function AppsSection({ layer }: { layer: OrgLayer }) {
  const qc = useQueryClient();
  const toast = useToast();
  const stored = layer.values['apps.enabled'];
  const initial = useMemo<AppKey[]>(
    () => (Array.isArray(stored) ? (stored.filter((a) => (APPS as readonly string[]).includes(a)) as AppKey[]) : [...APPS]),
    [stored],
  );
  const [enabled, setEnabled] = useState<AppKey[]>(initial);
  useEffect(() => setEnabled(initial), [initial]);
  const dirty = JSON.stringify([...enabled].sort()) !== JSON.stringify([...initial].sort());

  const save = useMutation({
    // Every app on is the product default: store nothing rather than a list that would go stale
    // the day a new app ships.
    mutationFn: () =>
      organisationApi.patchPreferences({
        'apps.enabled': enabled.length === APPS.length ? null : { value: APPS.filter((a) => enabled.includes(a)), locked: true },
      }),
    onSuccess: (l) => {
      qc.setQueryData(['admin-org-preferences'], l);
      toast.success('Saved.');
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not save the apps')),
  });

  return (
    <section className={styles.section} aria-labelledby="org-apps">
      <h2 id="org-apps" className={styles.title}>Apps</h2>
      <p className={styles.desc}>
        Which apps this instance offers. A hidden app leaves the sidebar, the New menu and the command
        palette for everyone. Its files stay where they are, and a link to one still opens.
      </p>
      <div className={styles.apps}>
        {APPS.map((app) => (
          <label key={app} className={styles.app}>
            <input
              type="checkbox"
              checked={enabled.includes(app)}
              onChange={(e) => setEnabled((cur) => (e.target.checked ? [...cur, app] : cur.filter((a) => a !== app)))}
            />
            <span className={styles.appDot} style={{ background: `var(--app-color-${app})` }} aria-hidden="true" />
            {APP_LABELS[app]}
          </label>
        ))}
      </div>
      <div className={styles.actions}>
        <Button variant="primary" size="sm" onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>Save apps</Button>
      </div>
    </section>
  );
}

export function OrganisationTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-org-preferences'],
    queryFn: () => organisationApi.getPreferences(),
  });
  return (
    <div className={styles.root}>
      <BrandingSection />
      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <p className={styles.error}>Could not load the organisation&rsquo;s defaults.</p>
      ) : (
        <>
          <DefaultsSection layer={data} />
          <AppsSection layer={data} />
        </>
      )}
    </div>
  );
}
