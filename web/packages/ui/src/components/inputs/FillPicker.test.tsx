import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FillPicker, type Background, type FillImageChoice } from './FillPicker';

/**
 * The image tab of FillPicker, which either stores the image it was given or
 * hands the choice to the caller to store — the second being how a background
 * ends up as a reference to a file rather than as the file's bytes.
 */

function Harness({
  onStoreImage,
  onResolveImageValue,
}: {
  onStoreImage?: (choice: FillImageChoice) => Promise<string>;
  onResolveImageValue?: (value: string) => Promise<string>;
}) {
  const [background, setBackground] = useState<Background>({ type: 'color', value: '#ffffff' });
  return (
    <>
      <FillPicker
        background={background}
        onChange={setBackground}
        onFetchDriveImages={async () => [{ id: 'drive-1', name: 'sky.png', url: 'https://drive.test/sky.png' }]}
        onStoreImage={onStoreImage}
        onResolveImageValue={onResolveImageValue}
      />
      <output data-testid="stored">{`${background.type}:${background.value}`}</output>
    </>
  );
}

function stored() {
  return screen.getByTestId('stored').textContent;
}

/** Opens the picker and switches to the image tab. */
function openImageTab() {
  fireEvent.click(screen.getByTitle('Fill'));
  fireEvent.click(screen.getByRole('button', { name: 'Image' }));
}

beforeEach(() => vi.clearAllMocks());

describe('FillPicker image sources', () => {
  it('stores the image itself when the caller has no store hook', async () => {
    render(<Harness />);
    openImageTab();

    const input = screen.getByPlaceholderText('Image URL…');
    fireEvent.change(input, { target: { value: 'https://example.test/a.png' } });
    fireEvent.blur(input);

    await waitFor(() => expect(stored()).toBe('image:https://example.test/a.png'));
  });

  it('stores what the caller returns for a URL', async () => {
    const onStoreImage = vi.fn().mockResolvedValue('neutrino-drive:new-1');
    render(<Harness onStoreImage={onStoreImage} />);
    openImageTab();

    const input = screen.getByPlaceholderText('Image URL…');
    fireEvent.change(input, { target: { value: 'https://example.test/a.png' } });
    fireEvent.blur(input);

    await waitFor(() => expect(stored()).toBe('image:neutrino-drive:new-1'));
    expect(onStoreImage).toHaveBeenCalledWith({ kind: 'url', url: 'https://example.test/a.png' });
  });

  it('hands a local file to the caller instead of inlining its bytes', async () => {
    const onStoreImage = vi.fn().mockResolvedValue('neutrino-drive:new-2');
    const { container } = render(<Harness onStoreImage={onStoreImage} />);
    openImageTab();
    fireEvent.click(screen.getByRole('button', { name: 'Local' }));

    const file = new File(['bytes'], 'holiday.png', { type: 'image/png' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });

    await waitFor(() => expect(stored()).toBe('image:neutrino-drive:new-2'));
    expect(onStoreImage).toHaveBeenCalledWith({ kind: 'file', file });
    // The point of the hook: no data URL anywhere near the stored value.
    expect(stored()).not.toContain('data:');
  });

  it('hands a Drive image to the caller rather than storing its URL', async () => {
    const onStoreImage = vi.fn().mockResolvedValue('neutrino-drive:drive-1');
    render(<Harness onStoreImage={onStoreImage} />);
    openImageTab();
    fireEvent.click(screen.getByRole('button', { name: 'Drive' }));

    fireEvent.click(await screen.findByTitle('sky.png'));

    await waitFor(() => expect(stored()).toBe('image:neutrino-drive:drive-1'));
    expect(onStoreImage).toHaveBeenCalledWith({
      kind: 'drive',
      item: expect.objectContaining({ id: 'drive-1' }),
    });
  });

  it('reports a failed store instead of silently keeping the old background', async () => {
    const onStoreImage = vi.fn().mockRejectedValue(new Error('Upload failed.'));
    render(<Harness onStoreImage={onStoreImage} />);
    openImageTab();

    const input = screen.getByPlaceholderText('Image URL…');
    fireEvent.change(input, { target: { value: 'https://example.test/a.png' } });
    fireEvent.blur(input);

    expect(await screen.findByText('Upload failed.')).toBeTruthy();
    expect(stored()).toBe('color:#ffffff');
  });

  it('does not show a stored reference back in the URL box', async () => {
    const onStoreImage = vi.fn().mockResolvedValue('neutrino-drive:new-3');
    render(<Harness onStoreImage={onStoreImage} onResolveImageValue={async () => 'blob:resolved'} />);
    openImageTab();

    const input = screen.getByPlaceholderText('Image URL…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://example.test/a.png' } });
    fireEvent.blur(input);

    await waitFor(() => expect(stored()).toBe('image:neutrino-drive:new-3'));
    expect(input.value).not.toContain('neutrino-drive:');
  });
});
