import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ColorPickerPopover } from '../components/inputs/ColorPickerPopover';
import { Toolbar, ToolbarGroup, ToolbarDivider } from '../components/display/Toolbar';

const meta: Meta<typeof ColorPickerPopover> = {
  title: 'Inputs/ColorPickerPopover',
  component: ColorPickerPopover,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled({ initial = '#4f46e5', disabled }: { initial?: string; disabled?: boolean }) {
  const [color, setColor] = useState(initial);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <ColorPickerPopover color={color} onChange={setColor} disabled={disabled} title="Pick color" />
      <code style={{ fontSize: 12 }}>{color}</code>
    </div>
  );
}

export const Default: Story = {
  render: () => <Controlled />,
};

export const Disabled: Story = {
  render: () => <Controlled disabled />,
};

function CustomTrigger() {
  const [fontColor, setFontColor] = useState('#202124');
  const [bgColor, setBgColor] = useState('#ffffff');

  return (
    <Toolbar>
      <ToolbarGroup>
        {/* Font color — "A" letter with color bar underneath */}
        <ColorPickerPopover color={fontColor} onChange={setFontColor} title="Font color">
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1 }}>
            <span style={{ fontWeight: 'bold', fontSize: 13 }}>A</span>
            <span style={{ display: 'block', width: 14, height: 3, borderRadius: 2, backgroundColor: fontColor }} />
          </span>
        </ColorPickerPopover>

        {/* Fill color — swatch square with color bar underneath */}
        <ColorPickerPopover color={bgColor} onChange={setBgColor} title="Fill color">
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1 }}>
            <span style={{ display: 'block', width: 14, height: 11, border: '1px solid rgba(0,0,0,0.15)', borderRadius: 2, backgroundColor: bgColor }} />
            <span style={{ display: 'block', width: 14, height: 3, borderRadius: 2, backgroundColor: bgColor }} />
          </span>
        </ColorPickerPopover>
      </ToolbarGroup>

      <ToolbarDivider />

      <div style={{ fontSize: 12, color: '#666', padding: '0 8px' }}>
        Font: <code>{fontColor}</code> &nbsp; Fill: <code>{bgColor}</code>
      </div>
    </Toolbar>
  );
}

export const InToolbar: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => <CustomTrigger />,
};

export const StartRed: Story = {
  render: () => <Controlled initial="#dc2626" />,
};
