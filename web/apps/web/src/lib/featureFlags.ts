/**
 * The feature flag keys this client knows about.
 *
 * One list, and the `FeatureFlags` type is derived from it — so the type cannot declare a key that
 * is not here, which is half of what went wrong last time. The other half was a key here with no
 * row in the database: `docsPresence`, `docsTrackChanges`, `docsCompare` and `docsMobileEditor`
 * were all declared, none had a row, each read as `undefined`, and `undefined` is falsy. Four
 * features were off not because anyone had turned them off but because nothing knew they existed,
 * and two of them gated code that had consequently never run in production.
 *
 * That gap is now checked from both ends. The server refuses to serve a flag map missing a key it
 * declares (`src/drive/feature_flags/catalog.rs`), and `assertEveryFlagPresent` below refuses to
 * accept one missing a key *this* file declares. Adding a flag means a migration, an entry in the
 * server's catalog, and an entry here; the tests fail until all three agree.
 */
export const FLAG_KEYS = [
  'teamSpaces',
  'teamSpacesPages',
  'teamSpacesFiles',
  'teamSpacesActivity',
] as const;

export type FeatureFlagKey = (typeof FLAG_KEYS)[number];

/** Every declared flag, as booleans. There is no partial form of this type. */
export type FeatureFlags = Record<FeatureFlagKey, boolean>;

/** Every flag off — what the client holds before the fetch resolves, and after it fails. */
export function allFlagsOff(): FeatureFlags {
  return Object.fromEntries(FLAG_KEYS.map((k) => [k, false])) as FeatureFlags;
}

/**
 * Narrow a fetched payload to `FeatureFlags`, throwing if a declared key is absent.
 *
 * Throwing rather than defaulting the key to `false` is the whole point. `false` is a real,
 * legitimate value that an admin might have chosen, so a missing key that quietly becomes `false`
 * is indistinguishable from a flag someone deliberately turned off — which is exactly why the last
 * four went unnoticed for as long as they did. A key with no row is a deployment fault, and it
 * should look like one.
 */
export function assertEveryFlagPresent(payload: unknown): FeatureFlags {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Feature flags response was not an object');
  }
  const record = payload as Record<string, unknown>;
  const missing = FLAG_KEYS.filter((key) => typeof record[key] !== 'boolean');
  if (missing.length > 0) {
    throw new Error(
      `Feature flags response is missing: ${missing.join(', ')}. ` +
        'Every key in FLAG_KEYS needs a row in the feature_flags table — see ' +
        'src/drive/feature_flags/catalog.rs.'
    );
  }
  return Object.fromEntries(FLAG_KEYS.map((k) => [k, record[k] as boolean])) as FeatureFlags;
}
