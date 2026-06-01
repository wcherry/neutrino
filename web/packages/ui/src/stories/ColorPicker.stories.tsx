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

function Controlled({ initial = '#4f46e5', showAlpha }: { initial?: string; showAlpha?: boolean }) {
  const [color, setColor] = useState(initial);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <ColorPicker value={color} onChange={setColor} showAlpha={showAlpha} />
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
  args: { showAlpha: false },
  render: ({ showAlpha }) => <Controlled showAlpha={showAlpha} />,
};

export const WithAlpha: Story = {
  args: { showAlpha: true },
  render: ({ showAlpha }) => <Controlled showAlpha={showAlpha} initial="#4f46e5cc" />,
};

export const StartRed: Story = {
  args: { showAlpha: false },
  render: ({ showAlpha }) => <Controlled initial="#dc2626" showAlpha={showAlpha} />,
};

export const StartBlack: Story = {
  args: { showAlpha: false },
  render: ({ showAlpha }) => <Controlled initial="#000000" showAlpha={showAlpha} />,
};

export const StartWhite: Story = {
  args: { showAlpha: false },
  render: ({ showAlpha }) => <Controlled initial="#ffffff" showAlpha={showAlpha} />,
};
