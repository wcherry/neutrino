import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ShareDialog } from '../components/panels/ShareDialog';
import type { SharePermission, ShareLinkData, SharePermissionRole } from '../components/panels/ShareDialog';

const meta: Meta<typeof ShareDialog> = {
  title: 'Panels/ShareDialog',
  component: ShareDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Sample data ───────────────────────────────────────────────────────────────

const SAMPLE_PERMISSIONS: SharePermission[] = [
  { id: 'p1', userId: 'u1', role: 'owner', userName: 'Alice Johnson', userEmail: 'alice@example.com' },
  { id: 'p2', userId: 'u2', role: 'editor', userName: 'Bob Smith', userEmail: 'bob@example.com' },
  { id: 'p3', userId: 'u3', role: 'viewer', userName: null, userEmail: 'carol@example.com' },
];

const SAMPLE_LINK: ShareLinkData = {
  token: 'abc123',
  isActive: true,
  role: 'viewer',
  visibility: 'anyoneWithLink',
  expiresAt: null,
};

// ── Interactive wrapper ───────────────────────────────────────────────────────

function Demo() {
  const [permissions, setPermissions] = useState<SharePermission[]>(SAMPLE_PERMISSIONS);
  const [shareLink, setShareLink] = useState<ShareLinkData | null>(SAMPLE_LINK);

  async function handleAddPerson(email: string, role: SharePermissionRole) {
    await new Promise((r) => setTimeout(r, 500));
    setPermissions((prev) => [
      ...prev,
      {
        id: `p${Date.now()}`,
        userId: `u${Date.now()}`,
        role,
        userName: null,
        userEmail: email,
      },
    ]);
  }

  function handleRoleChange(userId: string, role: SharePermissionRole) {
    setPermissions((prev) =>
      prev.map((p) => (p.userId === userId ? { ...p, role } : p))
    );
  }

  function handleRevoke(userId: string) {
    setPermissions((prev) => prev.filter((p) => p.userId !== userId));
  }

  function handleCreateLink() {
    setShareLink({
      token: `token-${Date.now()}`,
      isActive: true,
      role: 'viewer',
      visibility: 'anyoneWithLink',
      expiresAt: null,
    });
  }

  function handleToggleLink(isActive: boolean) {
    setShareLink((prev) => (prev ? { ...prev, isActive } : prev));
  }

  function handleLinkRoleChange(role: string) {
    setShareLink((prev) => (prev ? { ...prev, role } : prev));
  }

  function handleLinkVisibilityChange(visibility: 'public' | 'anyoneWithLink') {
    setShareLink((prev) => (prev ? { ...prev, visibility } : prev));
  }

  function handleLinkExpiryChange(expiresAt: string | null) {
    setShareLink((prev) => (prev ? { ...prev, expiresAt } : prev));
  }

  function handleDeleteLink() {
    setShareLink(null);
  }

  return (
    <ShareDialog
      resourceName="My Document.pdf"
      permissions={permissions}
      shareLink={shareLink}
      onClose={() => alert('closed')}
      onAddPerson={handleAddPerson}
      onRoleChange={handleRoleChange}
      onRevoke={handleRevoke}
      onCreateLink={handleCreateLink}
      onToggleLink={handleToggleLink}
      onLinkRoleChange={handleLinkRoleChange}
      onLinkVisibilityChange={handleLinkVisibilityChange}
      onLinkExpiryChange={handleLinkExpiryChange}
      onDeleteLink={handleDeleteLink}
    />
  );
}

// ── Stories ───────────────────────────────────────────────────────────────────

export const Default: Story = {
  render: () => (
    <ShareDialog
      resourceName="My Document.pdf"
      permissions={SAMPLE_PERMISSIONS}
      shareLink={SAMPLE_LINK}
      onClose={() => {}}
      onAddPerson={async () => {}}
      onRoleChange={() => {}}
      onRevoke={() => {}}
      onCreateLink={() => {}}
      onToggleLink={() => {}}
      onLinkRoleChange={() => {}}
      onLinkVisibilityChange={() => {}}
      onLinkExpiryChange={() => {}}
      onDeleteLink={() => {}}
    />
  ),
};

export const Loading: Story = {
  render: () => (
    <ShareDialog
      resourceName="My Document.pdf"
      permissionsLoading
      shareLinkLoading
      onClose={() => {}}
      onAddPerson={async () => {}}
      onRoleChange={() => {}}
      onRevoke={() => {}}
      onCreateLink={() => {}}
      onToggleLink={() => {}}
      onLinkRoleChange={() => {}}
      onLinkVisibilityChange={() => {}}
      onLinkExpiryChange={() => {}}
      onDeleteLink={() => {}}
    />
  ),
};

export const NoLink: Story = {
  render: () => (
    <ShareDialog
      resourceName="My Document.pdf"
      permissions={SAMPLE_PERMISSIONS}
      shareLink={null}
      onClose={() => {}}
      onAddPerson={async () => {}}
      onRoleChange={() => {}}
      onRevoke={() => {}}
      onCreateLink={() => {}}
      onToggleLink={() => {}}
      onLinkRoleChange={() => {}}
      onLinkVisibilityChange={() => {}}
      onLinkExpiryChange={() => {}}
      onDeleteLink={() => {}}
    />
  ),
};

export const LinkInactive: Story = {
  render: () => (
    <ShareDialog
      resourceName="My Document.pdf"
      permissions={SAMPLE_PERMISSIONS}
      shareLink={{ ...SAMPLE_LINK, isActive: false }}
      onClose={() => {}}
      onAddPerson={async () => {}}
      onRoleChange={() => {}}
      onRevoke={() => {}}
      onCreateLink={() => {}}
      onToggleLink={() => {}}
      onLinkRoleChange={() => {}}
      onLinkVisibilityChange={() => {}}
      onLinkExpiryChange={() => {}}
      onDeleteLink={() => {}}
    />
  ),
};

export const LinkWithExpiry: Story = {
  render: () => (
    <ShareDialog
      resourceName="My Document.pdf"
      permissions={SAMPLE_PERMISSIONS}
      shareLink={{ ...SAMPLE_LINK, isActive: true, expiresAt: '2026-08-01T12:00:00' }}
      onClose={() => {}}
      onAddPerson={async () => {}}
      onRoleChange={() => {}}
      onRevoke={() => {}}
      onCreateLink={() => {}}
      onToggleLink={() => {}}
      onLinkRoleChange={() => {}}
      onLinkVisibilityChange={() => {}}
      onLinkExpiryChange={() => {}}
      onDeleteLink={() => {}}
    />
  ),
};

export const Empty: Story = {
  render: () => (
    <ShareDialog
      resourceName="My Document.pdf"
      permissions={[]}
      shareLink={null}
      onClose={() => {}}
      onAddPerson={async () => {}}
      onRoleChange={() => {}}
      onRevoke={() => {}}
      onCreateLink={() => {}}
      onToggleLink={() => {}}
      onLinkRoleChange={() => {}}
      onLinkVisibilityChange={() => {}}
      onLinkExpiryChange={() => {}}
      onDeleteLink={() => {}}
    />
  ),
};

export const Interactive: Story = {
  render: () => <Demo />,
};
