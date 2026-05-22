import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/containers/Modal';
import { Button } from '../components/primitives/Button';

const meta: Meta<typeof Modal> = {
  title: 'Containers/Modal',
  component: Modal,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'xl', 'full'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

function ModalDemo({
  size = 'md' as const,
  title = 'Modal title',
  children,
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  title?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open modal</Button>
      <Modal open={open} onClose={() => setOpen(false)} size={size}>
        <ModalHeader title={title} onClose={() => setOpen(false)} />
        <ModalBody>
          {children ?? (
            <p style={{ margin: 0 }}>
              This is the modal body. You can place any content here.
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => setOpen(false)}>
            Confirm
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

export const Default: Story = {
  render: () => <ModalDemo />,
};

export const Small: Story = {
  render: () => <ModalDemo size="sm" title="Small modal" />,
};

export const Large: Story = {
  render: () => <ModalDemo size="lg" title="Large modal" />,
};

export const ExtraLarge: Story = {
  render: () => <ModalDemo size="xl" title="Extra large modal" />,
};

export const WithLongContent: Story = {
  render: () => (
    <ModalDemo title="Terms of Service">
      {Array.from({ length: 8 }, (_, i) => (
        <p key={i} style={{ margin: '0 0 0.75rem' }}>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt
          ut labore et dolore magna aliqua. Ut enim ad minim veniam.
        </p>
      ))}
    </ModalDemo>
  ),
};

export const DeleteConfirmation: Story = {
  render: () => {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete account
        </Button>
        <Modal open={open} onClose={() => setOpen(false)} size="sm">
          <ModalHeader title="Delete account" onClose={() => setOpen(false)} />
          <ModalBody>
            <p style={{ margin: 0 }}>
              Are you sure you want to delete your account? This action cannot be undone and all
              data will be permanently removed.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={() => setOpen(false)}>
              Delete
            </Button>
          </ModalFooter>
        </Modal>
      </>
    );
  },
};
