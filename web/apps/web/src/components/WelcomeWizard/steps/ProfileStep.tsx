'use client';

/**
 * Step 3: the parts of the profile page that say who you are — avatar, display name, a line about
 * you (the profile's bio), language and region (its language and country). Nothing is written
 * until the user leaves the step, and only the fields they changed: a blank field would otherwise
 * clear what the profile already holds.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AvatarPickerDialog, Button } from '@neutrino/ui';
import { authApi, useAuth, type UpdateProfileRequest } from '@/lib/api';
import { useStep, useCommitOnLeave } from '../stepApi';
import styles from './Steps.module.css';

export function ProfileStep() {
  const { markDone } = useStep();
  const qc = useQueryClient();
  const { user, refresh } = useAuth();
  const { data: details } = useQuery({
    queryKey: ['profile-details'],
    queryFn: () => authApi.getProfileDetails(),
    enabled: !!user,
  });

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [language, setLanguage] = useState('');
  const [country, setCountry] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState('');
  // What was on the account when the form filled in, to tell what the user changed.
  const initial = useRef<{ name: string; bio: string; language: string; country: string; avatar: string | null } | null>(null);

  useEffect(() => {
    if (initial.current || !user) return;
    const seed = {
      name: user.name ?? '',
      bio: details?.bio ?? '',
      language: details?.language ?? '',
      country: details?.country ?? '',
      avatar: details?.avatar ?? null,
    };
    // Wait for the profile details: seeding from a half-loaded form would read "changed" later.
    if (!details) return;
    initial.current = seed;
    setName(seed.name);
    setBio(seed.bio);
    setLanguage(seed.language);
    setCountry(seed.country);
    setAvatar(seed.avatar);
  }, [user, details]);

  useCommitOnLeave(async () => {
    const base = initial.current;
    if (!base) return false;
    const req: UpdateProfileRequest = {};
    if (name.trim() && name.trim() !== base.name) req.name = name.trim();
    if (bio.trim() !== base.bio) req.bio = bio.trim() || null;
    if (language.trim() !== base.language) req.language = language.trim() || null;
    if (country.trim() !== base.country) req.country = country.trim() || null;
    if (avatar !== base.avatar) req.avatar = avatar;
    if (Object.keys(req).length === 0) return false;
    try {
      await authApi.updateProfileDetails(req);
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : 'Could not save your profile. Please try again.';
      setError(message);
      throw e;
    }
    setError('');
    // The name lives on the user record: re-read it or the account menu keeps the old one.
    void qc.invalidateQueries({ queryKey: ['profile-details'] });
    void refresh();
    initial.current = { name: name.trim() || base.name, bio: bio.trim(), language: language.trim(), country: country.trim(), avatar };
    markDone();
    return true;
  });

  const initials = name.split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className={styles.stack}>
      <div className={styles.avatarRow}>
        {avatar ? (
          <img src={avatar} alt="" className={styles.avatar} />
        ) : (
          <span className={styles.avatar} aria-hidden="true">{initials}</span>
        )}
        <div className={styles.row}>
          <Button type="button" variant="secondary" onClick={() => setPickerOpen(true)}>
            {avatar ? 'Change photo' : 'Upload a photo'}
          </Button>
          {avatar && (
            <Button type="button" variant="ghost" onClick={() => setAvatar(null)}>
              Remove
            </Button>
          )}
        </div>
      </div>

      <div className={styles.group}>
        <label className={styles.label} htmlFor="wizard-name">Display name</label>
        <input id="wizard-name" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
      </div>

      <div className={styles.group}>
        <label className={styles.label} htmlFor="wizard-bio">A line about you</label>
        <textarea
          id="wizard-bio"
          className={styles.textarea}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Tell others a little about yourself"
          rows={2}
        />
      </div>

      <div className={styles.twoCol}>
        <div className={styles.group}>
          <label className={styles.label} htmlFor="wizard-language">Language</label>
          <input id="wizard-language" className={styles.input} value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. en, fr, es" />
        </div>
        <div className={styles.group}>
          <label className={styles.label} htmlFor="wizard-country">Region</label>
          <input id="wizard-country" className={styles.input} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country, e.g. US, GB, CA" />
        </div>
      </div>

      {error && <p role="alert" className={styles.error}>{error}</p>}

      {pickerOpen && (
        <AvatarPickerDialog
          name={name}
          onApply={(dataUrl) => setAvatar(dataUrl)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
