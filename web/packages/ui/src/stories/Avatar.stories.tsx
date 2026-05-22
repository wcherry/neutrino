import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Avatar } from '../components/primitives/Avatar';

const meta: Meta<typeof Avatar> = {
  title: 'Primitives/Avatar',
  component: Avatar,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'],
    },
    status: {
      control: 'select',
      options: [undefined, 'online', 'offline', 'busy'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const WithInitials: Story = {
  args: { name: 'Jane Doe', size: 'md' },
};

export const WithImage: Story = {
  args: {
    name: 'Jane Doe',
    src: 'https://i.pravatar.cc/150?img=47',
    size: 'md',
  },
};

export const ExtraSmall: Story = {
  args: { name: 'Alice Brown', size: 'xs' },
};

export const Small: Story = {
  args: { name: 'Bob Smith', size: 'sm' },
};

export const Large: Story = {
  args: { name: 'Carol Jones', size: 'lg' },
};

export const ExtraLarge: Story = {
  args: { name: 'David Williams', size: 'xl' },
};

export const DoubleExtraLarge: Story = {
  args: { name: 'Eve Martinez', size: 'xxl' },
};

export const StatusOnline: Story = {
  args: { name: 'Frank Lee', size: 'md', status: 'online' },
};

export const StatusOffline: Story = {
  args: { name: 'Grace Kim', size: 'md', status: 'offline' },
};

export const StatusBusy: Story = {
  args: { name: 'Henry Wang', size: 'md', status: 'busy' },
};

export const ImageWithStatus: Story = {
  args: {
    name: 'Irene Lopez',
    src: 'https://i.pravatar.cc/150?img=32',
    size: 'lg',
    status: 'online',
  },
};
