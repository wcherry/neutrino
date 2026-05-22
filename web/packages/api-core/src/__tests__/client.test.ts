import { describe, it, expect, beforeEach } from 'vitest';
import { ApiClientError, buildQuery, shouldSkipRefresh, getAuthHeader } from '../client';

// ---------------------------------------------------------------------------
// ApiClientError
// ---------------------------------------------------------------------------

describe('ApiClientError', () => {
  it('is an instance of Error', () => {
    const err = new ApiClientError(404, 'NOT_FOUND', 'Resource not found');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiClientError);
  });

  it('sets name to ApiClientError', () => {
    const err = new ApiClientError(400, 'BAD_REQUEST', 'Bad request');
    expect(err.name).toBe('ApiClientError');
  });

  it('stores statusCode, code, and message', () => {
    const err = new ApiClientError(422, 'VALIDATION_ERROR', 'Invalid email');
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('Invalid email');
  });

  it('works with different status codes', () => {
    expect(new ApiClientError(401, 'UNAUTHENTICATED', 'Unauthorized').statusCode).toBe(401);
    expect(new ApiClientError(500, 'SERVER_ERROR', 'Internal error').statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// buildQuery
// ---------------------------------------------------------------------------

describe('buildQuery', () => {
  it('returns empty string for an empty params object', () => {
    expect(buildQuery({})).toBe('');
  });

  it('returns empty string when all values are undefined', () => {
    expect(buildQuery({ a: undefined, b: undefined })).toBe('');
  });

  it('returns empty string when all values are empty strings', () => {
    expect(buildQuery({ search: '' })).toBe('');
  });

  it('builds a query string from a single numeric param', () => {
    expect(buildQuery({ page: 1 })).toBe('?page=1');
  });

  it('builds a query string from multiple params', () => {
    const result = buildQuery({ page: 1, pageSize: 20 });
    expect(result).toBe('?page=1&pageSize=20');
  });

  it('converts boolean values to strings', () => {
    expect(buildQuery({ active: true })).toBe('?active=true');
    expect(buildQuery({ active: false })).toBe('?active=false');
  });

  it('omits undefined values but keeps defined ones', () => {
    expect(buildQuery({ page: 2, filter: undefined })).toBe('?page=2');
  });

  it('handles string values', () => {
    expect(buildQuery({ sort: 'name' })).toBe('?sort=name');
  });
});

// ---------------------------------------------------------------------------
// shouldSkipRefresh
// ---------------------------------------------------------------------------

describe('shouldSkipRefresh', () => {
  it('returns true for the login path', () => {
    expect(shouldSkipRefresh('/api/v1/auth/login')).toBe(true);
  });

  it('returns true for the register path', () => {
    expect(shouldSkipRefresh('/api/v1/auth/register')).toBe(true);
  });

  it('returns true for the refresh path', () => {
    expect(shouldSkipRefresh('/api/v1/auth/refresh')).toBe(true);
  });

  it('returns false for unrelated auth paths', () => {
    expect(shouldSkipRefresh('/api/v1/auth/me')).toBe(false);
    expect(shouldSkipRefresh('/api/v1/auth/logout')).toBe(false);
  });

  it('returns false for non-auth paths', () => {
    expect(shouldSkipRefresh('/api/v1/drive/files')).toBe(false);
    expect(shouldSkipRefresh('/api/v1/photos')).toBe(false);
    expect(shouldSkipRefresh('/')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAuthHeader
// ---------------------------------------------------------------------------

describe('getAuthHeader', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns an empty object when no token is stored', () => {
    expect(getAuthHeader()).toEqual({});
  });

  it('returns an Authorization Bearer header when a token is stored', () => {
    localStorage.setItem('access_token', 'my.jwt.token');
    expect(getAuthHeader()).toEqual({ Authorization: 'Bearer my.jwt.token' });
  });

  it('returns an empty object when the stored value is the literal string "null"', () => {
    localStorage.setItem('access_token', 'null');
    expect(getAuthHeader()).toEqual({});
  });

  it('returns an empty object when the stored value is the literal string "undefined"', () => {
    localStorage.setItem('access_token', 'undefined');
    expect(getAuthHeader()).toEqual({});
  });
});
