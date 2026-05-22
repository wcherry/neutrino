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
    '@neutrino/api-notes',
    '@neutrino/api-sheets',
    '@neutrino/api-slides',
    '@neutrino/api-photos',
    '@neutrino/hooks',
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
