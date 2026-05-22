import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Alert } from '../components/feedback/Alert';

const meta: Meta<typeof Alert> = {
  title: 'Feedback/Alert',
  component: Alert,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ width: '420px' }}>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    variant: {
      control: 'select',
      options: ['info', 'success', 'warning', 'error'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {
  args: {
    variant: 'info',
    message: 'Your session will expire in 5 minutes.',
  },
};

export const Success: Story = {
  args: {
    variant: 'success',
    message: 'Your changes have been saved successfully.',
  },
};

export const Warning: Story = {
  args: {
    variant: 'warning',
    message: 'Your subscription is about to expire.',
  },
};

export const Error: Story = {
  args: {
    variant: 'error',
    message: 'Failed to connect. Please try again.',
  },
};

export const WithTitle: Story = {
  args: {
    variant: 'info',
    title: 'New feature available',
    message: 'Check out the redesigned settings panel for a better experience.',
  },
};

export const SuccessWithTitle: Story = {
  args: {
    variant: 'success',
    title: 'Payment received',
    message: 'Your invoice for $49.00 has been paid. A receipt has been sent to your email.',
  },
};

export const Dismissible: Story = {
  render: () => {
    const [visible, setVisible] = React.useState(true);
    if (!visible) {
      return (
        <button onClick={() => setVisible(true)} style={{ padding: '8px 16px' }}>
          Show alert
        </button>
      );
    }
    return (
      <div style={{ width: '420px' }}>
        <Alert
          variant="warning"
          title="Action required"
          message="Please verify your email address to continue."
          onClose={() => setVisible(false)}
        />
      </div>
    );
  },
};

export const ErrorDismissible: Story = {
  render: () => {
    const [visible, setVisible] = React.useState(true);
    if (!visible) {
      return (
        <button onClick={() => setVisible(true)} style={{ padding: '8px 16px' }}>
          Show alert
        </button>
      );
    }
    return (
      <div style={{ width: '420px' }}>
        <Alert
          variant="error"
          title="Upload failed"
          message="The file you uploaded exceeds the 10 MB limit."
          onClose={() => setVisible(false)}
        />
      </div>
    );
  },
};
