import type { Preview } from '@storybook/react';
import { withThemeByDataAttribute } from '@storybook/addon-themes';
import '../src/styles/index.css';

const preview: Preview = {
  parameters: {
    layout: 'centered',
  },
  decorators: [
    withThemeByDataAttribute({
      themes: {
        Light:       'light',
        Dark:        'dark',
        Glass:       'glass',
        Midnight:    'midnight',
        Beach:       'beach',
        Forest:      'forest',
        Sunbeams:    'sunbeams',
        'Light Glass': 'light-glass',
      },
      defaultTheme: 'Light',
      attributeName: 'data-theme',
    }),
  ],
};

export default preview;
