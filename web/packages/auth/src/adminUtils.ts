// ---------------------------------------------------------------------------
// JWT admin helpers
//
// The neutrino-drive backend embeds `is_admin: true` in the JWT access token
// payload when the user is an admin. We decode that field client-side to gate
// the admin UI — the backend still enforces the AdminUser extractor on every
// /admin/api/* endpoint, so this is purely a UI convenience.
// ---------------------------------------------------------------------------

/**
 * Decode a JWT access token and return whether `is_admin` is true.
 * Returns false on any error (malformed token, invalid base64, missing field).
 */
export function decodeJwtAdmin(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    // base64url → standard base64 → UTF-8 JSON string
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    // Pad to a multiple of 4 characters
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const decoded = JSON.parse(atob(padded));
    return decoded.is_admin === true;
  } catch {
    return false;
  }
}

/**
 * Check whether the current browser session belongs to an admin.
 * Reads the access token from localStorage and decodes it.
 */
export function isCurrentUserAdmin(): boolean {
  if (typeof window === 'undefined') return false;
  const token = localStorage.getItem('access_token');
  if (!token || token === 'undefined' || token === 'null') return false;
  return decodeJwtAdmin(token);
}
