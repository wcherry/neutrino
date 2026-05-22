import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardHeader, CardFooter } from '../components/containers/Card';
import { Button } from '../components/primitives/Button';

const meta: Meta<typeof Card> = {
  title: 'Containers/Card',
  component: Card,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ width: '360px' }}>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    padding: {
      control: 'select',
      options: ['none', 'sm', 'md', 'lg', 'xl'],
    },
    shadow: {
      control: 'select',
      options: ['none', 'sm', 'md', 'lg'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: 'A simple card with default padding.',
  },
};

export const WithShadow: Story = {
  args: {
    shadow: 'md',
    children: 'A card with a medium shadow.',
  },
};

export const LargeShadow: Story = {
  args: {
    shadow: 'lg',
    padding: 'lg',
    children: 'A card with a large shadow and more padding.',
  },
};

export const Hoverable: Story = {
  args: {
    hoverable: true,
    shadow: 'sm',
    children: 'Hover over this card.',
  },
};

export const Selected: Story = {
  args: {
    selected: true,
    children: 'This card is selected.',
  },
};

export const NoPadding: Story = {
  args: {
    padding: 'none',
    children: (
      <div style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '6px' }}>
        Custom padding inside
      </div>
    ),
  },
};

export const WithHeader: Story = {
  render: () => (
    <div style={{ width: '360px' }}>
      <Card shadow="sm">
        <CardHeader title="Account Settings" subtitle="Manage your preferences" />
        <div style={{ padding: '0 1rem 1rem' }}>
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            Update your profile, notification settings, and security options.
          </p>
        </div>
      </Card>
    </div>
  ),
};

export const WithHeaderAction: Story = {
  render: () => (
    <div style={{ width: '360px' }}>
      <Card shadow="sm">
        <CardHeader
          title="Team Members"
          subtitle="3 members"
          action={<Button size="sm" variant="secondary">Invite</Button>}
        />
        <div style={{ padding: '0 1rem 1rem' }}>
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            Manage access and roles for your team.
          </p>
        </div>
      </Card>
    </div>
  ),
};

export const WithFooter: Story = {
  render: () => (
    <div style={{ width: '360px' }}>
      <Card shadow="sm">
        <CardHeader title="Delete workspace" subtitle="This action is permanent." />
        <div style={{ padding: '0 1rem' }}>
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            Once deleted, all data will be permanently removed and cannot be recovered.
          </p>
        </div>
        <CardFooter>
          <Button variant="secondary" size="sm">Cancel</Button>
          <Button variant="danger" size="sm">Delete</Button>
        </CardFooter>
      </Card>
    </div>
  ),
};
