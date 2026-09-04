'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Camera, Check, Globe, Loader2 } from 'lucide-react';
import { authApi, useAuth, type UpdateProfileRequest } from '@/lib/api';
import { AvatarPickerDialog } from '@neutrino/ui';
import styles from './page.module.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOCIAL_PLATFORMS = [
  { key: 'twitter', label: 'Twitter / X', placeholder: 'https://x.com/username' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/username' },
  { key: 'github', label: 'GitHub', placeholder: 'https://github.com/username' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/username' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/username' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@channel' },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Who the user is — nothing about how the app behaves.
 *
 * The theme picker and the email-notification checkboxes used to live here too,
 * duplicating the Appearance and Notifications tabs of /settings field for
 * field, each with its own state and its own save button (issue #60). Settings
 * owns both now. The split is the rule for anything added here later: a
 * preference goes to Settings, a detail about the person stays.
 */
export default function ProfilePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, refresh: refreshUser } = useAuth();

  const { data: details, isLoading } = useQuery({
    queryKey: ['profile-details'],
    queryFn: () => authApi.getProfileDetails(),
    enabled: !!user,
  });

  // ── Form state ────────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [profileImage, setProfileImage] = useState('');
  const [website, setWebsite] = useState('');
  const [language, setLanguage] = useState('');
  const [timezone, setTimezone] = useState('');
  const [country, setCountry] = useState('');
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);

  // Populate the form once, on initial load. Re-running on every `details`
  // refetch would clobber in-progress user edits — e.g. the on-mount theme
  // sync invalidates ['profile-details'], and its refetch landing mid-edit
  // would reset a field the user just typed into (flaky save/reload tests).
  const populatedRef = useRef(false);
  useEffect(() => {
    if (populatedRef.current) return;
    if (!details && !user) return;
    setName(user?.name ?? '');
    if (details) {
      setBio(details.bio ?? '');
      setAvatar(details.avatar ?? null);
      setProfileImage(details.profileImage ?? '');
      setWebsite(details.website ?? '');
      setLanguage(details.language ?? '');
      setTimezone(details.timezone ?? '');
      setCountry(details.country ?? '');
      setSocialLinks(details.socialLinks ?? {});
      populatedRef.current = true;
    }
  }, [details, user]);

  // ── Save mutation ─────────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: (req: UpdateProfileRequest) => authApi.updateProfileDetails(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile-details'] });
      // The name lives on the user record, so it is not in what this endpoint
      // returns — re-read the session user or the topbar and every avatar keep
      // showing the old one until the next reload.
      void refreshUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate({
      // Blank is not a name; leaving it out keeps whatever is on the account.
      ...(name.trim() ? { name: name.trim() } : {}),
      bio: bio.trim() || null,
      avatar: avatar,
      profileImage: profileImage.trim() || null,
      website: website.trim() || null,
      language: language.trim() || null,
      timezone: timezone.trim() || null,
      country: country.trim() || null,
      socialLinks,
    });
  }

  function handleSocialChange(platform: string, value: string) {
    setSocialLinks((prev) => {
      const next = { ...prev };
      if (value.trim()) {
        next[platform] = value.trim();
      } else {
        delete next[platform];
      }
      return next;
    });
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
        <button className={styles.backBtn} onClick={() => router.back()}>
          <ArrowLeft size={16} />
          Back
        </button>
        <h1 className={styles.heading}>Profile</h1>
      </div>

      <form className={styles.content} onSubmit={handleSubmit}>
        {/* ── Hero: avatar + name ─────────────────────────────────────── */}
        <div className={styles.hero}>
          <div className={styles.avatarWrap}>
            <button
              type="button"
              className={styles.avatarBtn}
              onClick={() => setAvatarDialogOpen(true)}
              title="Edit avatar"
            >
              {avatar ? (
                <img src={avatar} alt={name} className={styles.avatarImg} />
              ) : (
                <span className={styles.avatarInitials}>
                  {name.split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'}
                </span>
              )}
              <span className={styles.avatarOverlay}>
                <Camera size={18} />
              </span>
            </button>
            {avatar && (
              <button
                type="button"
                className={styles.avatarRemove}
                onClick={() => setAvatar(null)}
              >
                Remove
              </button>
            )}
          </div>
          <div className={styles.heroInfo}>
            <div className={styles.heroName}>{name}</div>
            <div className={styles.heroEmail}>{user?.email}</div>
            {bio && <p className={styles.heroBio}>{bio}</p>}
            {website && (
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.heroWebsite}
              >
                <Globe size={13} />
                {website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>

        {/* ── About ───────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>About</h2>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Display name</label>
            <input
              className={styles.formInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Bio</label>
            <textarea
              className={styles.formTextarea}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell others a little about yourself"
              rows={3}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Website</label>
            <input
              className={styles.formInput}
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://yoursite.com"
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Full-size profile image URL</label>
            <input
              className={styles.formInput}
              type="url"
              value={profileImage}
              onChange={(e) => setProfileImage(e.target.value)}
              placeholder="https://example.com/photo.jpg"
            />
          </div>
        </section>

        {/* ── Locale ──────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Locale</h2>
          <div className={styles.threeCol}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Language</label>
              <input
                className={styles.formInput}
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="e.g. en, fr, es"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Timezone</label>
              <input
                className={styles.formInput}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="e.g. America/New_York"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Country</label>
              <input
                className={styles.formInput}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. US, GB, CA"
              />
            </div>
          </div>
        </section>

        {/* ── Social links ─────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Social links</h2>
          <div className={styles.twoCol}>
            {SOCIAL_PLATFORMS.map(({ key, label, placeholder }) => (
              <div key={key} className={styles.formGroup}>
                <label className={styles.formLabel}>{label}</label>
                <input
                  className={styles.formInput}
                  type="url"
                  value={socialLinks[key] ?? ''}
                  onChange={(e) => handleSocialChange(key, e.target.value)}
                  placeholder={placeholder}
                />
              </div>
            ))}
          </div>
        </section>

        {/* Themes and email notifications are not here: they are preferences,
            and they live in Settings → Appearance and Settings →
            Notifications. See the note on this component. */}
        <p className={styles.preferencesNote}>
          Looking for themes, email notifications or your encryption key?
          They are in <Link href="/settings">Settings</Link>.
        </p>

        {/* ── Save bar ─────────────────────────────────────────────────── */}
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
              <>
                <Loader2 size={15} className={styles.spinner} /> Saving…
              </>
            ) : saved ? (
              <>
                <Check size={15} /> Saved
              </>
            ) : (
              'Save changes'
            )}
          </button>
        </div>
      </form>

      {avatarDialogOpen && (
        <AvatarPickerDialog
          name={name}
          onApply={setAvatar}
          onClose={() => setAvatarDialogOpen(false)}
        />
      )}
    </div>
  );
}
