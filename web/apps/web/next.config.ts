import type { NextConfig } from 'next';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const isDev = process.env.NODE_ENV === 'development';
const configDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The ceiling on a request body passing through the dev `/api/*` proxy below.
 *
 * `next dev` clones the body of an externally-rewritten request through a
 * stream capped at `experimental.middlewareClientMaxBodySize`, which defaults
 * to 10 MB — and past that it *truncates* the clone rather than rejecting the
 * request. The Rust server then reaches EOF before the closing multipart
 * boundary and fails the upload with "Upload interrupted", which is issue
 * #102: in dev, every Drive upload over 10 MB dies, and a Google Takeout
 * import (all photos and videos) dies almost immediately.
 *
 * This is not where the real upload limit lives. Production is
 * `output: 'export'` — static files served by the Rust binary, with no Node
 * process anywhere near an upload — so nothing here applies to a deployed
 * instance; `MAX_UPLOAD_BYTES` on the server is the limit that counts. This
 * only needs to stop being the bottleneck in dev.
 *
 * Deliberately not enormous: the clone pushes into `PassThrough` streams in
 * flowing mode without honouring backpressure, so a value far above anything
 * a developer would actually upload buys nothing but unbounded heap growth if
 * the server ever drains slower than the browser sends.
 */
const DEV_PROXY_MAX_BODY_BYTES = 2 * 1024 * 1024 * 1024;

const libsodiumWrappersCjs = path.resolve(
  configDir,
  '../../packages/e2e-crypto/node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js',
);

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(configDir, '../..'),
  output: isDev ? undefined : 'export',
  ...(isDev && {
    async rewrites() {
      return [
        {
          source: '/api/:path*',
          destination: 'http://localhost:8080/api/:path*',
        },
      ];
    },
  }),
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  transpilePackages: [
    '@neutrino/ui',
    '@neutrino/layout',
    '@neutrino/auth',
    '@neutrino/tokens',
    '@neutrino/api-core',
    '@neutrino/api-admin',
    '@neutrino/api-calendar',
    '@neutrino/api-drive',
    '@neutrino/api-docs',
    '@neutrino/api-links',
    '@neutrino/api-sheets',
    '@neutrino/api-slides',
    '@neutrino/api-photos',
    '@neutrino/api-diagrams',
    '@neutrino/api-drawing',
    '@neutrino/hooks',
    '@neutrino/offline',
    '@neutrino/utils',
    '@neutrino/e2e-crypto',
    '@neutrino/sheet-embed',
  ],
  webpack(config) {
    // libsodium-wrappers@0.7.16 has a broken ESM entry that imports
    // ./libsodium.mjs from the wrappers package instead of the libsodium package.
    // Point webpack at the CommonJS build until that upstream packaging issue is fixed.
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      'libsodium-wrappers$': libsodiumWrappersCjs,
    };

    // Keep .mjs files in node_modules loadable as regular JS modules.
    config.module.rules.push({
      test: /\.mjs$/,
      include: /node_modules/,
      type: 'javascript/auto',
    });
    return config;
  },
  serverExternalPackages: ['libsodium-wrappers'],
  experimental: {
    // Optimize CSS imports from workspace packages

    // Only meaningful alongside the dev rewrite above — see
    // DEV_PROXY_MAX_BODY_BYTES. Kept in this block rather than in the `isDev`
    // spread because a later literal key would override the spread wholesale.
    ...(isDev && { middlewareClientMaxBodySize: DEV_PROXY_MAX_BODY_BYTES }),
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    unoptimized: true,
  },
};

export default withBundleAnalyzer(nextConfig);
