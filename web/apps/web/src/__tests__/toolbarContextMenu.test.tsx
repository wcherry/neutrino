/**
 * "Customize toolbar…" answers a right-click (Ctrl-click on a Mac) anywhere on the toolbar, not
 * only on a tool: the gaps and the empty end of the bar belong to the toolbar element, since the
 * tool items are `display: contents`.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { preferences } from '@neutrino/preferences';
import { ToolbarItems, type ToolDef } from '@/components/editorChrome/ToolbarItems';

const tools: ToolDef[] = [
  { id: 'history', render: () => <button type="button">Undo</button> },
  { id: 'font', render: () => <input aria-label="Font size" /> },
];

function bar(props: { root?: boolean } = {}) {
  return render(
    <div data-testid="bar" {...(props.root ? { 'data-toolbar-root': '' } : {})}>
      <span data-testid="title">Title</span>
      <div data-testid="region">
        <ToolbarItems editor="docs" tools={tools} divider={<span />} />
      </div>
    </div>,
  );
}

beforeEach(() => {
  preferences.reset('editor.toolbars');
});

describe('toolbar context menu', () => {
  it('opens on a tool', () => {
    bar();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('menuitem', { name: 'Customize toolbar…' })).toBeInTheDocument();
  });

  it('opens on the bar itself, between and after the tools', () => {
    bar();
    expect(fireEvent.contextMenu(screen.getByTestId('region'))).toBe(false);
    expect(screen.getByRole('menuitem', { name: 'Customize toolbar…' })).toBeInTheDocument();
  });

  it('covers the whole of a toolbar marked as the root, title included', () => {
    bar({ root: true });
    fireEvent.contextMenu(screen.getByTestId('title'));
    expect(screen.getByRole('menuitem', { name: 'Customize toolbar…' })).toBeInTheDocument();
  });

  it('leaves a text field its own menu', () => {
    bar();
    expect(fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Font size' }))).toBe(true);
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('opens the customize dialog from the menu', () => {
    bar();
    fireEvent.contextMenu(screen.getByTestId('region'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Customize toolbar…' }));
    expect(screen.getByRole('dialog', { name: 'Customize the Docs toolbar' })).toBeInTheDocument();
  });
});

describe('toolbar context menu placement', () => {
  it('is drawn on <body>, so a toolbar’s backdrop-filter cannot become its containing block', () => {
    bar();
    fireEvent.contextMenu(screen.getByTestId('region'), { clientX: 40, clientY: 20 });
    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getByTestId('bar').contains(menu)).toBe(false);
  });
});

describe('Photos editor toolbar', () => {
  it('is a customizable toolbar: a right-click on the rail opens Customize, with the Photos tools', async () => {
    const { PhotoToolbar } = await import('@/app/(apps)/photos/editor/PhotoToolbar');
    render(<PhotoToolbar activeTool="select" onToolChange={() => {}} />);
    const rail = screen.getByRole('toolbar', { name: 'Photo editing tools' });
    expect([...rail.querySelectorAll('[data-tool]')].map(el => el.getAttribute('data-tool')))
      .toEqual(['select', 'annotate', 'redact', 'clone']);
    expect(fireEvent.contextMenu(rail)).toBe(false);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Customize toolbar…' }));
    const dialog = screen.getByRole('dialog', { name: 'Customize the Photos toolbar' });
    expect(dialog).toHaveTextContent('Blur, pixelate and black box');
  });

  it('keeps hidden groups in More tools and still switches tools', async () => {
    preferences.set('editor.toolbars', { photos: { hidden: ['redact'] } });
    const { PhotoToolbar } = await import('@/app/(apps)/photos/editor/PhotoToolbar');
    const onToolChange = vi.fn();
    render(<PhotoToolbar activeTool="select" onToolChange={onToolChange} />);
    expect(screen.queryByRole('button', { name: 'Blur' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blur' }));
    expect(onToolChange).toHaveBeenCalledWith('blur');
    // Drawn on <body>, so the rail's own scrolling cannot clip it.
    expect(screen.getByRole('group', { name: 'More tools' }).parentElement).toBe(document.body);
  });
});
