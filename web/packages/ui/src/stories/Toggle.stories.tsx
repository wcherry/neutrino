import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Toggle } from '../components/inputs/Toggle';

const meta: Meta<typeof Toggle> = {
  title: 'Inputs/Toggle',
  component: Toggle,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    labelPosition: {
      control: 'radio',
      options: ['left', 'right'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: 'Enable notifications' },
};

export const Checked: Story = {
  args: { label: 'Dark mode', defaultChecked: true },
};

export const WithDescription: Story = {
  args: {
    label: 'Two-factor authentication',
    description: 'Add an extra layer of security to your account.',
  },
};

export const Small: Story = {
  args: { label: 'Small toggle', size: 'sm' },
};

export const Medium: Story = {
  args: { label: 'Medium toggle', size: 'md' },
};

export const Large: Story = {
  args: { label: 'Large toggle', size: 'lg' },
};

export const LabelLeft: Story = {
  args: { label: 'Auto-save', labelPosition: 'left' },
};

export const Disabled: Story = {
  args: { label: 'Disabled', disabled: true },
};

export const DisabledChecked: Story = {
  args: { label: 'Disabled on', disabled: true, defaultChecked: true },
};
