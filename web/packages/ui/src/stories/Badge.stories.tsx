import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from '../components/primitives/Badge';

const meta: Meta<typeof Badge> = {
  title: 'Primitives/Badge',
  component: Badge,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'accent', 'success', 'warning', 'error', 'info'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: 'Default', variant: 'default' },
};

export const Accent: Story = {
  args: { children: 'Accent', variant: 'accent' },
};

export const Success: Story = {
  args: { children: 'Success', variant: 'success' },
};

export const Warning: Story = {
  args: { children: 'Warning', variant: 'warning' },
};

export const Error: Story = {
  args: { children: 'Error', variant: 'error' },
};

export const Info: Story = {
  args: { children: 'Info', variant: 'info' },
};

export const Small: Story = {
  args: { children: 'Small', variant: 'default', size: 'sm' },
};

export const Large: Story = {
  args: { children: 'Large', variant: 'accent', size: 'lg' },
};

export const WithDot: Story = {
  args: { children: 'Live', variant: 'success', dot: true },
};

export const DotWarning: Story = {
  args: { children: 'Pending', variant: 'warning', dot: true },
};
