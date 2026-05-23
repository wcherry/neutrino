import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FileText, Folder, Image, Music, Video, Archive, Presentation } from 'lucide-react';
import { FileGrid, type GridItem, type SortField, type SortDir, type ViewMode } from '../components/display/FileGrid';

const meta: Meta<typeof FileGrid> = {
  title: 'Display/FileGrid',
  component: FileGrid,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Docs & Presentations (matches the screenshot) ──────────────────────────
const DOCS_ITEMS: GridItem[] = [
  {
    id: '1',
    name: 'Untitled presentation',
    kind: 'doc',
    icon: Presentation,
    iconColor: 'var(--color-orange, #ea580c)',
    subtitle: '1.3 KB',
    mimeType: 'application/vnd.neutrino.slides',
    typeText: 'Slides',
    sizeText: '1.3 KB',
    modifiedText: 'May 22, 2026',
  },
  {
    id: '2',
    name: 'Untitled document',
    kind: 'doc',
    icon: FileText,
    iconColor: 'var(--color-primary, #3b82f6)',
    subtitle: '27 B',
    mimeType: 'application/vnd.neutrino.doc',
    typeText: 'Document',
    sizeText: '27 B',
    modifiedText: 'May 21, 2026',
  },
  {
    id: '3',
    name: 'Untitled document',
    kind: 'doc',
    icon: FileText,
    iconColor: 'var(--color-primary, #3b82f6)',
    subtitle: '0 B',
    mimeType: 'application/vnd.neutrino.doc',
    typeText: 'Document',
    sizeText: '0 B',
    modifiedText: 'May 20, 2026',
  },
];

// ── Mixed file types ───────────────────────────────────────────────────────
const MIXED_ITEMS: GridItem[] = [
  { id: '1', name: 'Project Brief.pdf', kind: 'file', icon: FileText, iconColor: '#dc2626', subtitle: '2.4 MB', mimeType: 'application/pdf', typeText: 'PDF', sizeText: '2.4 MB', modifiedText: 'May 18, 2026' },
  { id: '2', name: 'Design Assets', kind: 'folder', icon: Folder, iconColor: '#d97706', subtitle: 'Folder', typeText: 'Folder', modifiedText: 'May 17, 2026' },
  { id: '3', name: 'hero.png', kind: 'file', icon: Image, iconColor: '#7c3aed', subtitle: '840 KB', mimeType: 'image/png', typeText: 'PNG', sizeText: '840 KB', modifiedText: 'May 16, 2026', isStarred: true },
  { id: '4', name: 'soundtrack.mp3', kind: 'file', icon: Music, iconColor: '#0891b2', subtitle: '8.1 MB', mimeType: 'audio/mp3', typeText: 'MP3', sizeText: '8.1 MB', modifiedText: 'May 15, 2026' },
  { id: '5', name: 'demo.mp4', kind: 'file', icon: Video, iconColor: '#16a34a', subtitle: '142 MB', mimeType: 'video/mp4', typeText: 'MP4', sizeText: '142 MB', modifiedText: 'May 14, 2026', isStarred: true },
  { id: '6', name: 'release-v2.zip', kind: 'file', icon: Archive, iconColor: '#374151', subtitle: '34 MB', mimeType: 'application/zip', typeText: 'ZIP', sizeText: '34 MB', modifiedText: 'May 13, 2026' },
];

function FileGridDemo(props: Partial<React.ComponentProps<typeof FileGrid>> & { defaultItems?: GridItem[] }) {
  const [sortBy, setSortBy] = useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const { defaultItems = MIXED_ITEMS, ...rest } = props;

  return (
    <div style={{ padding: 24 }}>
      <FileGrid
        items={defaultItems}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(field, dir) => { setSortBy(field); setSortDir(dir); }}
        onItemClick={(item) => console.log('Opened:', item.name)}
        totalCount={defaultItems.length}
        {...rest}
      />
    </div>
  );
}

function InteractiveDemo(props: { defaultViewMode?: ViewMode }) {
  const [sortBy, setSortBy] = useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [items, setItems] = useState<GridItem[]>(DOCS_ITEMS);

  function toggleStar(target: GridItem) {
    setItems((prev) => prev.map((it) => it.id === target.id ? { ...it, isStarred: !it.isStarred } : it));
  }

  return (
    <div style={{ padding: 24 }}>
      <FileGrid
        items={items}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(field, dir) => { setSortBy(field); setSortDir(dir); }}
        onItemClick={(item) => console.log('Opened:', item.name)}
        onToggleStar={toggleStar}
        onItemMenuOpen={(item, e) => { e.preventDefault(); console.log('Menu for:', item.name); }}
        totalCount={items.length}
        {...props}
      />
    </div>
  );
}

// ── Stories ────────────────────────────────────────────────────────────────

/** Presentation and document cards — matches the Drive/Slides home screen. */
export const PresentationsAndDocs: Story = {
  name: 'Presentations & Docs',
  render: () => <FileGridDemo defaultItems={DOCS_ITEMS} />,
};

/** Interactive: star toggle and context-menu button are wired up. */
export const Interactive: Story = {
  render: () => <InteractiveDemo />,
};

/** List view showing name, type, size and modified date columns. */
export const ListView: Story = {
  render: () => <InteractiveDemo defaultViewMode="list" />,
};

/** Small grid — compact card variant. */
export const SmallGrid: Story = {
  render: () => <InteractiveDemo defaultViewMode="small" />,
};

/** Filter chips let the user narrow by file type or starred status. */
export const WithFilter: Story = {
  render: () => <FileGridDemo showFilter />,
};

/** Mixed file types — images, audio, video, archives, folders. */
export const Default: Story = {
  render: () => <FileGridDemo />,
};

export const Loading: Story = {
  render: () => <FileGridDemo isLoading />,
};

export const Empty: Story = {
  render: () => (
    <FileGridDemo
      defaultItems={[]}
      items={[]}
      emptyState={<p style={{ textAlign: 'center', color: '#888', padding: 40 }}>No files found.</p>}
    />
  ),
};
