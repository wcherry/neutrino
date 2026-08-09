/**
 * Unit tests for the DriveFilePicker component.
 *
 * Covers:
 *   - Renders a loading state while Drive files are being fetched
 *   - Renders a list of files and folders returned by filesystemApi
 *   - Filters visible items by the search query (client-side)
 *   - Clicking a folder navigates into it and updates the breadcrumb
 *   - Clicking a file calls onSelect with the correct id and name
 *   - Shows an empty state when no files match the search
 *   - Back navigation via breadcrumb returns to parent folder
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { DriveFilePicker } from '../../app/(apps)/calendar/DriveFilePicker';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const CURRENT_USER_ID = 'user-1';

vi.mock('@neutrino/auth', () => ({
  useUser: () => ({ id: CURRENT_USER_ID }),
}));

const mockRootContents = {
  folder: null,
  folders: [
    {
      id: 'folder-1',
      name: 'Work Docs',
      parentId: null,
      color: null,
      isStarred: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    },
  ],
  files: [
    {
      id: 'file-1',
      name: 'Meeting Agenda.docx',
      sizeBytes: 1024,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      folderId: null,
      isStarred: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      coverThumbnail: null,
      coverThumbnailMimeType: null,
    },
    {
      id: 'file-2',
      name: 'Budget.xlsx',
      sizeBytes: 2048,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      folderId: null,
      isStarred: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      coverThumbnail: null,
      coverThumbnailMimeType: null,
    },
  ],
};

const mockFolderContents = {
  folder: {
    id: 'folder-1',
    name: 'Work Docs',
    parentId: null,
    color: null,
    isStarred: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  },
  folders: [],
  files: [
    {
      id: 'file-3',
      name: 'Project Plan.pdf',
      sizeBytes: 5120,
      mimeType: 'application/pdf',
      folderId: 'folder-1',
      isStarred: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      coverThumbnail: null,
      coverThumbnailMimeType: null,
    },
  ],
};

// The picker calls `getFolderContents` for both the root (id === the
// caller's own user id, see `useUser`/`GET /auth/me`) and real folders —
// there is no separate root-listing call any more.
const mockGetFolderContents = vi.fn((id?: unknown, _query?: unknown) =>
  Promise.resolve(id === CURRENT_USER_ID ? mockRootContents : mockFolderContents)
);

vi.mock('@neutrino/api-drive', () => ({
  filesystemApi: {
    getFolderContents: (id: any, query: any) => mockGetFolderContents(id, query),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Make queries resolve immediately in tests
        staleTime: 0,
        gcTime: 0,
      },
    },
  });
}

function renderPicker(props: { onSelect?: (f: { id: string; name: string }) => void; onClose?: () => void } = {}) {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      {/* The picker is a modal: it fetches and renders nothing unless open. */}
      <DriveFilePicker open onSelect={props.onSelect ?? vi.fn()} onClose={props.onClose ?? vi.fn()} />
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DriveFilePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks() clears call history but NOT a `mockReturnValue`/
    // `mockResolvedValue` override left by a previous test (that needs
    // mockReset()) — re-arm the id-dispatching default explicitly so one
    // test's override (e.g. the loading-indicator test below) can't leak
    // into the next.
    mockGetFolderContents.mockImplementation((id?: unknown) =>
      Promise.resolve(id === CURRENT_USER_ID ? mockRootContents : mockFolderContents)
    );
  });

  it('renders file and folder names from root Drive contents', async () => {
    renderPicker();
    await waitFor(() => {
      expect(screen.getByText('Work Docs')).toBeInTheDocument();
      expect(screen.getByText('Meeting Agenda.docx')).toBeInTheDocument();
      expect(screen.getByText('Budget.xlsx')).toBeInTheDocument();
    });
  });

  it('shows a loading indicator while files are being fetched', async () => {
    // Never-resolving promise to hold loading state
    mockGetFolderContents.mockReturnValue(new Promise(() => {}));
    renderPicker();
    expect(screen.getByTestId('drive-picker-loading')).toBeInTheDocument();
  });

  it('filters visible items by the search query', async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText('Meeting Agenda.docx')).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText(/filter by name/i);
    fireEvent.change(searchInput, { target: { value: 'Budget' } });

    expect(screen.getByText('Budget.xlsx')).toBeInTheDocument();
    expect(screen.queryByText('Meeting Agenda.docx')).not.toBeInTheDocument();
    expect(screen.queryByText('Work Docs')).not.toBeInTheDocument();
  });

  it('shows empty state when no files match the search query', async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText('Meeting Agenda.docx')).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText(/filter by name/i);
    fireEvent.change(searchInput, { target: { value: 'zzz-no-match' } });

    expect(screen.getByTestId('drive-picker-empty')).toBeInTheDocument();
  });

  it('calls onSelect with file id and name when a file is clicked', async () => {
    const onSelect = vi.fn();
    renderPicker({ onSelect });
    await waitFor(() => expect(screen.getByText('Meeting Agenda.docx')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Meeting Agenda.docx'));

    expect(onSelect).toHaveBeenCalledWith({ id: 'file-1', name: 'Meeting Agenda.docx' });
  });

  it('navigates into a folder when clicked and fetches folder contents', async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText('Work Docs')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Work Docs'));

    await waitFor(() => {
      expect(mockGetFolderContents).toHaveBeenCalledWith('folder-1', undefined);
      expect(screen.getByText('Project Plan.pdf')).toBeInTheDocument();
    });
  });

  it('shows the folder name in the breadcrumb after navigating into it', async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText('Work Docs')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Work Docs'));

    await waitFor(() => expect(screen.getByText('Project Plan.pdf')).toBeInTheDocument());

    const breadcrumbItems = screen.getAllByTestId('breadcrumb-item');
    const names = breadcrumbItems.map((el) => el.textContent);
    expect(names).toContain('My Drive');
    expect(names).toContain('Work Docs');
  });

  it('navigates back to root when the root breadcrumb is clicked', async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText('Work Docs')).toBeInTheDocument());

    // Navigate into folder
    fireEvent.click(screen.getByText('Work Docs'));
    await waitFor(() => expect(screen.getByText('Project Plan.pdf')).toBeInTheDocument());

    // Navigate back via root breadcrumb (first breadcrumb-item = "My Drive")
    fireEvent.click(screen.getAllByTestId('breadcrumb-item')[0]);

    await waitFor(() => {
      expect(screen.getByText('Meeting Agenda.docx')).toBeInTheDocument();
    });
  });

  it('calls onClose when the Cancel button is clicked', async () => {
    const onClose = vi.fn();
    renderPicker({ onClose });
    await waitFor(() => expect(screen.getByText('Meeting Agenda.docx')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
