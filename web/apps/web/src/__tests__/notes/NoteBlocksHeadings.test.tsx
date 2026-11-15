/** A note heading is stored as `# Title` in a paragraph; read-only views draw it as a heading. */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NoteBlocks } from '@/app/(apps)/notes/NoteBlocks';

describe('NoteBlocks headings', () => {
  it('draws # and ## as headings, without the markers', () => {
    render(<NoteBlocks content={'# Packing list\n\n## Documents\n\nPassport'} />);
    expect(screen.getByRole('heading', { name: 'Packing list' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeTruthy();
    expect(screen.queryByText(/^#/)).toBeNull();
    expect(screen.getByText('Passport')).toBeTruthy();
  });

  it('leaves a # that is not a heading as text', () => {
    render(<NoteBlocks content={'#hashtag is not a heading'} />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('#hashtag is not a heading')).toBeTruthy();
  });
});
