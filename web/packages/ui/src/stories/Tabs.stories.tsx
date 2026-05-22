import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FileText, Settings, Users } from 'lucide-react';
import { Tabs, TabList, Tab, TabPanel } from '../components/containers/Tabs';

const meta: Meta<typeof Tabs> = {
  title: 'Containers/Tabs',
  component: Tabs,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ width: '480px' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultTab="overview">
      <TabList>
        <Tab id="overview">Overview</Tab>
        <Tab id="analytics">Analytics</Tab>
        <Tab id="settings">Settings</Tab>
      </TabList>
      <TabPanel id="overview">
        <p>Overview content goes here.</p>
      </TabPanel>
      <TabPanel id="analytics">
        <p>Analytics content goes here.</p>
      </TabPanel>
      <TabPanel id="settings">
        <p>Settings content goes here.</p>
      </TabPanel>
    </Tabs>
  ),
};

export const Pills: Story = {
  render: () => (
    <Tabs defaultTab="files" variant="pills">
      <TabList>
        <Tab id="files">Files</Tab>
        <Tab id="shared">Shared</Tab>
        <Tab id="recent">Recent</Tab>
      </TabList>
      <TabPanel id="files">
        <p>Your files.</p>
      </TabPanel>
      <TabPanel id="shared">
        <p>Files shared with you.</p>
      </TabPanel>
      <TabPanel id="recent">
        <p>Recently viewed files.</p>
      </TabPanel>
    </Tabs>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <Tabs defaultTab="docs">
      <TabList>
        <Tab id="docs" icon={<FileText size={14} />}>Docs</Tab>
        <Tab id="team" icon={<Users size={14} />}>Team</Tab>
        <Tab id="settings" icon={<Settings size={14} />}>Settings</Tab>
      </TabList>
      <TabPanel id="docs">
        <p>Documentation content.</p>
      </TabPanel>
      <TabPanel id="team">
        <p>Team management.</p>
      </TabPanel>
      <TabPanel id="settings">
        <p>Configuration options.</p>
      </TabPanel>
    </Tabs>
  ),
};

export const WithBadge: Story = {
  render: () => (
    <Tabs defaultTab="inbox">
      <TabList>
        <Tab id="inbox" badge={12}>Inbox</Tab>
        <Tab id="sent">Sent</Tab>
        <Tab id="drafts" badge={3}>Drafts</Tab>
      </TabList>
      <TabPanel id="inbox">
        <p>12 unread messages.</p>
      </TabPanel>
      <TabPanel id="sent">
        <p>Sent messages.</p>
      </TabPanel>
      <TabPanel id="drafts">
        <p>3 draft messages.</p>
      </TabPanel>
    </Tabs>
  ),
};

export const WithDisabledTab: Story = {
  render: () => (
    <Tabs defaultTab="active">
      <TabList>
        <Tab id="active">Active</Tab>
        <Tab id="billing">Billing</Tab>
        <Tab id="enterprise" disabled>Enterprise</Tab>
      </TabList>
      <TabPanel id="active">
        <p>Active plan details.</p>
      </TabPanel>
      <TabPanel id="billing">
        <p>Billing history.</p>
      </TabPanel>
    </Tabs>
  ),
};
