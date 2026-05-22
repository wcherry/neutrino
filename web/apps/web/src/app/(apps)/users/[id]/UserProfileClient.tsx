'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Globe, Loader2 } from 'lucide-react';
import { authApi, useAuth } from '@/lib/api';
import styles from './page.module.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOCIAL_LABELS: Record<string, string> = {
  twitter: 'Twitter / X',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
};

// ---------------------------------------------------------------------------
// Avatar display (read-only)
// ---------------------------------------------------------------------------

function AvatarDisplay({ name, avatar }: { name: string; avatar: string | null }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className={styles.avatar}>
      {avatar ? (
        <img src={avatar} alt={name} className={styles.avatarImg} />
      ) : (
        <span className={styles.avatarInitials}>{initials}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field — readonly labelled value
// ---------------------------------------------------------------------------

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className={styles.field}>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={styles.fieldValue}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function UserProfileClient() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const { user: currentUser } = useAuth();

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ['public-profile', userId],
    queryFn: () => authApi.getPublicProfile(userId),
    enabled: !!userId && currentUser?.id !== userId,
  });

  // If viewing own profile, redirect to /profile
  if (currentUser && currentUser.id === userId) {
    router.replace('/profile');
    return null;
  }

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Loader2 size={24} className={styles.spinner} />
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => router.back()}>
            <ArrowLeft size={16} />
            Back
          </button>
        </div>
        <div className={styles.empty}>User not found.</div>
      </div>
    );
  }

  const socialEntries = Object.entries(profile.socialLinks ?? {}).filter(([, v]) => v);

  return (
    <div className={styles.page}>
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          <ArrowLeft size={16} />
          Back
        </button>
        <h1 className={styles.heading}>Profile</h1>
      </div>

      <div className={styles.content}>
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <div className={styles.hero}>
          <AvatarDisplay name={profile.name} avatar={profile.avatar} />
          <div className={styles.heroInfo}>
            <div className={styles.heroName}>{profile.name}</div>
            {profile.bio && <p className={styles.heroBio}>{profile.bio}</p>}
            {profile.website && (
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.heroWebsite}
              >
                <Globe size={13} />
                {profile.website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>

        {/* ── Details ───────────────────────────────────────────────────── */}
        {(profile.language || profile.country) && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Details</h2>
            <div className={styles.fieldGrid}>
              <Field label="Language" value={profile.language} />
              <Field label="Country" value={profile.country} />
            </div>
          </section>
        )}

        {/* ── Social links ──────────────────────────────────────────────── */}
        {socialEntries.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Social links</h2>
            <div className={styles.socialList}>
              {socialEntries.map(([platform, url]) => (
                <a
                  key={platform}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.socialLink}
                >
                  <span className={styles.socialPlatform}>
                    {SOCIAL_LABELS[platform] ?? platform}
                  </span>
                  <span className={styles.socialUrl}>{url.replace(/^https?:\/\//, '')}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* ── Full-size photo ───────────────────────────────────────────── */}
        {profile.profileImage && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Photo</h2>
            <img
              src={profile.profileImage}
              alt={profile.name}
              className={styles.profileImage}
            />
          </section>
        )}
      </div>
    </div>
  );
}
