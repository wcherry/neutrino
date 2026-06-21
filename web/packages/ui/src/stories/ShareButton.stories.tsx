import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ShareButton } from '../components/display/ShareButton';

const meta: Meta<typeof ShareButton> = {
  title: 'Display/ShareButton',
  component: ShareButton,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    onShare: { action: 'onShare' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const USERS = [
  { name: 'Alice Brown' },
  { name: 'Bob Smith' },
  { name: 'Carol Jones' },
  { name: 'David Williams' },
  { name: 'Eve Martinez' },
];

export const NoShares: Story = {
  name: 'No shares (button only)',
  args: { users: [] },
};

export const OneUser: Story = {
  name: 'One user',
  args: { users: USERS.slice(0, 1) },
};

export const TwoUsers: Story = {
  name: 'Two users',
  args: { users: USERS.slice(0, 2) },
};

export const ThreeUsers: Story = {
  name: 'Three users (max, no overflow)',
  args: { users: USERS.slice(0, 3) },
};

export const FourUsers: Story = {
  name: 'Four users (overflow +2)',
  args: { users: USERS.slice(0, 4) },
};

export const ManyUsers: Story = {
  name: 'Many users (overflow +3)',
  args: { users: USERS },
};

export const WithImages: Story = {
  name: 'With avatar images',
  args: {
    users: [
      { name: 'Alice Brown', src: 'https://i.pravatar.cc/150?img=1' },
      { name: 'Bob Smith', src: 'https://i.pravatar.cc/150?img=2' },
      { name: 'Carol Jones', src: 'https://i.pravatar.cc/150?img=3' },
      { name: 'David Williams', src: 'https://i.pravatar.cc/150?img=4' },
    ],
  },
};
