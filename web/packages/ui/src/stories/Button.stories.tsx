import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Search, Mail, ArrowRight } from 'lucide-react';
import { Button } from '../components/primitives/Button';

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost', 'danger'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { children: 'Button', variant: 'primary' },
};

export const Secondary: Story = {
  args: { children: 'Button', variant: 'secondary' },
};

export const Ghost: Story = {
  args: { children: 'Button', variant: 'ghost' },
};

export const Danger: Story = {
  args: { children: 'Delete', variant: 'danger' },
};

export const Small: Story = {
  args: { children: 'Small', variant: 'primary', size: 'sm' },
};

export const Medium: Story = {
  args: { children: 'Medium', variant: 'primary', size: 'md' },
};

export const Large: Story = {
  args: { children: 'Large', variant: 'primary', size: 'lg' },
};

export const Loading: Story = {
  args: { children: 'Saving…', variant: 'primary', loading: true },
};

export const WithIconLeft: Story = {
  args: {
    children: 'Search',
    variant: 'primary',
    icon: <Search size={16} />,
    iconPosition: 'left',
  },
};

export const WithIconRight: Story = {
  args: {
    children: 'Continue',
    variant: 'primary',
    icon: <ArrowRight size={16} />,
    iconPosition: 'right',
  },
};

export const IconSecondary: Story = {
  args: {
    children: 'Compose',
    variant: 'secondary',
    icon: <Mail size={16} />,
    iconPosition: 'left',
  },
};

export const Disabled: Story = {
  args: { children: 'Disabled', variant: 'primary', disabled: true },
};
