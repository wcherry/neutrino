import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Spinner } from '../components/feedback/Spinner';

const meta: Meta<typeof Spinner> = {
  title: 'Feedback/Spinner',
  component: Spinner,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg', 'xl'],
    },
    color: {
      control: 'select',
      options: ['accent', 'white', 'muted', 'success', 'error'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { size: 'md', color: 'accent' },
};

export const ExtraSmall: Story = {
  args: { size: 'xs', color: 'accent' },
};

export const Small: Story = {
  args: { size: 'sm', color: 'accent' },
};

export const Large: Story = {
  args: { size: 'lg', color: 'accent' },
};

export const ExtraLarge: Story = {
  args: { size: 'xl', color: 'accent' },
};

export const Muted: Story = {
  args: { size: 'md', color: 'muted' },
};

export const Success: Story = {
  args: { size: 'md', color: 'success' },
};

export const Error: Story = {
  args: { size: 'md', color: 'error' },
};

export const White: Story = {
  args: { size: 'md', color: 'white' },
  parameters: {
    backgrounds: { default: 'dark' },
  },
};

export const WithLabel: Story = {
  args: { size: 'md', color: 'accent', label: 'Processing payment…' },
};
