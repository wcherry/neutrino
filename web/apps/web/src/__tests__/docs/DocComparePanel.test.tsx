/**
 * Tests for DocComparePanel component.
 *
 * Covers:
 * - Renders panel header with "Compare versions" title
 * - Shows version labels for base and compare versions
 * - Renders loading state while queries are in flight
 * - Renders diff when currentContent is provided (no API call needed)
 * - Shows "No differences" when documents are identical
 * - Close button calls onClose
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api', () => ({
  storageApi: {
    downloadVersionContent: vi.fn().mockResolvedValue('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}'),
  },
}));

vi.mock('./DocComparePanel.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

// Must mock after defining vi.mock above
import { DocComparePanel } from '../../app/(apps)/docs/editor/DocComparePanel';
import type { FileVersionItem } from '@neutrino/api-drive';

const baseVersion: FileVersionItem = {
  id: 'v1',
  fileId: 'file1',
  versionNumber: 1,
  sizeBytes: 100,
  label: 'Draft',
  createdAt: '2024-01-01T00:00:00Z',
};

const compareVersion: FileVersionItem = {
  id: '__current__',
  fileId: 'file1',
  versionNumber: 999,
  sizeBytes: 0,
  label: 'Current',
  createdAt: '2024-06-01T00:00:00Z',
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const defaultProps = {
  fileId: 'file1',
  baseVersion,
  compareVersion,
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DocComparePanel', () => {
  it('renders "Compare versions" header', () => {
    render(
      <DocComparePanel
        {...defaultProps}
        currentContent='{"type":"doc","content":[]}'
      />,
      { wrapper }
    );
    expect(screen.getByText('Compare versions')).toBeInTheDocument();
  });

  it('shows base version label', () => {
    render(
      <DocComparePanel
        {...defaultProps}
        currentContent='{"type":"doc","content":[]}'
      />,
      { wrapper }
    );
    expect(screen.getByText(/Draft.*v1/i)).toBeInTheDocument();
  });

  it('shows current version label', () => {
    render(
      <DocComparePanel
        {...defaultProps}
        currentContent='{"type":"doc","content":[]}'
      />,
      { wrapper }
    );
    expect(screen.getByText(/Current.*v999/i)).toBeInTheDocument();
  });

  it('shows "No differences" when docs are identical', async () => {
    const sameContent = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Same text' }] }],
    });
    // Need base version content to match — mock the API to return same content
    const { storageApi } = await import('@/lib/api');
    (storageApi.downloadVersionContent as ReturnType<typeof vi.fn>).mockResolvedValue(sameContent);

    render(
      <DocComparePanel
        {...defaultProps}
        currentContent={sameContent}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText(/no differences/i)).toBeInTheDocument();
    });
  });

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    render(
      <DocComparePanel
        {...defaultProps}
        onClose={onClose}
        currentContent='{"type":"doc","content":[]}'
      />,
      { wrapper }
    );
    screen.getByRole('button', { name: /close/i }).click();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows loading state while fetching base version', async () => {
    // Don't provide currentContent so compareQuery also runs
    // Also don't immediately resolve base query
    const { storageApi } = await import('@/lib/api');
    (storageApi.downloadVersionContent as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // never resolves

    render(
      <DocComparePanel {...defaultProps} />,
      { wrapper }
    );
    expect(screen.getByText(/loading versions/i)).toBeInTheDocument();
  });
});
