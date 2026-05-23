/**
 * Feature flags — all flags read NEXT_PUBLIC_FEATURE_* environment variables.
 * All flags default to false (feature off) unless explicitly enabled.
 *
 * To enable a flag in development, set the env var in .env.local:
 *   NEXT_PUBLIC_FEATURE_SETTINGS=true
 */
const featureFlags = {
  /**
   * Settings page.
   * Env var: NEXT_PUBLIC_FEATURE_SETTINGS
   * Default: off
   */
  settingsPage: process.env.NEXT_PUBLIC_FEATURE_SETTINGS === 'true',

  /**
   * Video embeds in the slides editor.
   * Adds a "Video" toolbar button that allows inserting YouTube, Vimeo, Loom,
   * and direct MP4 video elements into slides.
   * Env var: NEXT_PUBLIC_FEATURE_SLIDES_VIDEO_EMBEDS
   * Default: off
   */
  slidesVideoEmbeds: process.env.NEXT_PUBLIC_FEATURE_SLIDES_VIDEO_EMBEDS === 'true',
} as const;

export default featureFlags;
export type FeatureFlags = typeof featureFlags;
