import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { SaveAsDialog } from '../components/panels/SaveAsDialog';
import type { SaveAsBreadcrumb, SaveAsDriveFolder } from '../components/panels/SaveAsDialog';

const meta: Meta<typeof SaveAsDialog> = {
  title: 'Panels/SaveAsDialog',
  component: SaveAsDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Sample data ────────────────────────────────────────────────────────────

const ROOT_FOLDERS: SaveAsDriveFolder[] = [
  { id: 'f1', name: 'Documents', color: '#1a73e8' },
  { id: 'f2', name: 'Projects',  color: '#d97706' },
  { id: 'f3', name: 'Archive',   color: null },
  { id: 'f4', name: 'Shared with me', color: '#16a34a' },
];

const SUB_FOLDERS: SaveAsDriveFolder[] = [
  { id: 'f11', name: 'Q1 Reports', color: null },
  { id: 'f12', name: 'Q2 Reports', color: null },
];

// ── Interactive wrapper ───────────────────────────────────────────────────

function Demo(args: Partial<React.ComponentProps<typeof SaveAsDialog>>) {
  const [breadcrumbs, setBreadcrumbs] = useState<SaveAsBreadcrumb[]>([{ id: null, name: 'My Drive' }]);
  const [loading, setLoading] = useState(false);

  const currentId = breadcrumbs[breadcrumbs.length - 1]?.id ?? null;
  const folders = currentId ? SUB_FOLDERS : ROOT_FOLDERS;

  function handleFolderClick(folder: SaveAsDriveFolder) {
    setLoading(true);
    setTimeout(() => {
      setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
      setLoading(false);
    }, 400);
  }

  function handleBreadcrumbClick(entry: SaveAsBreadcrumb, index: number) {
    if (index === breadcrumbs.length - 1) return;
    setBreadcrumbs(prev => prev.slice(0, index + 1));
  }

  return (
    <SaveAsDialog
      defaultFilename="Untitled document.pdf"
      format="pdf"
      onSave={async (opts) => {
        await new Promise(r => setTimeout(r, 1000));
        alert(JSON.stringify(opts, null, 2));
      }}
      onClose={() => alert('closed')}
      driveBreadcrumbs={breadcrumbs}
      driveFolders={loading ? [] : folders}
      driveFolderLoading={loading}
      driveFolderError={false}
      onDriveFolderClick={handleFolderClick}
      onDriveBreadcrumbClick={handleBreadcrumbClick}
      {...args}
    />
  );
}

// ── Stories ────────────────────────────────────────────────────────────────

export const PDF: Story = {
  render: () => <Demo />,
};

export const Docx: Story = {
  render: () => (
    <Demo
      defaultFilename="Untitled document.docx"
      format="docx"
    />
  ),
};

export const Html: Story = {
  render: () => (
    <Demo
      defaultFilename="Untitled document.html"
      format="html"
    />
  ),
};

export const DriveWithFolders: Story = {
  name: 'Drive — with folders',
  render: () => (
    <SaveAsDialog
      defaultFilename="Report.pdf"
      format="pdf"
      onSave={async () => {}}
      onClose={() => {}}
      driveBreadcrumbs={[{ id: null, name: 'My Drive' }, { id: 'f1', name: 'Documents' }]}
      driveFolders={SUB_FOLDERS}
      driveFolderLoading={false}
      driveFolderError={false}
      onDriveFolderClick={() => {}}
      onDriveBreadcrumbClick={() => {}}
    />
  ),
};

export const DriveLoading: Story = {
  name: 'Drive — loading folders',
  render: () => (
    <SaveAsDialog
      defaultFilename="Report.pdf"
      format="pdf"
      onSave={async () => {}}
      onClose={() => {}}
      driveBreadcrumbs={[{ id: null, name: 'My Drive' }]}
      driveFolders={[]}
      driveFolderLoading
      driveFolderError={false}
      onDriveFolderClick={() => {}}
      onDriveBreadcrumbClick={() => {}}
    />
  ),
};

export const DriveError: Story = {
  name: 'Drive — error state',
  render: () => (
    <SaveAsDialog
      defaultFilename="Report.pdf"
      format="pdf"
      onSave={async () => {}}
      onClose={() => {}}
      driveBreadcrumbs={[{ id: null, name: 'My Drive' }]}
      driveFolders={[]}
      driveFolderLoading={false}
      driveFolderError
      onDriveFolderClick={() => {}}
      onDriveBreadcrumbClick={() => {}}
    />
  ),
};

export const DriveEmpty: Story = {
  name: 'Drive — no subfolders',
  render: () => (
    <SaveAsDialog
      defaultFilename="Report.pdf"
      format="pdf"
      onSave={async () => {}}
      onClose={() => {}}
      driveBreadcrumbs={[{ id: null, name: 'My Drive' }, { id: 'f3', name: 'Archive' }]}
      driveFolders={[]}
      driveFolderLoading={false}
      driveFolderError={false}
      onDriveFolderClick={() => {}}
      onDriveBreadcrumbClick={() => {}}
    />
  ),
};
