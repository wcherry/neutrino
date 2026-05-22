import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Search, Mail, Eye } from 'lucide-react';
import { TextInput } from '../components/inputs/TextInput';

const meta: Meta<typeof TextInput> = {
  title: 'Inputs/TextInput',
  component: TextInput,
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
  args: { placeholder: 'Enter text…' },
};

export const WithLabel: Story = {
  args: { label: 'Email address', placeholder: 'you@example.com' },
};

export const WithHint: Story = {
  args: {
    label: 'Username',
    placeholder: 'john_doe',
    hint: 'Only letters, numbers, and underscores.',
  },
};

export const WithError: Story = {
  args: {
    label: 'Email address',
    placeholder: 'you@example.com',
    value: 'not-an-email',
    error: 'Please enter a valid email address.',
    readOnly: true,
  },
};

export const WithIconLeft: Story = {
  args: {
    placeholder: 'Search…',
    iconLeft: <Search size={16} />,
  },
};

export const WithIconRight: Story = {
  args: {
    label: 'Email',
    placeholder: 'you@example.com',
    iconLeft: <Mail size={16} />,
    iconRight: <Eye size={16} />,
  },
};

export const Small: Story = {
  args: { label: 'Small', placeholder: 'Small input', size: 'sm' },
};

export const Large: Story = {
  args: { label: 'Large', placeholder: 'Large input', size: 'lg' },
};

export const Disabled: Story = {
  args: { label: 'Disabled', placeholder: 'Cannot edit', disabled: true },
};

export const Required: Story = {
  args: { label: 'Required field', placeholder: 'Must fill in', required: true },
};
