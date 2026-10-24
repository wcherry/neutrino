/**
 * "Customize toolbar…" answers a right-click (Ctrl-click on a Mac) anywhere on the toolbar, not
 * only on a tool: the gaps and the empty end of the bar belong to the toolbar element, since the
 * tool items are `display: contents`.
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
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
