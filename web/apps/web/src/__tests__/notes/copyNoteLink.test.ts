/**
 * "Copy link" on a note copies its `/open/note/<id>` link: the URL as plain text, plus an HTML
 * anchor with the title, so Neutrino Atlas (or any Markdown editor that reads HTML) can paste
 * `[Title](url)`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyNoteLink } from '../../app/(apps)/notes/copyNoteLink';
import { appLinkUrl } from '../../app/(apps)/open/appLink';

class FakeClipboardItem {
  constructor(public readonly items: Record<string, Blob>) {}
}

function stubClipboard(write?: (items: FakeClipboardItem[]) => Promise<void>) {
  const writeText = vi.fn(async (_: string) => {});
  const writeSpy = write ? vi.fn(write) : undefined;
  vi.stubGlobal('navigator', { clipboard: { writeText, write: writeSpy } });
  return { writeText, write: writeSpy };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('appLinkUrl', () => {
  it('is the Universal Link on production, and this deployment elsewhere', () => {
    expect(appLinkUrl('note', 'abc', 'https://www.getneutrino.app')).toBe('https://www.getneutrino.app/open/note/abc');
    expect(appLinkUrl('note', 'abc', 'http://localhost:3000/')).toBe('http://localhost:3000/open/note/abc');
    expect(appLinkUrl('note', 'a/b c', 'https://x.y')).toBe('https://x.y/open/note/a%2Fb%20c');
  });
});

describe('copyNoteLink', () => {
  it('copies the URL as text and an anchor with the title as HTML', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const { write, writeText } = stubClipboard(async () => {});
    const url = await copyNoteLink('n1', 'Q4 <plan> & "goals"', 'https://www.getneutrino.app');
    expect(url).toBe('https://www.getneutrino.app/open/note/n1');
    expect(writeText).not.toHaveBeenCalled();
    const item = write!.mock.calls[0][0][0] as FakeClipboardItem;
    expect(await item.items['text/plain'].text()).toBe(url);
    expect(await item.items['text/html'].text()).toBe(
      '<a href="https://www.getneutrino.app/open/note/n1">Q4 &lt;plan&gt; &amp; &quot;goals&quot;</a>',
    );
  });

  it('names an untitled note', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const { write } = stubClipboard(async () => {});
    await copyNoteLink('n1', '  ', 'https://x.y');
    const item = write!.mock.calls[0][0][0] as FakeClipboardItem;
    expect(await item.items['text/html'].text()).toBe('<a href="https://x.y/open/note/n1">Untitled note</a>');
  });

  it('falls back to the URL alone when HTML can’t be written', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const { writeText } = stubClipboard(async () => { throw new Error('denied'); });
    await copyNoteLink('n1', 'Plan', 'https://x.y');
    expect(writeText).toHaveBeenCalledWith('https://x.y/open/note/n1');
  });

  it('writes the URL alone without ClipboardItem', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    const { writeText } = stubClipboard();
    await copyNoteLink('n1', 'Plan', 'https://x.y');
    expect(writeText).toHaveBeenCalledWith('https://x.y/open/note/n1');
  });
});
