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
 *
 * **The list should stay hard to lengthen, and the bar is a difference in blast radius.** Team
 * Spaces was specified with three per-phase sub-flags beside `teamSpaces`; they are not here. Each
 * would have been defensible alone, which is exactly how the previous list reached nineteen
 * declared keys — and a feature whose phases are separately switchable is a feature whose
 * behaviour you work out by reading rows. One feature, one switch.
 *
 * `teamFileTransfers` is the second key and clears that bar: every other part of Team Spaces acts
 * on rows a team already owns, and the two transfer flows act on a member's own My Drive — moving
 * a personal file into a team for good, and lending one without moving it. Being able to close
 * that without taking Team Spaces down is worth a boolean. It is meaningless alone: the server
 * checks `teamSpaces` first, so the client should too, and `canTransferToTeams` below is how.
 */
export const FLAG_KEYS = ['teamSpaces', 'teamFileTransfers'] as const;

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

/**
 * Whether to offer moving or sharing a file into a team.
 *
 * Both flags, `teamSpaces` first, mirroring `TeamsService::require_transfers` on the server. One
 * function rather than `flags.teamSpaces && flags.teamFileTransfers` at each call site, because
 * the half that is easy to forget is the first one — and forgetting it puts "Move to a team space"
 * in a Drive context menu on a deployment that has no teams, where every option in the dialog it
 * opens would be a 404.
 */
export function canTransferToTeams(flags: FeatureFlags): boolean {
  return flags.teamSpaces && flags.teamFileTransfers;
}
