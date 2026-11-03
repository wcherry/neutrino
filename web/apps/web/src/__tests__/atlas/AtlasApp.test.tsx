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

describe('the editor', () => {
  async function page(content = '') {
    const b = await openVault();
    fireEvent.click(screen.getAllByRole('button', { name: 'New page' })[0]);
    await screen.findByLabelText('Title');
    const view = editor();
    if (content) act(() => view.dispatch({ changes: { from: 0, insert: content }, selection: { anchor: content.length } }));
    act(() => view.focus());
    return { view, b };
  }
  const key = (view: EditorView, k: string, mods: Partial<KeyboardEventInit> = {}) =>
    act(() => {
      fireEvent.keyDown(view.contentDOM, { key: k, ...mods });
    });

  it('continues a list on Return, and wraps with ⌘B', async () => {
    const { view } = await page('- one');
    key(view, 'Enter');
    expect(view.state.doc.toString()).toBe('- one\n- ');
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: 'two' }, selection: { anchor: view.state.doc.length + 3 } }));
    act(() => view.dispatch({ selection: { anchor: 8, head: 11 } }));
    // jsdom isn't a Mac: CodeMirror's Mod is Ctrl there.
    key(view, 'b', { ctrlKey: true });
    expect(view.state.doc.toString()).toBe('- one\n- **two**');
  });

  it('suggests pages after [[ and completes the link', async () => {
    const { view } = await page();
    // A second page to link to.
    fireEvent.click(screen.getAllByRole('button', { name: 'New page' })[0]);
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Untitled 2'));
    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Groceries' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    fireEvent.blur(title);
    await within(screen.getByRole('navigation', { name: 'Pages' })).findByText('Groceries');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Pages' })).getByText('Untitled'));
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Untitled'));

    const v = editor();
    act(() => v.focus());
    act(() => v.dispatch({ changes: { from: 0, insert: 'Buy [[gro' }, selection: { anchor: 9 } }));
    const list = await screen.findByRole('listbox', { name: 'Pages' });
    expect(within(list).getByRole('option', { name: 'Groceries' })).toHaveAttribute('aria-selected', 'true');
    key(v, 'Enter');
    expect(v.state.doc.toString()).toBe('Buy [[Groceries]]');
    expect(screen.queryByRole('listbox')).toBeNull();
    void view;
  });

  it('runs a / command, and Escape closes the menu', async () => {
    const { view } = await page('Plans /h2');
    const list = await screen.findByRole('listbox', { name: 'Commands' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Heading 2']);
    key(view, 'Enter');
    expect(view.state.doc.toString()).toBe('## Plans');

    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '\n/' }, selection: { anchor: view.state.doc.length + 2 } }));
    await screen.findByRole('listbox', { name: 'Commands' });
    key(view, 'Escape');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows an image in place, and a Neutrino link as a chip', async () => {
    const { view } = await page();
    const doc = `${window.location.origin}/open/doc/doc1`;
    act(() => view.dispatch({ changes: { from: 0, insert: `Intro\n\n![[nothing.png]]\n\nSee [Q4 plan](${doc}) here.\n` }, selection: { anchor: 0 } }));
    // No such image: its Markdown stays.
    expect(view.contentDOM.querySelector('img[data-end]')).toBeNull();
    expect(view.contentDOM.textContent, 'its brackets hidden, as for any embed').toContain('nothing.png');
    // The link, away from the cursor, is a chip with its app's icon.
    const chip = view.contentDOM.querySelector('[class*="_chip_"]');
    expect(chip?.textContent).toContain('Q4 plan');
    expect(view.contentDOM.querySelector('[class*="chip-doc"]')).not.toBeNull();
  });

  it('pastes a copied link with its title, and a pasted image as an embed', async () => {
    const { view } = await page('See ');
    const paste = (data: { plain?: string; html?: string; files?: File[] }) => {
      const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
      event.clipboardData = {
        getData: (type: string) => (type === 'text/plain' ? data.plain ?? '' : type === 'text/html' ? data.html ?? '' : ''),
        files: data.files ?? [],
      };
      act(() => {
        view.contentDOM.dispatchEvent(event);
      });
    };
    const url = 'https://www.getneutrino.app/open/note/n1';
    paste({ plain: url, html: `<a href="${url}">Q4 plan</a>` });
    expect(view.state.doc.toString()).toBe(`See [Q4 plan](${url})`);

    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'image.png', { type: 'image/png' });
    paste({ files: [png] });
    await waitFor(() => expect(view.state.doc.toString()).toMatch(/\n\n!\[\[Pasted image \d{14}\.png\]\]$/));
    // Away from the cursor, it shows as the image, from the vault's copy.
    act(() => view.dispatch({ selection: { anchor: 0 } }));
    await waitFor(() => expect(view.contentDOM.querySelector('img[data-end]')?.getAttribute('src')).toMatch(/^blob:/));
  });

  it('inserts an image from Drive and links to a file, from the Insert menu', async () => {
    const { view } = await page();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Link to a Neutrino file…' }));
    const picker = await screen.findByRole('dialog');
    fireEvent.click(await within(picker).findByLabelText('Q4 plan.docx'));
    fireEvent.click(within(picker).getByRole('button', { name: 'Insert links' }));
    await waitFor(() => expect(view.state.doc.toString()).toBe(`[Q4 plan](${window.location.origin}/open/doc/doc1)`));

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Image from Neutrino Drive…' }));
    const images = await screen.findByRole('dialog');
    fireEvent.click(await within(images).findByRole('button', { name: 'Pictures' }));
    fireEvent.click(await within(images).findByLabelText('Beach.png'));
    fireEvent.click(within(images).getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(view.state.doc.toString()).toMatch(/\n\n!\[\[Beach\.png\]\]$/));
  });
});
