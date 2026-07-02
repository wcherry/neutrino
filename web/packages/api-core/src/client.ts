/**
 * Core API client — base fetch wrapper, common types, and token management.
 *
 * All responses follow camelCase JSON (Serde rename_all = "camelCase").
 * Error envelope: { error: { code: string; message: string } }
 */

export const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ListQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// Internal HTTP helpers
// ---------------------------------------------------------------------------

export class ApiClientError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

const AUTH_LOGIN_PATH = '/api/v1/auth/login';
const AUTH_REGISTER_PATH = '/api/v1/auth/register';
const AUTH_REFRESH_PATH = '/api/v1/auth/refresh';
const LOGIN_REDIRECT_PATH = '/sign-in/';
const PUBLIC_PATHS = ['/sign-in', '/register', '/sign-in/', '/register/', '/share'];
let refreshInFlight: Promise<{ accessToken: string; refreshToken: string; tokenType: string; expiresIn: number } | null> | null = null;

export function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('access_token');
  if (!token || token === 'undefined' || token === 'null') return {};
  return { Authorization: `Bearer ${token}` };
}

export function shouldSkipRefresh(path: string): boolean {
  return (
    path.startsWith(AUTH_LOGIN_PATH) ||
    path.startsWith(AUTH_REGISTER_PATH) ||
    path.startsWith(AUTH_REFRESH_PATH)
  );
}

export function clearAuthAndRedirect(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  if (!PUBLIC_PATHS.includes(window.location.pathname)) {
    window.location.assign(LOGIN_REDIRECT_PATH);
  }
}

export async function refreshTokens(refreshToken?: string): Promise<{ accessToken: string; refreshToken: string; tokenType: string; expiresIn: number } | null> {
  if (typeof window === 'undefined') return null;
  const token = refreshToken ?? localStorage.getItem('refresh_token');
  if (!token || token === 'undefined' || token === 'null') return null;

  try {
    const res = await fetch(`${BASE_URL}${AUTH_REFRESH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: token }),
    });

    if (!res.ok) return null;
    const tokens = await res.json() as { accessToken: string; refreshToken: string; tokenType: string; expiresIn: number };
    localStorage.setItem('access_token', tokens.accessToken);
    localStorage.setItem('refresh_token', tokens.refreshToken);
    return tokens;
  } catch {
    return null;
  }
}

export async function refreshTokensOnce(): Promise<{ accessToken: string; refreshToken: string; tokenType: string; expiresIn: number } | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      return await refreshTokens();
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export type RequestConfig = {
  retry?: boolean;
  auth?: 'auto' | 'none';
  responseType?: 'json' | 'blob' | 'text' | 'none';
  onUploadProgress?: (percent: number) => void;
};

function requestWithXhr<T>(path: string, options: RequestInit, config: RequestConfig): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}${path}`;
    const includeAuth = config.auth !== 'none';
    const xhr = new XMLHttpRequest();

    if (config.responseType === 'blob') xhr.responseType = 'blob';

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && config.onUploadProgress) {
        config.onUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 401 && includeAuth && !shouldSkipRefresh(path)) {
        if (!config.retry) {
          refreshTokensOnce().then((refreshed) => {
            if (refreshed) {
              requestWithXhr<T>(path, options, { ...config, retry: true }).then(resolve, reject);
            } else {
              clearAuthAndRedirect();
              reject(new ApiClientError(401, 'UNAUTHENTICATED', 'Session expired'));
            }
          }).catch(reject);
          return;
        }
        clearAuthAndRedirect();
        reject(new ApiClientError(401, 'UNAUTHENTICATED', 'Session expired'));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        if (xhr.status === 204 || config.responseType === 'none') {
          resolve(undefined as unknown as T);
        } else if (config.responseType === 'blob') {
          resolve(xhr.response as T);
        } else if (config.responseType === 'text') {
          resolve(xhr.responseText as unknown as T);
        } else {
          try {
            resolve(JSON.parse(xhr.responseText) as T);
          } catch {
            reject(new Error('Invalid response from server'));
          }
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText) as ApiError;
          reject(new ApiClientError(xhr.status, err.error.code, err.error.message));
        } catch {
          reject(new ApiClientError(xhr.status, 'UNKNOWN_ERROR', `HTTP ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.addEventListener('abort', () => reject(new Error('Request aborted')));

    xhr.open(options.method ?? 'GET', url);

    if (includeAuth) {
      const authHeaders = getAuthHeader();
      Object.entries(authHeaders).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    }
    if (!(options.body instanceof FormData)) {
      xhr.setRequestHeader('Content-Type', 'application/json');
    }

    xhr.send(options.body as XMLHttpRequestBodyInit | null);
  });
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  config: RequestConfig = {}
): Promise<T> {
  if (config.onUploadProgress) {
    return requestWithXhr<T>(path, options, config);
  }

  const url = `${BASE_URL}${path}`;
  const includeAuth = config.auth !== 'none';
  const isFormData = options.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> | undefined),
    ...(includeAuth ? getAuthHeader() : {}),
  };

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && includeAuth && !shouldSkipRefresh(path)) {
    if (!config.retry) {
      const refreshed = await refreshTokensOnce();
      if (refreshed) {
        return request<T>(path, options, { ...config, retry: true });
      }
    }
    clearAuthAndRedirect();
    throw new ApiClientError(401, 'UNAUTHENTICATED', 'Session expired');
  }

  if (!res.ok) {
    let errorBody: ApiError | null = null;
    try {
      errorBody = (await res.json()) as ApiError;
    } catch {
      // response body is not JSON
    }
    throw new ApiClientError(
      res.status,
      errorBody?.error?.code ?? 'UNKNOWN_ERROR',
      errorBody?.error?.message ?? `HTTP ${res.status}`
    );
  }

  if (res.status === 204 || config.responseType === 'none') {
    return undefined as unknown as T;
  }

  if (config.responseType === 'blob') {
    return res.blob() as unknown as Promise<T>;
  }

  if (config.responseType === 'text') {
    return res.text() as unknown as Promise<T>;
  }

  return res.json() as Promise<T>;
}

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}
