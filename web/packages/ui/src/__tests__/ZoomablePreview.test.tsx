/**
 * ZoomablePreview — the zoom slider every grid preview carries.
 *
 *   - The slider scales the content (and reflows it, via --preview-scale)
 *   - The step buttons move it by `step` and stop at the bounds
 *   - Using the slider never reaches the card it sits on: clicks would open
 *     the file, and Enter/Space would reach the card's keyboard handler
 *   - FileGrid renders an item's `preview` through it in the large grid only
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { FileText } from 'lucide-react';
import { ZoomablePreview } from '../components/display/ZoomablePreview';
import { FileGrid, type GridItem } from '../components/display/FileGrid';

function scaleOf(container: HTMLElement): string | null {
  const content = container.querySelector<HTMLElement>('[style*="--preview-scale"]');
  return content?.style.getPropertyValue('--preview-scale') ?? null;
}

describe('ZoomablePreview', () => {
  it('starts at 100% and scales the content as the slider moves', () => {
    const { container } = render(<ZoomablePreview label="Shopping">hello</ZoomablePreview>);
    expect(scaleOf(container)).toBe('1');
    expect(screen.getByText('100%')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Zoom level'), { target: { value: '150' } });
    expect(scaleOf(container)).toBe('1.5');
    expect(screen.getByText('150%')).toBeTruthy();
  });

  it('steps with the buttons and stops at the bounds', () => {
    const onZoomChange = vi.fn();
    render(
      <ZoomablePreview min={50} max={100} step={25} defaultZoom={75} onZoomChange={onZoomChange}>
        x
      </ZoomablePreview>,
    );
    fireEvent.click(screen.getByLabelText('Zoom out'));
    expect(onZoomChange).toHaveBeenLastCalledWith(50);
    expect((screen.getByLabelText('Zoom out') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Zoom in'));
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(onZoomChange).toHaveBeenLastCalledWith(100);
    expect((screen.getByLabelText('Zoom in') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps clicks and keys on the slider away from the host', () => {
    const onClick = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <div onClick={onClick} onKeyDown={onKeyDown}>
        <ZoomablePreview>x</ZoomablePreview>
      </div>,
    );
    fireEvent.click(screen.getByLabelText('Zoom in'));
    fireEvent.keyDown(screen.getByLabelText('Zoom level'), { key: ' ' });
    fireEvent.keyDown(screen.getByLabelText('Zoom level'), { key: 'Enter' });
    expect(onClick).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
  });
});

describe('FileGrid previews', () => {
  const items: GridItem[] = [
    {
      id: 'n1',
      name: 'Shopping',
      kind: 'doc',
      icon: FileText,
      iconColor: 'orange',
      preview: <p>Milk and eggs</p>,
    },
  ];
  const props = {
    items,
    onItemClick: vi.fn(),
    sortBy: 'name' as const,
    sortDir: 'asc' as const,
    onSortChange: vi.fn(),
  };

  it('renders the preview with a zoom slider on the large card', () => {
    render(<FileGrid {...props} />);
    const card = screen.getByRole('listitem', { name: 'Shopping' });
    expect(within(card).getByText('Milk and eggs')).toBeTruthy();
    expect(within(card).getByLabelText('Zoom level')).toBeTruthy();
  });

  it('does not open the item when the slider is used', () => {
    const onItemClick = vi.fn();
    render(<FileGrid {...props} onItemClick={onItemClick} />);
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(onItemClick).not.toHaveBeenCalled();
  });

  it('keeps the icon on small cards', () => {
    render(<FileGrid {...props} defaultViewMode="small" />);
    expect(screen.queryByText('Milk and eggs')).toBeNull();
    expect(screen.queryByLabelText('Zoom level')).toBeNull();
  });
});
