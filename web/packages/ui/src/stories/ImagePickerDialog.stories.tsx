import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ImagePickerDialog } from '../components/panels/ImagePickerDialog';
import type { ImagePickerDriveItem, ImagePickerResult } from '../components/panels/ImagePickerDialog';

const meta: Meta<typeof ImagePickerDialog> = {
  title: 'Panels/ImagePickerDialog',
  component: ImagePickerDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Sample data ────────────────────────────────────────────────────────────

/** Inline SVGs so the stories render without any network access. */
function swatch(label: string, bg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320">
       <rect width="480" height="320" fill="${bg}"/>
       <text x="240" y="170" font-family="sans-serif" font-size="34" fill="#fff" text-anchor="middle">${label}</text>
     </svg>`,
  )}`;
}

const DRIVE_IMAGES: ImagePickerDriveItem[] = [
  { id: '1', name: 'team-offsite.jpg', url: swatch('Offsite', '#1a73e8') },
  { id: '2', name: 'q3-revenue-chart.png', url: swatch('Chart', '#0f9d58') },
  { id: '3', name: 'product-hero.png', url: swatch('Hero', '#d93025') },
  { id: '4', name: 'logo-dark.svg', url: swatch('Logo', '#5f6368') },
  { id: '5', name: 'office-front.jpg', url: swatch('Office', '#f4b400') },
  { id: '6', name: 'headshot.jpg', url: swatch('Headshot', '#673ab7') },
];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Interactive wrapper ────────────────────────────────────────────────────

function Demo(args: Partial<React.ComponentProps<typeof ImagePickerDialog>>) {
  const [inserted, setInserted] = useState<ImagePickerResult | null>(null);
  const [open, setOpen] = useState(true);

  return (
    <div style={{ minWidth: 420, fontFamily: 'system-ui, sans-serif' }}>
      <button onClick={() => { setOpen(true); setInserted(null); }}>Open image picker</button>
      {inserted && (
        <pre style={{ fontSize: 12, marginTop: 12 }}>
          {JSON.stringify({ ...inserted, src: `${inserted.src.slice(0, 48)}…` }, null, 2)}
        </pre>
      )}
      {open && (
        <ImagePickerDialog
          onFetchDriveImages={async () => { await delay(600); return DRIVE_IMAGES; }}
          onInsert={(result) => { setInserted(result); setOpen(false); }}
          onClose={() => setOpen(false)}
          {...args}
        />
      )}
    </div>
  );
}

// ── Stories ────────────────────────────────────────────────────────────────

/** The default: local files are inlined as data URLs. */
export const Default: Story = {
  render: () => <Demo />,
};

/** With an upload hook, a local file is stored in Drive and inserted by URL. */
export const UploadsLocalFilesToDrive: Story = {
  render: () => (
    <Demo
      onUploadLocalFile={async (file, onProgress) => {
        for (let p = 0; p <= 100; p += 20) { onProgress(p); await delay(150); }
        return { id: 'new', name: file.name, url: URL.createObjectURL(file) };
      }}
    />
  ),
};

/** Opening straight onto a specific source, as the docs toolbar's upload button does. */
export const OpensOnLocalFile: Story = {
  render: () => <Demo defaultSource="local" />,
};

/** Drive listing failure — the user can retry without reopening the dialog. */
export const DriveUnavailable: Story = {
  render: () => (
    <Demo onFetchDriveImages={async () => { await delay(400); throw new Error('offline'); }} />
  ),
};

/** No images in Drive yet. */
export const EmptyDrive: Story = {
  render: () => <Demo onFetchDriveImages={async () => []} />,
};
