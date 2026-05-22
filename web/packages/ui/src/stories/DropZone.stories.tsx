import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { DropZone } from '../components/inputs/DropZone';

const meta: Meta<typeof DropZone> = {
  title: 'Inputs/DropZone',
  component: DropZone,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    multiple: { control: 'boolean' },
    accept: { control: 'text' },
    label: { control: 'text' },
    hint: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

function DropZoneDemo(props: React.ComponentProps<typeof DropZone>) {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <div style={{ width: 400, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <DropZone {...props} onFiles={(f) => setFiles((prev) => [...prev, ...f])} />
      {files.length > 0 && (
        <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 13 }}>
          {files.map((f, i) => (
            <li key={i}>{f.name} ({(f.size / 1024).toFixed(1)} KB)</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const Default: Story = {
  render: (args) => <DropZoneDemo {...args} />,
  args: {
    label: 'Drag & drop files here',
    hint: 'or click to browse',
  },
};

export const SingleFile: Story = {
  render: (args) => <DropZoneDemo {...args} />,
  args: {
    multiple: false,
    label: 'Drop an image here',
    hint: 'or click to browse · PNG, JPG, GIF',
    accept: 'image/*',
  },
};

export const LargeUpload: Story = {
  render: (args) => <DropZoneDemo {...args} />,
  args: {
    label: 'Drag & drop files here',
    hint: 'or click to browse · up to 10 GB per file',
  },
};
