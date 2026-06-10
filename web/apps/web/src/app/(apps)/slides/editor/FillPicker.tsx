'use client';

import { FillPicker } from '@neutrino/ui';
import type { Background, BackgroundTheme } from '@neutrino/ui';
import type { SlideBackground, Theme } from './slideEditorTypes';

export default function SlidesFillPicker({
  background,
  onChange,
  theme,
}: {
  background: SlideBackground;
  onChange: (bg: SlideBackground) => void;
  theme?: Theme;
}) {
  return (
    <FillPicker
      background={background as Background}
      onChange={onChange as (bg: Background) => void}
      theme={theme as BackgroundTheme | undefined}
      presetsKey="neutrino:slides:gradientPresets"
      triggerLabel="BG"
    />
  );
}
