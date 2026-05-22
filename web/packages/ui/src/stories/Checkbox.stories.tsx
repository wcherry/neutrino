import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Checkbox } from '../components/inputs/Checkbox';

const meta: Meta<typeof Checkbox> = {
  title: 'Inputs/Checkbox',
  component: Checkbox,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: 'Accept terms and conditions' },
};

export const Checked: Story = {
  args: { label: 'Checked by default', defaultChecked: true },
};

export const WithDescription: Story = {
  args: {
    label: 'Marketing emails',
    description: 'Receive product updates and promotional emails.',
  },
};

export const Indeterminate: Story = {
  args: {
    label: 'Select all',
    indeterminate: true,
  },
};

export const Disabled: Story = {
  args: { label: 'Disabled option', disabled: true },
};

export const DisabledChecked: Story = {
  args: { label: 'Disabled and checked', disabled: true, defaultChecked: true },
};

export const NoLabel: Story = {
  args: {},
};
