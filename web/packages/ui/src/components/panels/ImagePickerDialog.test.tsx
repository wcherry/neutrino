import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImagePickerDialog, type ImagePickerDriveItem } from './ImagePickerDialog';

const DRIVE_ITEMS: ImagePickerDriveItem[] = [
  { id: 'f1', name: 'sunset.png', url: 'https://drive.test/f1' },
  { id: 'f2', name: 'chart.png', url: 'https://drive.test/f2' },
];

function setup(overrides: Partial<React.ComponentProps<typeof ImagePickerDialog>> = {}) {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  const onFetchDriveImages = vi.fn().mockResolvedValue(DRIVE_ITEMS);
  render(
    <ImagePickerDialog
      onFetchDriveImages={onFetchDriveImages}
      onInsert={onInsert}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onInsert, onClose, onFetchDriveImages };
}

/** The single preview-pane image (Drive thumbnails render with an empty alt). */
function previewImage() {
  return screen.getByAltText('Selected image preview');
}

function insertButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^Insert$/ }) as HTMLButtonElement;
}

describe('ImagePickerDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers the three image sources', () => {
    setup();
    expect(screen.getByRole('tab', { name: /Neutrino Drive/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Local File/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /URL/ })).toBeTruthy();
  });

  it('inserts a Drive image only once its preview has loaded', async () => {
    const { onInsert } = setup();

    fireEvent.click(await screen.findByTitle('sunset.png'));

    // The preview is on screen but has not decoded yet.
    expect(insertButton().disabled).toBe(true);

    const img = previewImage();
    Object.defineProperty(img, 'naturalWidth', { value: 800 });
    Object.defineProperty(img, 'naturalHeight', { value: 600 });
    fireEvent.load(img);

    expect(insertButton().disabled).toBe(false);
    fireEvent.click(insertButton());

    expect(onInsert).toHaveBeenCalledWith({
      src: 'https://drive.test/f1',
      source: 'drive',
      driveFileId: 'f1',
      name: 'sunset.png',
      width: 800,
      height: 600,
    });
  });

  it('does not fetch Drive images until the Drive tab is shown', async () => {
    const { onFetchDriveImages } = setup({ defaultSource: 'url' });
    expect(onFetchDriveImages).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: /Neutrino Drive/ }));
    await waitFor(() => expect(onFetchDriveImages).toHaveBeenCalledTimes(1));
  });

  it('filters the Drive grid by name', async () => {
    setup();
    await screen.findByTitle('sunset.png');

    fireEvent.change(screen.getByLabelText('Search your images'), { target: { value: 'chart' } });

    expect(screen.queryByTitle('sunset.png')).toBeNull();
    expect(screen.getByTitle('chart.png')).toBeTruthy();
  });

  it('offers a retry when the Drive listing fails', async () => {
    const onFetchDriveImages = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(DRIVE_ITEMS);
    render(<ImagePickerDialog onFetchDriveImages={onFetchDriveImages} onInsert={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByTitle('sunset.png')).toBeTruthy();
  });

  it('rejects a URL whose image cannot be loaded, and accepts one that can', async () => {
    const { onInsert } = setup({ defaultSource: 'url' });

    fireEvent.change(screen.getByLabelText('Image address'), {
      target: { value: 'https://example.test/broken.png' },
    });

    // Debounced, so the preview only appears once typing settles.
    await waitFor(() => expect(previewImage()).toBeTruthy());

    fireEvent.error(previewImage());
    expect(screen.getByText(/Could not load an image from that address/)).toBeTruthy();
    expect(insertButton().disabled).toBe(true);

    fireEvent.load(previewImage());
    expect(insertButton().disabled).toBe(false);
    fireEvent.click(insertButton());

    expect(onInsert).toHaveBeenCalledWith({ src: 'https://example.test/broken.png', source: 'url' });
  });

  it('uploads a local file to Drive when the caller supplies an upload hook', async () => {
    const onUploadLocalFile = vi.fn().mockResolvedValue({
      id: 'uploaded-1', name: 'photo.png', url: 'https://drive.test/uploaded-1',
    });
    const { onInsert } = setup({ defaultSource: 'local', onUploadLocalFile });

    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('image-picker-file-input'), { target: { files: [file] } });

    fireEvent.load(previewImage());
    fireEvent.click(insertButton());

    await waitFor(() => expect(onInsert).toHaveBeenCalledWith({
      src: 'https://drive.test/uploaded-1',
      source: 'local',
      driveFileId: 'uploaded-1',
      name: 'photo.png',
    }));
    expect(onUploadLocalFile).toHaveBeenCalledWith(file, expect.any(Function));
  });

  it('embeds a local file as a data URL when no upload hook is supplied', async () => {
    const { onInsert } = setup({ defaultSource: 'local' });

    const file = new File(['bytes'], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('image-picker-file-input'), { target: { files: [file] } });

    fireEvent.load(previewImage());
    fireEvent.click(insertButton());

    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1));
    const result = onInsert.mock.calls[0][0];
    expect(result.source).toBe('local');
    expect(result.name).toBe('photo.png');
    expect(result.src).toMatch(/^data:image\/png;base64,/);
  });

  it('refuses a dropped file that is not an image', () => {
    setup({ defaultSource: 'local' });

    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('image-picker-file-input'), { target: { files: [file] } });

    expect(screen.getByText('That file is not an image.')).toBeTruthy();
    expect(screen.queryByAltText('Selected image preview')).toBeNull();
  });

  it('closes on Escape', () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
