/**
 * The zip viewer in Drive's preview: walking folders and opening a file.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import JSZip from 'jszip';

vi.mock('@neutrino/ui', () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Spinner: () => <div data-testid="spinner" />,
}));

vi.mock('../../app/(apps)/drive/ZipViewer.module.css', () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));
vi.mock('../../app/(apps)/drive/PreviewModal.module.css', () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));

import { ZipViewer } from '../../app/(apps)/drive/ZipViewer';

async function zipBlob(files: Record<string, string | Uint8Array>): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: 'blob' });
}

describe('ZipViewer', () => {
  it('walks into a folder, opens a text file, and comes back', async () => {
    const source = await zipBlob({
      'project/notes.txt': 'remember the milk',
      'project/data.bin': new Uint8Array([0, 1, 2, 3]),
      'readme.txt': 'hi',
    });
    render(<ZipViewer source={source} fileName="bundle.zip" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open folder project' }));
    expect(await screen.findByRole('button', { name: 'Open notes.txt' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open readme.txt' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open notes.txt' }));
    expect(await screen.findByText('remember the milk')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to archive contents' }));
    // Back lands in the folder it left, not at the root.
    expect(await screen.findByRole('button', { name: 'Open data.bin' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'bundle.zip' }));
    expect(await screen.findByRole('button', { name: 'Open readme.txt' })).toBeTruthy();
  });

  it('says when a file has no preview rather than showing garbage', async () => {
    const source = await zipBlob({ 'blob.bin': new Uint8Array([0, 0, 0, 1]) });
    render(<ZipViewer source={source} fileName="b.zip" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open blob.bin' }));
    expect(await screen.findByText('Preview not available for this file type.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download blob.bin' })).toBeTruthy();
  });

  it('shows text with no telling extension when the bytes are text', async () => {
    const source = await zipBlob({ 'NOTES': 'plain words' });
    render(<ZipViewer source={source} fileName="n.zip" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open NOTES' }));
    expect(await screen.findByText('plain words')).toBeTruthy();
  });

  it('reports an archive it cannot read', async () => {
    render(<ZipViewer source={new Blob(['nope'])} fileName="bad.zip" />);
    await waitFor(() => expect(screen.getByText('This file is not a valid zip archive.')).toBeTruthy());
  });
});
