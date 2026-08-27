/**
 * The running build's identity, for the UI to show and for bug reports to quote.
 *
 * Both values come from `web/version.txt` and are inlined at build time by
 * `next.config.ts` (`env`), because a production build is `output: 'export'`:
 * static files served by the Rust binary, with no Node process left to read
 * `process.env` at runtime.
 *
 * Only an image build has a version — that file is written by the Dockerfile —
 * so **every value here can be empty** and each one has a case that produces
 * it: a local `pnpm build` has a commit but no version, and a build from a
 * tarball with no git has neither. Callers show what is known and omit the
 * rest; nothing here invents a placeholder version, because "v0.0.0" in a bug
 * report is worse than no version at all.
 */

/** The released version, e.g. `0.1.42`. Empty outside an image build. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

/** The commit the bundle was built from (short SHA). Empty if unknown. */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || '';

/**
 * The short form for the sidebar footer: `v0.1.42` for a release, the bare
 * commit for a build that has one but no version, and `''` when the build
 * carries no identity at all — which the footer treats as "render nothing".
 */
export const VERSION_LABEL = APP_VERSION ? `v${APP_VERSION}` : BUILD_ID;

/** The long form for the footer's tooltip: `v0.1.42 (a1b2c3d)`. */
export const FULL_VERSION_LABEL = [
  APP_VERSION && `v${APP_VERSION}`,
  BUILD_ID && `(${BUILD_ID})`,
]
  .filter(Boolean)
  .join(' ');
