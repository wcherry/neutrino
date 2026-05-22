import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton, FileListSkeleton } from '../components/feedback/SkeletonLoader';

const meta: Meta<typeof Skeleton> = {
  title: 'Feedback/Skeleton',
  component: Skeleton,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ width: '320px' }}>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    shape: {
      control: 'select',
      options: ['text', 'circle', 'rect', 'rounded'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Text: Story = {
  args: { shape: 'text', width: '100%' },
};

export const Rect: Story = {
  args: { shape: 'rect', width: '100%', height: 120 },
};

export const Circle: Story = {
  args: { shape: 'circle', width: 48, height: 48 },
};

export const Rounded: Story = {
  args: { shape: 'rounded', width: '100%', height: 48 },
};

export const CardSkeleton: Story = {
  render: () => (
    <div style={{ width: '320px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <Skeleton shape="rect" width="100%" height={160} />
      <Skeleton shape="text" width="70%" />
      <Skeleton shape="text" width="50%" />
      <Skeleton shape="text" width="90%" />
    </div>
  ),
};

export const ProfileSkeleton: Story = {
  render: () => (
    <div style={{ width: '320px', display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <Skeleton shape="circle" width={48} height={48} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <Skeleton shape="text" width="60%" />
        <Skeleton shape="text" width="40%" />
      </div>
    </div>
  ),
};

export const FileList: StoryObj<typeof FileListSkeleton> = {
  render: () => <FileListSkeleton rows={4} />,
};
