import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FillPicker, type Background } from '../components/inputs/FillPicker';

const meta: Meta<typeof FillPicker> = {
  title: 'Inputs/FillPicker',
  component: FillPicker,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

function Preview({ bg }: { bg: Background }) {
  const style: React.CSSProperties =
    bg.type === 'image'
      ? { backgroundImage: `url(${bg.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : { background: bg.value };
  return (
    <div
      style={{
        width: 120,
        height: 80,
        borderRadius: 8,
        border: '1px solid rgba(0,0,0,0.12)',
        ...style,
      }}
    />
  );
}

function Controlled({ initial }: { initial: Background }) {
  const [bg, setBg] = useState<Background>(initial);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <FillPicker background={bg} onChange={setBg} />
      <Preview bg={bg} />
      <code style={{ fontSize: 11, maxWidth: 260, wordBreak: 'break-all', textAlign: 'center' }}>
        {bg.type === 'image' ? `image: ${bg.value.slice(0, 40)}…` : bg.value}
      </code>
    </div>
  );
}

function ControlledCompact({ initial }: { initial: Background }) {
  const [bg, setBg] = useState<Background>(initial);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <FillPicker background={bg} onChange={setBg} triggerLabel="" />
      <Preview bg={bg} />
    </div>
  );
}

export const DefaultColor: Story = {
  render: () => <Controlled initial={{ type: 'color', value: '#4f46e5' }} />,
};

export const StartGradient: Story = {
  render: () => (
    <Controlled
      initial={{ type: 'gradient', value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
    />
  ),
};

export const StartImage: Story = {
  render: () => (
    <Controlled
      initial={{
        type: 'image',
        value: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400',
        objectFit: 'cover',
      }}
    />
  ),
};

export const CompactTrigger: Story = {
  render: () => <ControlledCompact initial={{ type: 'color', value: '#10b981' }} />,
};

export const WithTheme: Story = {
  render: () => {
    const [bg, setBg] = useState<Background>({ type: 'color', value: '#6366f1' });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <FillPicker
          background={bg}
          onChange={setBg}
          theme={{ primaryColor: '#6366f1', backgroundColor: '#1e1b4b', accentColor: '#a5b4fc' }}
        />
        <Preview bg={bg} />
      </div>
    );
  },
};

export const Transparent: Story = {
  render: () => <Controlled initial={{ type: 'color', value: '#ffffff' }} />,
};
