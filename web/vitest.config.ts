import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'apps/*/src/**/*.test.{ts,tsx}',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve('./apps/web/src'),
      '@neutrino/utils': path.resolve('./packages/utils/src/index.ts'),
      '@neutrino/sheet-embed': path.resolve('./packages/sheet-embed/src/index.ts'),
      '@neutrino/api-admin': path.resolve('./packages/api-admin/src/index.ts'),
      '@neutrino/api-core': path.resolve('./packages/api-core/src/index.ts'),
      '@neutrino/api-drive': path.resolve('./packages/api-drive/src/index.ts'),
      '@neutrino/api-docs': path.resolve('./packages/api-docs/src/index.ts'),
      '@neutrino/api-sheets': path.resolve('./packages/api-sheets/src/index.ts'),
      '@neutrino/api-slides': path.resolve('./packages/api-slides/src/index.ts'),
      '@neutrino/api-photos': path.resolve('./packages/api-photos/src/index.ts'),
      '@neutrino/auth': path.resolve('./packages/auth/src/index.ts'),
      '@neutrino/hooks': path.resolve('./packages/hooks/src/index.ts'),
      '@neutrino/ui': path.resolve('./packages/ui/src/index.ts'),
      '@neutrino/layout': path.resolve('./packages/layout/src/index.ts'),
      '@neutrino/search': path.resolve('./packages/search/src/index.ts'),
      '@neutrino/e2e-crypto': path.resolve('./packages/e2e-crypto/src/index.ts'),
    },
  },
});
