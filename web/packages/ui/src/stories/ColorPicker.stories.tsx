import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ColorPicker } from '../components/inputs/ColorPicker';

const meta: Meta<typeof ColorPicker> = {
  title: 'Inputs/ColorPicker',
  component: ColorPicker,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

function Controlled({ initial = '#4f46e5' }: { initial?: string }) {
  const [color, setColor] = useState(initial);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <ColorPicker value={color} onChange={setColor} />
      <div style={{
        width: 80,
        height: 32,
        borderRadius: 6,
        background: color,
        border: '1px solid rgba(0,0,0,0.1)',
      }} />
      <code style={{ fontSize: 12 }}>{color}</code>
    </div>
  );
}

export const Default: Story = {
  render: () => <Controlled />,
};

export const StartRed: Story = {
  render: () => <Controlled initial="#dc2626" />,
};

export const StartBlack: Story = {
  render: () => <Controlled initial="#000000" />,
};

export const StartWhite: Story = {
  render: () => <Controlled initial="#ffffff" />,
};
