import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { decodeJwtAdmin, isCurrentUserAdmin } from '../adminUtils';

// ---------------------------------------------------------------------------
// Helpers — build JWT-shaped tokens for tests
// ---------------------------------------------------------------------------

function b64url(obj: object): string {
  const json = JSON.stringify(obj);
  // btoa works on ASCII; encode via TextEncoder for safety
  const binary = Array.from(new TextEncoder().encode(json))
    .map((b) => String.fromCharCode(b))
    .join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(payload: object): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(payload);
  return `${header}.${body}.fakesignature`;
}

// ---------------------------------------------------------------------------
// decodeJwtAdmin
// ---------------------------------------------------------------------------

describe('decodeJwtAdmin', () => {
  it('returns true when is_admin is true', () => {
    const token = makeToken({ sub: 'user-1', is_admin: true });
    expect(decodeJwtAdmin(token)).toBe(true);
  });

  it('returns false when is_admin is false', () => {
    const token = makeToken({ sub: 'user-1', is_admin: false });
    expect(decodeJwtAdmin(token)).toBe(false);
  });

  it('returns false when is_admin field is absent', () => {
    const token = makeToken({ sub: 'user-1', email: 'a@b.com' });
    expect(decodeJwtAdmin(token)).toBe(false);
  });

  it('returns false for a token with only 2 parts (no signature)', () => {
    expect(decodeJwtAdmin('header.payload')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(decodeJwtAdmin('')).toBe(false);
  });

  it('returns false when the payload section is not valid base64', () => {
    expect(decodeJwtAdmin('header.!!!not-base64!!!.sig')).toBe(false);
  });

  it('returns false when the payload is valid base64 but not JSON', () => {
    const notJson = btoa('this is not json');
    expect(decodeJwtAdmin(`header.${notJson}.sig`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isCurrentUserAdmin
// ---------------------------------------------------------------------------

describe('isCurrentUserAdmin', () => {
  const originalGetItem = Storage.prototype.getItem;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    Storage.prototype.getItem = originalGetItem;
    localStorage.clear();
  });

  it('returns true when localStorage has an admin token', () => {
    const token = makeToken({ sub: 'u1', is_admin: true });
    localStorage.setItem('access_token', token);
    expect(isCurrentUserAdmin()).toBe(true);
  });

  it('returns false when localStorage has a non-admin token', () => {
    const token = makeToken({ sub: 'u1', is_admin: false });
    localStorage.setItem('access_token', token);
    expect(isCurrentUserAdmin()).toBe(false);
  });

  it('returns false when no token is stored', () => {
    expect(isCurrentUserAdmin()).toBe(false);
  });

  it('returns false when token is the string "null"', () => {
    localStorage.setItem('access_token', 'null');
    expect(isCurrentUserAdmin()).toBe(false);
  });

  it('returns false when token is the string "undefined"', () => {
    localStorage.setItem('access_token', 'undefined');
    expect(isCurrentUserAdmin()).toBe(false);
  });
});
