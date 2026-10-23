/**
 * Image properties is a non-modal panel over the page (it was a floating `PanelContainer`):
 * the shared `Panel` frame with tabs inside, Cancel and Apply in its footer, and a close control.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { ImagePropertiesModal } from '@/app/(apps)/docs/editor/ImagePropertiesModal';

function fakeEditor() {
  const run = vi.fn();
  const chain = { focus: () => chain, updateAttributes: vi.fn(() => chain), run };
  return { editor: { chain: () => chain } as unknown as Editor, chain, run };
}

describe('Image properties', () => {
  it('is a labelled, non-modal panel with a tab per group of settings', () => {
    const { editor } = fakeEditor();
    render(<ImagePropertiesModal editor={editor} initialAttrs={{ alt: 'A cat' }} onClose={() => {}} />);
    const panel = screen.getByRole('dialog', { name: 'Image properties' });
    expect(panel).toHaveAttribute('aria-modal', 'false');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Layout', 'Appearance', 'Tint', 'Metadata']);
    fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
    expect(screen.getByDisplayValue('A cat')).toBeInTheDocument();
  });

  it('applies the settings to the image and closes', () => {
    const { editor, chain, run } = fakeEditor();
    const onClose = vi.fn();
    render(<ImagePropertiesModal editor={editor} initialAttrs={{ alt: 'A cat' }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(chain.updateAttributes).toHaveBeenCalledWith('image', expect.objectContaining({ alt: 'A cat' }));
    expect(run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('closes without applying from its close control, Cancel or Escape', () => {
    const { editor, run } = fakeEditor();
    const onClose = vi.fn();
    render(<ImagePropertiesModal editor={editor} initialAttrs={{}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close image properties' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(run).not.toHaveBeenCalled();
  });
});
