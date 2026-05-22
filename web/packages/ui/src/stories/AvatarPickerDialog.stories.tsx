import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { AvatarPickerDialog } from '../components/containers/AvatarPickerDialog';
import { Button } from '../components/primitives/Button';

const meta: Meta<typeof AvatarPickerDialog> = {
  title: 'Containers/AvatarPickerDialog',
  component: AvatarPickerDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

function AvatarPickerDemo({ name = 'Jane Doe' }: { name?: string }) {
  const [open, setOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      {avatarUrl && (
        <img
          src={avatarUrl}
          alt="Selected avatar"
          style={{ width: 80, height: 80, borderRadius: '50%', border: '2px solid #e5e7eb' }}
        />
      )}
      <Button onClick={() => setOpen(true)}>Edit avatar</Button>
      {open && (
        <AvatarPickerDialog
          name={name}
          onApply={(url) => setAvatarUrl(url)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export const Default: Story = {
  render: () => <AvatarPickerDemo />,
};

export const WithName: Story = {
  render: () => <AvatarPickerDemo name="Alex Rivera" />,
};
