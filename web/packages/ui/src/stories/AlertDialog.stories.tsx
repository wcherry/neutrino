import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { AlertDialog } from '../components/containers/AlertDialog';
import { Button } from '../components/primitives/Button';

const meta: Meta<typeof AlertDialog> = {
  title: 'Containers/AlertDialog',
  component: AlertDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['info', 'success', 'warning', 'error'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

function AlertDialogDemo(props: React.ComponentProps<typeof AlertDialog>) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <AlertDialog
        {...props}
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
      />
    </>
  );
}

export const Info: Story = {
  render: () => (
    <AlertDialogDemo
      variant="info"
      title="Session expiring soon"
      description="Your session will expire in 5 minutes. Save your work to avoid losing any changes."
      confirmLabel="Stay signed in"
      cancelLabel="Sign out"
    />
  ),
};

export const Success: Story = {
  render: () => (
    <AlertDialogDemo
      variant="success"
      title="Changes published"
      description="Your document has been published and is now visible to all collaborators."
      confirmLabel="View document"
      cancelLabel="Close"
    />
  ),
};

export const Warning: Story = {
  render: () => (
    <AlertDialogDemo
      variant="warning"
      title="Unsaved changes"
      description="You have unsaved changes that will be lost if you leave this page."
      confirmLabel="Leave anyway"
      cancelLabel="Stay on page"
    />
  ),
};

export const Error: Story = {
  render: () => (
    <AlertDialogDemo
      variant="error"
      title="Delete file?"
      description={'This will permanently delete "Project Report.pdf". This action cannot be undone.'}
      confirmLabel="Delete"
      cancelLabel="Cancel"
    />
  ),
};

export const Loading: Story = {
  render: () => {
    const [open, setOpen] = React.useState(false);
    const [loading, setLoading] = React.useState(false);

    function handleConfirm() {
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
        setOpen(false);
      }, 2000);
    }

    return (
      <>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete account
        </Button>
        <AlertDialog
          open={open}
          onClose={() => !loading && setOpen(false)}
          onConfirm={handleConfirm}
          variant="error"
          title="Delete account"
          description="This will permanently delete your account and all associated data. This action cannot be undone."
          confirmLabel="Delete account"
          cancelLabel="Cancel"
          loading={loading}
        />
      </>
    );
  },
};

export const ConfirmOnly: Story = {
  render: () => (
    <AlertDialogDemo
      variant="success"
      title="Import complete"
      description="All 142 contacts have been successfully imported."
      confirmLabel="Done"
      cancelLabel=""
    />
  ),
};
