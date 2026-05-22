import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Select } from '../components/inputs/Select';

const FRUIT_OPTIONS = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'durian', label: 'Durian', disabled: true },
];

const meta: Meta<typeof Select> = {
  title: 'Inputs/Select',
  component: Select,
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
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    options: FRUIT_OPTIONS,
    placeholder: 'Pick a fruit…',
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Favourite fruit',
    options: FRUIT_OPTIONS,
    placeholder: 'Pick a fruit…',
  },
};

export const WithHint: Story = {
  args: {
    label: 'Country',
    options: [
      { value: 'us', label: 'United States' },
      { value: 'gb', label: 'United Kingdom' },
      { value: 'ca', label: 'Canada' },
    ],
    hint: 'Select the country where you reside.',
  },
};

export const WithError: Story = {
  args: {
    label: 'Favourite fruit',
    options: FRUIT_OPTIONS,
    error: 'Please select an option.',
  },
};

export const Small: Story = {
  args: {
    label: 'Small',
    options: FRUIT_OPTIONS,
    size: 'sm',
  },
};

export const Large: Story = {
  args: {
    label: 'Large',
    options: FRUIT_OPTIONS,
    size: 'lg',
  },
};

export const Disabled: Story = {
  args: {
    label: 'Disabled',
    options: FRUIT_OPTIONS,
    disabled: true,
  },
};

export const Required: Story = {
  args: {
    label: 'Required selection',
    options: FRUIT_OPTIONS,
    placeholder: 'Choose one…',
    required: true,
  },
};
