import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { VersionHistoryPanel, type VersionItem } from '../components/panels/VersionHistoryPanel';

const meta: Meta<typeof VersionHistoryPanel> = {
  title: 'Panels/VersionHistoryPanel',
  component: VersionHistoryPanel,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE_VERSIONS: VersionItem[] = [
  { id: 'v3', versionNumber: 3, sizeBytes: 142_000, label: null, createdAt: new Date(Date.now() - 600_000).toISOString() },
  { id: 'v2', versionNumber: 2, sizeBytes: 138_500, label: 'Before refactor', createdAt: new Date(Date.now() - 3_600_000).toISOString() },
  { id: 'v1', versionNumber: 1, sizeBytes: 89_200, label: 'Initial draft', createdAt: new Date(Date.now() - 86_400_000).toISOString() },
];

function Demo(props: Partial<React.ComponentProps<typeof VersionHistoryPanel>>) {
  const [versions, setVersions] = useState<VersionItem[]>(SAMPLE_VERSIONS);

  return (
    <div style={{ display: 'flex', height: '100vh', justifyContent: 'flex-end' }}>
      <VersionHistoryPanel
        versions={versions}
        onClose={() => alert('close')}
        onLabelVersion={async (versionId, label) => {
          await new Promise(r => setTimeout(r, 500));
          setVersions(prev => prev.map(v => v.id === versionId ? { ...v, label } : v));
        }}
        onRestoreVersion={async (versionId) => {
          await new Promise(r => setTimeout(r, 800));
          alert(`Restored to version ${versions.find(v => v.id === versionId)?.versionNumber}`);
        }}
        {...props}
      />
    </div>
  );
}

const noop = async () => {};

export const Default: Story = {
  render: () => <Demo />,
};

export const Loading: Story = {
  render: () => (
    <div style={{ display: 'flex', height: '100vh', justifyContent: 'flex-end' }}>
      <VersionHistoryPanel
        versions={[]}
        isLoading
        onClose={noop}
        onLabelVersion={noop}
        onRestoreVersion={noop}
      />
    </div>
  ),
};

export const Empty: Story = {
  render: () => (
    <div style={{ display: 'flex', height: '100vh', justifyContent: 'flex-end' }}>
      <VersionHistoryPanel
        versions={[]}
        onClose={noop}
        onLabelVersion={noop}
        onRestoreVersion={noop}
      />
    </div>
  ),
};
