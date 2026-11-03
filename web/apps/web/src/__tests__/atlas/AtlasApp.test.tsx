/**
 * `/atlas` in the DOM: choosing a vault, the sidebar, the page and its editor (CodeMirror over the
 * Markdown, Live Preview hiding syntax away from the cursor), backlinks and Quick Open.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { ToastProvider } from '@neutrino/ui';
import { AtlasApp } from '@/app/(apps)/atlas/AtlasApp';
import { MemoryDrive, browser } from './fakes';

// CodeMirror measures text; jsdom lays nothing out.
beforeEach(() => {
  const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects = rects;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  // getCurrentUserId reads the access token's `sub`.
  window.localStorage.setItem('access_token', `x.${btoa(JSON.stringify({ sub: 'u1' }))}.y`);
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function editor(): EditorView {
  const content = document.querySelector('.cm-content') as HTMLElement | null;
  if (!content) throw new Error('no editor');
  return EditorView.findFromDOM(content)!;
}

async function openVault() {
  const b = browser(new MemoryDrive());
  render(<ToastProvider><AtlasApp services={b.services} /></ToastProvider>);
  await screen.findByText('Choose a vault');
  fireEvent.click(within(screen.getByText('Atlas').closest('li')!).getByRole('button', { name: 'Open' }));
  await screen.findByText('No page open');
  return b;
}

describe('/atlas', () => {
  it('opens a vault, makes a page and edits it in place', async () => {
    await openVault();
    fireEvent.click(screen.getAllByRole('button', { name: 'New page' })[0]);
    expect(await screen.findByLabelText('Title')).toHaveValue('Untitled');
    const sidebar = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(sidebar).getByText('Untitled')).toBeInTheDocument();

    const view = editor();
    act(() => {
      view.dispatch({ changes: { from: 0, insert: '# Plan\n\nSome **bold** and [[Goals]].\n' }, selection: { anchor: 0 } });
    });
    // The cursor is in the heading: its `# ` shows; the strong's and the link's syntax don't.
    const text = () => document.querySelector('.cm-content')!.textContent;
    expect(text()).toContain('# Plan');
    expect(text()).toContain('Some bold and Goals.');
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
    expect(text()).not.toContain('# Plan');
    expect(text()).toContain('Plan');

    // Source mode shows every character.
    fireEvent.click(screen.getByRole('button', { name: 'Live Preview' }));
    expect(text()).toContain('Some **bold** and [[Goals]].');
  });

  it('renames from the title, and shows backlinks and mentions', async () => {
    await openVault();
    fireEvent.click(screen.getAllByRole('button', { name: 'New page' })[0]);
    const title = await screen.findByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Roadmap' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    fireEvent.blur(title);
    const sidebar = screen.getByRole('navigation', { name: 'Pages' });
    await within(sidebar).findByText('Roadmap');

    fireEvent.click(screen.getAllByRole('button', { name: 'New page' })[0]);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Untitled'));
    act(() => editor().dispatch({ changes: { from: 0, insert: 'See [[Roadmap]] and the roadmap.\n' } }));

    fireEvent.click(within(sidebar).getByText('Roadmap'));
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Roadmap'));
    const panel = screen.getByRole('complementary', { name: 'Backlinks' });
    await within(panel).findByRole('button', { name: 'Untitled' });
  });

  it('jumps to a page, or creates one, from Quick Open', async () => {
    await openVault();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const input = await screen.findByLabelText('Open or create a page');
    fireEvent.change(input, { target: { value: 'Weekly review' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Weekly review'));
  });

  it('searches the vault from the sidebar', async () => {
    await openVault();
    fireEvent.click(screen.getAllByRole('button', { name: 'New page' })[0]);
    await screen.findByLabelText('Title');
    act(() => editor().dispatch({ changes: { from: 0, insert: 'Quarterly numbers look good.\n' } }));
    await waitFor(() => expect(screen.getByText('Synced')).toBeInTheDocument(), { timeout: 5000 });
    fireEvent.change(screen.getByLabelText('Search the vault'), { target: { value: 'quarterly' } });
    const hit = await screen.findByText('Quarterly');
    expect(hit.tagName).toBe('MARK');
  });
});
