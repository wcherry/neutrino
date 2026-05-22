/**
 * Next.js route protection middleware stub.
 *
 * In a Next.js app using this package, create a `middleware.ts` at the project
 * root and use the helpers below to protect routes.
 *
 * Example:
 *   import { withAuth } from '@neutrino/auth/middleware';
 *   export default withAuth;
 *   export const config = { matcher: ['/drive/:path*', '/docs/:path*'] };
 */

// Note: Full Next.js middleware implementation requires access to cookies/JWT
// validation. Wire this up in apps/web/src/middleware.ts using the access_token
// cookie set by the auth flow.

export const AUTH_COOKIE_NAME = 'access_token';
export const SIGN_IN_PATH = '/sign-in';
export const PROTECTED_PATHS = ['/drive', '/docs', '/sheets', '/slides', '/photos'];
