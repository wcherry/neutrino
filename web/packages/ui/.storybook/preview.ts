import type { Preview } from '@storybook/react';
import { withThemeByDataAttribute } from '@storybook/addon-themes';
import '../src/styles/index.css';

const preview: Preview = {
  parameters: {
    layout: 'centered',
  },
  // The look is the second axis beside the theme (agent_docs/ui-look-and-feel-roadmap.md §4). It
  // is set on <html>, as the app does, so dialogs and toasts that portal to <body> follow it.
  globalTypes: {
    look: {
      description: 'Look',
      toolbar: {
        title: 'Look',
        icon: 'paintbrush',
        items: [
          { value: 'classic', title: 'Classic (today)' },
          { value: 'lightflow', title: 'Light Flow' },
          { value: 'precision', title: 'Quiet Precision' },
          { value: 'blended', title: 'Blended Flow' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { look: 'classic' },
  decorators: [
    (Story, context) => {
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-look', String(context.globals.look ?? 'classic'));
        document.documentElement.setAttribute('data-app', 'drive');
      }
      return Story();
    },
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
