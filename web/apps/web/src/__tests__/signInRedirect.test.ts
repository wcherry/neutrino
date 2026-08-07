/**
 * Unit tests for the post-sign-in destination.
 *
 * Two things are at stake: a shared link that arrives signed-out has to survive the login round
 * trip, and `?next=` must never be usable to bounce a user off-site from a page carrying the
 * Neutrino domain.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SIGNED_IN_ROUTE,
  routeAfterSignIn,
  safeRedirect,
  signInHref,
} from '../lib/signInRedirect';

describe('signInHref', () => {
  it('carries the destination', () => {
    expect(signInHref('/open/note/f1')).toBe('/sign-in?next=%2Fopen%2Fnote%2Ff1');
  });

  it('keeps the query string of the destination', () => {
    expect(signInHref('/drive?preview=f1')).toBe('/sign-in?next=%2Fdrive%3Fpreview%3Df1');
  });

  it('drops a destination that is not on this site', () => {
    expect(signInHref('https://evil.example.com')).toBe('/sign-in');
  });
});

describe('safeRedirect', () => {
  it('accepts a site-relative path', () => {
    expect(safeRedirect('/open/doc/f1')).toBe('/open/doc/f1');
  });

  it('rejects an absolute URL', () => {
    expect(safeRedirect('https://evil.example.com/steal')).toBeNull();
  });

  /** Browsers read `//host` as protocol-relative — it leaves the site despite starting with `/`. */
  it('rejects a protocol-relative URL', () => {
    expect(safeRedirect('//evil.example.com')).toBeNull();
  });

  /** Some browsers normalise a backslash to a slash, making `/\evil.com` protocol-relative too. */
  it('rejects a backslash-escaped protocol-relative URL', () => {
    expect(safeRedirect('/\\evil.example.com')).toBeNull();
  });

  it('rejects a javascript: URL', () => {
    expect(safeRedirect('javascript:alert(1)')).toBeNull();
  });

  it('rejects empty and missing values', () => {
    expect(safeRedirect('')).toBeNull();
    expect(safeRedirect(null)).toBeNull();
    expect(safeRedirect(undefined)).toBeNull();
  });
});

describe('routeAfterSignIn', () => {
  it('returns to the requested page', () => {
    expect(routeAfterSignIn('/open/note/f1')).toBe('/open/note/f1');
  });

  it('falls back to Drive without a destination', () => {
    expect(routeAfterSignIn(null)).toBe(DEFAULT_SIGNED_IN_ROUTE);
  });

  it('falls back to Drive rather than following an off-site destination', () => {
    expect(routeAfterSignIn('https://evil.example.com')).toBe(DEFAULT_SIGNED_IN_ROUTE);
  });
});
