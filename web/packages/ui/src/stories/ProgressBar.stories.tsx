import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ProgressBar } from '../components/feedback/ProgressBar';

const meta: Meta<typeof ProgressBar> = {
  title: 'Feedback/ProgressBar',
  component: ProgressBar,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ width: '400px' }}>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg', 'xl'],
    },
    color: {
      control: 'select',
      options: ['accent', 'success', 'warning', 'error', 'info'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { value: 60 },
};

export const WithLabel: Story = {
  args: { value: 45, label: 'Uploading file…' },
};

export const WithValue: Story = {
  args: { value: 72, showValue: true },
};

export const WithLabelAndValue: Story = {
  args: { value: 38, label: 'Storage used', showValue: true },
};

export const Indeterminate: Story = {
  args: { indeterminate: true, label: 'Loading…' },
};

export const ColorSuccess: Story = {
  args: { value: 100, color: 'success', label: 'Complete', showValue: true },
};

export const ColorWarning: Story = {
  args: { value: 80, color: 'warning', label: 'Almost full', showValue: true },
};

export const ColorError: Story = {
  args: { value: 95, color: 'error', label: 'Critical', showValue: true },
};

export const ColorInfo: Story = {
  args: { value: 30, color: 'info' },
};

export const SizeXs: Story = {
  args: { value: 50, size: 'xs' },
};

export const SizeSm: Story = {
  args: { value: 50, size: 'sm' },
};

export const SizeLg: Story = {
  args: { value: 50, size: 'lg' },
};

export const SizeXl: Story = {
  args: { value: 50, size: 'xl' },
};

export const LowProgress: Story = {
  args: { value: 5, label: 'Syncing', showValue: true },
};
