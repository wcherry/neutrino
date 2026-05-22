import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FileText, Folder, Image, Music, Video, Archive } from 'lucide-react';
import { FileGrid, type GridItem, type SortField, type SortDir } from '../components/display/FileGrid';

const meta: Meta<typeof FileGrid> = {
  title: 'Display/FileGrid',
  component: FileGrid,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLE_ITEMS: GridItem[] = [
  { id: '1', name: 'Project Brief.pdf', kind: 'file', icon: FileText, iconColor: '#dc2626', subtitle: '2.4 MB', mimeType: 'application/pdf', typeText: 'PDF', sizeText: '2.4 MB', modifiedText: 'May 18, 2026' },
  { id: '2', name: 'Design Assets', kind: 'folder', icon: Folder, iconColor: '#d97706', subtitle: 'Folder', typeText: 'Folder', modifiedText: 'May 17, 2026' },
  { id: '3', name: 'hero.png', kind: 'file', icon: Image, iconColor: '#7c3aed', subtitle: '840 KB', mimeType: 'image/png', typeText: 'PNG', sizeText: '840 KB', modifiedText: 'May 16, 2026', isStarred: true },
  { id: '4', name: 'soundtrack.mp3', kind: 'file', icon: Music, iconColor: '#0891b2', subtitle: '8.1 MB', mimeType: 'audio/mp3', typeText: 'MP3', sizeText: '8.1 MB', modifiedText: 'May 15, 2026' },
  { id: '5', name: 'demo.mp4', kind: 'file', icon: Video, iconColor: '#16a34a', subtitle: '142 MB', mimeType: 'video/mp4', typeText: 'MP4', sizeText: '142 MB', modifiedText: 'May 14, 2026', isStarred: true },
  { id: '6', name: 'release-v2.zip', kind: 'file', icon: Archive, iconColor: '#374151', subtitle: '34 MB', mimeType: 'application/zip', typeText: 'ZIP', sizeText: '34 MB', modifiedText: 'May 13, 2026' },
];

function FileGridDemo(props: Partial<React.ComponentProps<typeof FileGrid>>) {
  const [sortBy, setSortBy] = useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  return (
    <div style={{ padding: 24 }}>
      <FileGrid
        items={SAMPLE_ITEMS}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(field, dir) => { setSortBy(field); setSortDir(dir); }}
        onItemClick={(item) => alert(`Opened: ${item.name}`)}
        totalCount={SAMPLE_ITEMS.length}
        {...props}
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <FileGridDemo />,
};

export const WithFilter: Story = {
  render: () => <FileGridDemo showFilter />,
};

export const Loading: Story = {
  render: () => <FileGridDemo isLoading />,
};

export const Empty: Story = {
  render: () => (
    <FileGridDemo
      items={[]}
      emptyState={<p style={{ textAlign: 'center', color: '#888', padding: 40 }}>No files found.</p>}
    />
  ),
};
