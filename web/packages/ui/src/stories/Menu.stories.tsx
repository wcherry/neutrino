import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Edit, Trash2, Copy, Download, Share2, Star, ExternalLink } from 'lucide-react';
import { Menu, MenuItem, MenuSeparator, MenuGroup } from '../components/navigation/Menu';

const meta: Meta<typeof Menu> = {
  title: 'Navigation/Menu',
  component: Menu,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ width: '220px' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Menu aria-label="File actions">
      <MenuItem id="edit" label="Edit" icon={<Edit size={14} />} onClick={() => {}} />
      <MenuItem id="copy" label="Copy" icon={<Copy size={14} />} onClick={() => {}} />
      <MenuItem id="download" label="Download" icon={<Download size={14} />} onClick={() => {}} />
    </Menu>
  ),
};

export const WithSeparator: Story = {
  render: () => (
    <Menu aria-label="Item actions">
      <MenuItem id="edit" label="Edit" icon={<Edit size={14} />} onClick={() => {}} />
      <MenuItem id="copy" label="Copy" icon={<Copy size={14} />} onClick={() => {}} />
      <MenuSeparator />
      <MenuItem
        id="delete"
        label="Delete"
        icon={<Trash2 size={14} />}
        danger
        onClick={() => {}}
      />
    </Menu>
  ),
};

export const WithShortcuts: Story = {
  render: () => (
    <Menu aria-label="Edit menu">
      <MenuItem id="edit" label="Edit" icon={<Edit size={14} />} shortcut="⌘E" onClick={() => {}} />
      <MenuItem id="copy" label="Copy" icon={<Copy size={14} />} shortcut="⌘C" onClick={() => {}} />
      <MenuItem id="share" label="Share" icon={<Share2 size={14} />} shortcut="⌘⇧S" onClick={() => {}} />
      <MenuSeparator />
      <MenuItem
        id="delete"
        label="Delete"
        icon={<Trash2 size={14} />}
        shortcut="⌫"
        danger
        onClick={() => {}}
      />
    </Menu>
  ),
};

export const WithActiveItem: Story = {
  render: () => (
    <Menu aria-label="View options">
      <MenuItem id="grid" label="Grid view" active onClick={() => {}} />
      <MenuItem id="list" label="List view" onClick={() => {}} />
      <MenuItem id="kanban" label="Kanban view" onClick={() => {}} />
    </Menu>
  ),
};

export const WithDisabledItem: Story = {
  render: () => (
    <Menu aria-label="File actions">
      <MenuItem id="edit" label="Edit" icon={<Edit size={14} />} onClick={() => {}} />
      <MenuItem
        id="share"
        label="Share (Pro only)"
        icon={<Share2 size={14} />}
        disabled
        onClick={() => {}}
      />
      <MenuItem id="star" label="Star" icon={<Star size={14} />} onClick={() => {}} />
    </Menu>
  ),
};

export const WithGroups: Story = {
  render: () => (
    <Menu aria-label="Actions">
      <MenuGroup label="File">
        <MenuItem id="edit" label="Edit" icon={<Edit size={14} />} onClick={() => {}} />
        <MenuItem id="copy" label="Copy" icon={<Copy size={14} />} onClick={() => {}} />
        <MenuItem id="download" label="Download" icon={<Download size={14} />} onClick={() => {}} />
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup label="Open with">
        <MenuItem id="external" label="Open in browser" icon={<ExternalLink size={14} />} href="#" />
      </MenuGroup>
    </Menu>
  ),
};

export const WithLinkItem: Story = {
  render: () => (
    <Menu aria-label="Navigation">
      <MenuItem id="docs" label="Documentation" icon={<ExternalLink size={14} />} href="#" />
      <MenuItem id="changelog" label="Changelog" icon={<ExternalLink size={14} />} href="#" />
      <MenuSeparator />
      <MenuItem id="delete" label="Delete" icon={<Trash2 size={14} />} danger onClick={() => {}} />
    </Menu>
  ),
};

export const UsingItemsProp: Story = {
  render: () => (
    <Menu
      aria-label="Quick actions"
      items={[
        { id: 'edit', label: 'Edit', icon: <Edit size={14} />, onClick: () => {} },
        { id: 'copy', label: 'Copy', icon: <Copy size={14} />, shortcut: '⌘C', onClick: () => {} },
        { id: 'delete', label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => {} },
      ]}
    />
  ),
};
