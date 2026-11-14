/**
 * The client half of the feature flag mechanism (issue #185).
 *
 * No feature is behind a flag while Neutrino is in beta, so `FLAG_KEYS` is empty and these pin the
 * mechanism's behaviour around that: an empty map is valid, retired keys the server still serves
 * are ignored, and a response that is not a flag map at all is still refused. The missing-key
 * check (`assertEveryFlagPresent` throwing on a declared key with no value) has nothing to check
 * until a flag is declared again after the public release.
 */

import { describe, it, expect } from 'vitest';
import { FLAG_KEYS, allFlagsOff, assertEveryFlagPresent } from '@/lib/featureFlags';

describe('featureFlags', () => {
  /**
   * Flags are for after a stable public release. Declaring one during the beta should be a
   * deliberate decision, and this is where it gets noticed.
   */
  it('declares no flags during the beta', () => {
    expect([...FLAG_KEYS]).toEqual([]);
  });

  it('starts with an empty map', () => {
    expect(allFlagsOff()).toEqual({});
  });

  it('accepts the empty map the server serves', () => {
    expect(assertEveryFlagPresent({})).toEqual({});
  });

  /**
   * A row for a key this client no longer declares is inert, not an error — otherwise removing a
   * flag from the code would have to land in the same deploy as the migration dropping its row.
   */
  it('ignores keys the client does not declare', () => {
    const flags = assertEveryFlagPresent({ someRetiredFlag: true });
    expect('someRetiredFlag' in flags).toBe(false);
  });

  it('rejects a payload that is not an object at all', () => {
    expect(() => assertEveryFlagPresent(null)).toThrowError();
    expect(() => assertEveryFlagPresent('teamSpaces=true')).toThrowError();
  });
});
