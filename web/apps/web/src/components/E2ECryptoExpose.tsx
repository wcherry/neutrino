'use client';

import { useEffect } from 'react';
import type * as E2ECrypto from '@neutrino/e2e-crypto';

declare global {
  interface Window {
    __e2eCrypto: typeof E2ECrypto | undefined;
  }
}

/**
 * Exposes the already-bundled @neutrino/e2e-crypto module on window.__e2eCrypto
 * so Playwright tests can access it without a bare-specifier dynamic import,
 * which fails because webpack erases the module identifier at build time.
 */
export function E2ECryptoExpose() {
  useEffect(() => {
    import('@neutrino/e2e-crypto').then((m) => {
      window.__e2eCrypto = m;
    });
  }, []);
  return null;
}
