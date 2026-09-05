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
   * There is exactly one flag. The system this replaces reached fifteen keys one defensible
   * addition at a time; this fails the moment a second is declared, which is when someone should
   * be deciding whether it earns its place rather than noticing later that it did not.
   */
  it('declares one flag', () => {
    expect([...FLAG_KEYS]).toEqual(['teamSpaces']);
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
