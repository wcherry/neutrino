'use client';

/**
 * The workspace password rules, edited from the Users tab.
 *
 * Edited and saved as one thing, like the version-retention policy it is
 * modelled on: the rules are read together at every point a password is set, so
 * a form that saved each toggle on change would let an admin watch the policy
 * pass through combinations they never meant to have in force.
 */

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Spinner, Toggle, useToast } from '@neutrino/ui';
import { adminApi } from '@neutrino/api-admin';
import type { PasswordPolicy } from '@neutrino/api-admin';
import styles from './page.module.css';

/** The character-class rules, so the four rows are one list rather than four copies. */
const CLASS_RULES: {
  key: 'requireUppercase' | 'requireLowercase' | 'requireNumber' | 'requireSymbol';
  label: string;
  hint: string;
}[] = [
  { key: 'requireUppercase', label: 'An uppercase letter', hint: 'A–Z, and their equivalents in other scripts.' },
  { key: 'requireLowercase', label: 'A lowercase letter', hint: 'a–z, and their equivalents in other scripts.' },
  { key: 'requireNumber', label: 'A number', hint: 'Any digit.' },
  { key: 'requireSymbol', label: 'A symbol', hint: 'Anything that is not a letter, a digit or a space.' },
];

/**
 * The server's ceilings, mirrored so the inputs refuse what the API would.
 * Changing one means changing `src/auth/password_policy/mod.rs` with it.
 */
const MAX_LOCKOUT_THRESHOLD = 100;
const MAX_HISTORY_COUNT = 24;

/**
 * The forbidden list as the server will store it: a set of characters, with
 * whitespace dropped.
 *
 * Applied as the admin types so the chips below the field show what is actually
 * being saved. Whitespace goes because a space is legal in a passphrase and
 * banning it invisibly would be the least explicable rejection in the product;
 * duplicates go because the value is a set, however it was typed — the server
 * does exactly the same thing in `normalize_forbidden`.
 */
function normalizeForbidden(raw: string): string {
  const seen: string[] = [];
  for (const ch of Array.from(raw)) {
    if (ch.trim() !== '' && !seen.includes(ch)) seen.push(ch);
  }
  return seen.join('');
}

/** A number input's value, clamped rather than left as NaN on an empty field. */
function clampNumber(raw: string, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function PasswordPolicySection() {
  const qc = useQueryClient();
  const { error: toastError, success: toastSuccess } = useToast();
  const [draft, setDraft] = useState<PasswordPolicy | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-password-policy'],
    queryFn: () => adminApi.getPasswordPolicy(),
  });

  // The server's answer is the starting point for editing, and re-reading it
  // after a save is what discards a draft the server clamped or rejected.
  const policy = draft ?? data ?? null;

  const save = useMutation({
    mutationFn: (next: PasswordPolicy) =>
      adminApi.updatePasswordPolicy({
        minLength: next.minLength,
        requireUppercase: next.requireUppercase,
        requireLowercase: next.requireLowercase,
        requireNumber: next.requireNumber,
        requireSymbol: next.requireSymbol,
        maxAgeDays: next.maxAgeDays,
        forbiddenCharacters: next.forbiddenCharacters,
        lockoutThreshold: next.lockoutThreshold,
        historyCount: next.historyCount,
      }),
    onSuccess: (saved) => {
      setDraft(null);
      qc.setQueryData(['admin-password-policy'], saved);
      // The lockout threshold changes what the Users table above should be
      // saying about accounts partway through a run of failures.
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toastSuccess('Password rules saved.');
    },
    onError: () => {
      toastError('Failed to save the password rules. Please try again.');
    },
  });

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error || !policy) {
    return <div className={styles.error}>Failed to load the password rules.</div>;
  }

  const dirty =
    draft !== null &&
    data !== undefined &&
    (Object.keys(draft) as (keyof PasswordPolicy)[]).some((k) => draft[k] !== data[k]);

  const patch = (changes: Partial<PasswordPolicy>) => setDraft({ ...policy, ...changes });

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Password rules</h2>
      <p className={styles.settingIntro}>
        Checked every time someone sets a password — registering, changing their own, or having
        one set for them from the table above. A password already in use cannot be re-checked
        against a tightened rule, because a stored password is a hash and nothing can read it
        back; existing passwords stay usable until their owner changes one, or until the maximum
        age below expires it.
      </p>

      <div className={styles.serviceList}>
        <div className={styles.serviceRow}>
          <div className={styles.serviceInfo}>
            <span className={styles.serviceName}>Minimum length</span>
            <span className={styles.settingMeta}>
              Characters, not bytes — a passphrase in any script counts the same. Never below 8.
            </span>
          </div>
          <div className={styles.serviceControls}>
            <input
              type="number"
              min={8}
              max={128}
              className={styles.numberInput}
              value={policy.minLength}
              disabled={save.isPending}
              aria-label="Minimum password length"
              onChange={(e) => patch({ minLength: clampNumber(e.target.value, 8, 128) })}
            />
            <span className={styles.serviceLabel}>characters</span>
          </div>
        </div>

        {CLASS_RULES.map((rule) => (
          <div key={rule.key} className={styles.serviceRow}>
            <div className={styles.serviceInfo}>
              <span className={styles.serviceName}>Require {rule.label.toLowerCase()}</span>
              <span className={styles.settingMeta}>{rule.hint}</span>
            </div>
            <div className={styles.serviceControls}>
              <span className={styles.serviceLabel}>
                {policy[rule.key] ? 'Required' : 'Optional'}
              </span>
              <Toggle
                checked={policy[rule.key]}
                disabled={save.isPending}
                aria-label={`Require ${rule.label.toLowerCase()}`}
                onChange={() => patch({ [rule.key]: !policy[rule.key] } as Partial<PasswordPolicy>)}
              />
            </div>
          </div>
        ))}

        {/* The one rule typed as characters rather than as a number, so it gets
            the row to itself and shows back the set it resolved to. */}
        <div className={styles.settingRowStacked}>
          <div className={styles.serviceInfo}>
            <span className={styles.serviceName}>Forbidden characters</span>
            <span className={styles.settingMeta}>
              Type the characters a password may not contain, with or without separators —
              what is stored is the set of them. Spaces cannot be forbidden: they are legal in a
              passphrase, and banning one would be the hardest rejection to explain. Leave it
              empty to forbid nothing.
            </span>
          </div>
          <input
            type="text"
            className={styles.textInput}
            value={policy.forbiddenCharacters}
            disabled={save.isPending}
            spellCheck={false}
            autoComplete="off"
            placeholder="e.g. &lt; &gt; &amp; &quot;"
            aria-label="Forbidden characters"
            onChange={(e) => patch({ forbiddenCharacters: normalizeForbidden(e.target.value) })}
          />
          {policy.forbiddenCharacters.length > 0 ? (
            <div className={styles.charList} aria-label="Forbidden character list">
              {Array.from(policy.forbiddenCharacters).map((ch) => (
                <span key={ch} className={styles.charChip}>
                  {ch}
                </span>
              ))}
            </div>
          ) : (
            <span className={styles.serviceLabel}>No characters are forbidden.</span>
          )}
        </div>

        <div className={styles.serviceRow}>
          <div className={styles.serviceInfo}>
            <span className={styles.serviceName}>Expire passwords after</span>
            <span className={styles.settingMeta}>
              Zero means passwords never expire on age. Otherwise sign-in refuses a password
              older than this until a new one is set — an account whose password predates the
              records is left alone rather than locked out.
            </span>
          </div>
          <div className={styles.serviceControls}>
            <input
              type="number"
              min={0}
              max={36500}
              className={styles.numberInput}
              value={policy.maxAgeDays}
              disabled={save.isPending}
              aria-label="Days before a password expires"
              onChange={(e) => patch({ maxAgeDays: clampNumber(e.target.value, 0, 36500) })}
            />
            <span className={styles.serviceLabel}>days</span>
          </div>
        </div>

        <div className={styles.serviceRow}>
          <div className={styles.serviceInfo}>
            <span className={styles.serviceName}>Lock the account after</span>
            <span className={styles.settingMeta}>
              Consecutive sign-ins that get the password wrong. Zero never locks an account. A
              sign-in that succeeds clears the run, so unrelated typos do not add up; a locked
              account is released from the Unlock action in the table above.
            </span>
          </div>
          <div className={styles.serviceControls}>
            <input
              type="number"
              min={0}
              max={MAX_LOCKOUT_THRESHOLD}
              className={styles.numberInput}
              value={policy.lockoutThreshold}
              disabled={save.isPending}
              aria-label="Failed sign-ins before the account locks"
              onChange={(e) =>
                patch({ lockoutThreshold: clampNumber(e.target.value, 0, MAX_LOCKOUT_THRESHOLD) })
              }
            />
            <span className={styles.serviceLabel}>failed attempts</span>
          </div>
        </div>

        <div className={styles.serviceRow}>
          <div className={styles.serviceInfo}>
            <span className={styles.serviceName}>Refuse the last</span>
            <span className={styles.settingMeta}>
              Previous passwords that may not be set again, counting the one in use. Zero turns
              the check off. Only passwords set from now on can be remembered — what an account
              used before this rule existed was never recorded.
            </span>
          </div>
          <div className={styles.serviceControls}>
            <input
              type="number"
              min={0}
              max={MAX_HISTORY_COUNT}
              className={styles.numberInput}
              value={policy.historyCount}
              disabled={save.isPending}
              aria-label="Previous passwords that cannot be reused"
              onChange={(e) =>
                patch({ historyCount: clampNumber(e.target.value, 0, MAX_HISTORY_COUNT) })
              }
            />
            <span className={styles.serviceLabel}>passwords</span>
          </div>
        </div>
      </div>

      <div className={styles.formActions}>
        <span className={styles.pageInfo}>
          Last changed {new Date(policy.updatedAt).toLocaleString()}
        </span>
        {/* Named rather than a bare "Save": this section shares the Users tab
            with dialogs that have a Save of their own, and two identical
            buttons on one screen are two guesses for anyone reading the page
            through a screen reader. */}
        <button
          className={styles.pageBtn}
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(policy)}
        >
          {save.isPending ? 'Saving…' : 'Save rules'}
        </button>
      </div>
    </div>
  );
}
