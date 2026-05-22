'use client';

import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Camera, Check, Globe, Loader2 } from 'lucide-react';
import { authApi, useAuth, type UpdateProfileRequest } from '@/lib/api';
import { useTheme, type ThemeChoice } from '@/providers/ThemeProvider';
import { AvatarPickerDialog } from '@neutrino/ui';
import styles from './page.module.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

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

export default function ProfilePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();

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
  const { theme, setTheme } = useTheme();
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>({});
  const [emailMarketing, setEmailMarketing] = useState(false);
  const [emailGeneral, setEmailGeneral] = useState(true);
  const [emailUpdates, setEmailUpdates] = useState(true);
  const [emailCritical, setEmailCritical] = useState(true);
  const [saved, setSaved] = useState(false);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);

  // Populate form when data arrives
  useEffect(() => {
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
      setEmailMarketing(details.emailPreferences?.marketing ?? false);
      setEmailGeneral(details.emailPreferences?.general ?? true);
      setEmailUpdates(details.emailPreferences?.updates ?? true);
      setEmailCritical(details.emailPreferences?.critical ?? true);
    }
  }, [details, user]);

  // ── Save mutation ─────────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: (req: UpdateProfileRequest) => authApi.updateProfileDetails(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile-details'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  // Silently sync theme preference to server whenever it changes.
  // Skip until profile details have loaded to avoid a premature write on mount.
  const isDetailsLoaded = !!details;
  useEffect(() => {
    if (!isDetailsLoaded) return;
    save.mutate({ theme });
    // save.mutate is stable; we intentionally omit it from deps to avoid loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, isDetailsLoaded]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate({
      bio: bio.trim() || null,
      avatar: avatar,
      profileImage: profileImage.trim() || null,
      website: website.trim() || null,
      language: language.trim() || null,
      timezone: timezone.trim() || null,
      country: country.trim() || null,
      socialLinks,
      emailPreferences: {
        marketing: emailMarketing,
        general: emailGeneral,
        updates: emailUpdates,
        critical: emailCritical,
      },
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

        {/* ── Appearance ──────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Appearance</h2>
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <div className={styles.settingName}>Theme</div>
              <div className={styles.settingDesc}>Choose the color scheme for the interface</div>
            </div>
            <div className={styles.segmented}>
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`${styles.segmentedBtn} ${theme === opt.value ? styles.segmentedBtnActive : ''}`}
                  onClick={() => setTheme(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── Email preferences ────────────────────────────────────────── */}
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
        </section>

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
