/**
 * The client half of the loud-failure design (issue #185).
 *
 * The failure being designed out: four keys the `FeatureFlags` type declared had no row in the
 * table, read as `undefined`, and rendered as features that were off — indistinguishable from
 * features someone had deliberately disabled. These assert that a missing key is now an error
 * rather than a silent `false`.
 */

import { describe, it, expect } from 'vitest';
import {
  FLAG_KEYS,
  allFlagsOff,
  assertEveryFlagPresent,
  canTransferToTeams,
} from '@/lib/featureFlags';

function completePayload(overrides: Record<string, unknown> = {}) {
  return { ...Object.fromEntries(FLAG_KEYS.map((k) => [k, false])), ...overrides };
}

describe('featureFlags', () => {
  it('starts with every declared key off', () => {
    const flags = allFlagsOff();
    expect(Object.keys(flags).sort()).toEqual([...FLAG_KEYS].sort());
    expect(Object.values(flags).every((v) => v === false)).toBe(true);
  });

  it('accepts a payload carrying every declared key', () => {
    const flags = assertEveryFlagPresent(completePayload({ teamSpaces: true }));
    expect(flags.teamSpaces).toBe(true);
  });

  it('throws, naming the key, when one is missing', () => {
    expect(() => assertEveryFlagPresent({})).toThrowError(/teamSpaces/);
  });

  /**
   * The exact list, pinned. The system this replaces reached fifteen keys one defensible addition
   * at a time; this fails the moment another is declared, which is when someone should be deciding
   * whether it earns its place rather than noticing later that it did not. Updating this line is
   * the moment to write down the argument — see the comment above `FLAG_KEYS`.
   */
  it('declares exactly the flags the server does', () => {
    expect([...FLAG_KEYS]).toEqual(['teamSpaces', 'teamFileTransfers']);
  });

  /**
   * `teamFileTransfers` is meaningless without `teamSpaces`, and the server checks them in that
   * order. Offering a transfer on the strength of the second alone would put "Move to a team
   * space" in the Drive menu on a deployment with no teams.
   */
  it('offers transfers only when both flags are on', () => {
    expect(canTransferToTeams({ teamSpaces: true, teamFileTransfers: true })).toBe(true);
    expect(canTransferToTeams({ teamSpaces: true, teamFileTransfers: false })).toBe(false);
    expect(canTransferToTeams({ teamSpaces: false, teamFileTransfers: true })).toBe(false);
    expect(canTransferToTeams(allFlagsOff())).toBe(false);
  });

  /**
   * The precise shape of the old bug: a key present but not a boolean is as unusable as a key that
   * is absent, and must not be coerced into `false`.
   */
  it('throws when a declared key is present but not a boolean', () => {
    expect(() => assertEveryFlagPresent(completePayload({ teamSpaces: null }))).toThrowError(
      /teamSpaces/
    );
    expect(() =>
      assertEveryFlagPresent(completePayload({ teamSpaces: 'true' }))
    ).toThrowError(/teamSpaces/);
  });

  it('rejects a payload that is not an object at all', () => {
    expect(() => assertEveryFlagPresent(null)).toThrowError();
    expect(() => assertEveryFlagPresent('teamSpaces=true')).toThrowError();
  });

  /**
   * A row for a key this client no longer declares is inert, not an error — otherwise removing a
   * flag from the code would have to land in the same deploy as the migration dropping its row.
   */
  it('ignores keys the client does not declare', () => {
    const flags = assertEveryFlagPresent(completePayload({ someRetiredFlag: true }));
    expect(Object.keys(flags).sort()).toEqual([...FLAG_KEYS].sort());
    expect('someRetiredFlag' in flags).toBe(false);
  });
});
