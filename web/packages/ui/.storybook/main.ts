import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-themes',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  async viteFinal(config) {
    return mergeConfig(config, {
      resolve: {
        alias: {
          '@neutrino/tokens': path.resolve(__dirname, '../../tokens/src/index.css'),
          '@neutrino/ui': path.resolve(__dirname, '../src/index.ts'),
          '@neutrino/ui/styles': path.resolve(__dirname, '../src/styles/index.css'),
        },
      },
    });
  },
};

export default config;
