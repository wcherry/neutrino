import { describe, it, expect } from 'vitest';
import { pinHref, readCommands, readLibrary, readPins, templateApp } from '@/lib/teamResources';

describe('team pins (T5)', () => {
  it('keeps well-formed pins and drops the rest', () => {
    const pins = readPins({
      items: [
        { id: 'a', kind: 'folder', name: 'Runbooks', target: 'folder_1' },
        { id: 'b', kind: 'link', name: 'Status page', target: 'https://status.example.com' },
        { id: 'c', kind: 'link', name: 'Sneaky', target: 'javascript:alert(1)' },
        { id: 'd', kind: 'file', name: 'Bad id', target: '../../etc' },
        { id: 'e', kind: 'shelf', name: 'Unknown kind', target: 'x' },
        { kind: 'file', name: 'No id', target: 'f1' },
      ],
    });
    expect(pins.map((p) => p.id)).toEqual(['a', 'b']);
    expect(readPins(null)).toEqual([]);
    expect(readPins({ items: 'nope' })).toEqual([]);
  });

  it('leads a folder into the team’s Files and a file into its app', () => {
    expect(pinHref('t1', { id: 'a', kind: 'folder', name: 'Runbooks', target: 'f1' }))
      .toBe('/teams/space?id=t1&view=files&folder=f1&folderName=Runbooks');
    expect(pinHref('t1', { id: 'b', kind: 'file', name: 'Plan', target: 'file_9' })).toBe('/open/file/file_9');
    expect(pinHref('t1', { id: 'c', kind: 'link', name: 'Site', target: 'https://x.test' })).toBe('https://x.test');
  });
});

describe('team palette shortcuts (T6)', () => {
  it('needs a title and a template id', () => {
    expect(readCommands({ items: [
      { id: 'a', title: 'New incident report', templateId: 'tpl_1' },
      { id: 'b', title: '', templateId: 'tpl_2' },
      { id: 'c', title: 'Bad', templateId: 'a/b' },
    ] }).map((c) => c.id)).toEqual(['a']);
  });
});

describe('team templates (T3)', () => {
  it('knows a template by its extension', () => {
    expect(templateApp({ name: 'Report.dotx' })).toBe('docs');
    expect(templateApp({ name: 'Budget.XLTX' })).toBe('sheets');
    expect(templateApp({ name: 'Deck.potx' })).toBe('slides');
    expect(templateApp({ name: 'Report.docx' })).toBeNull();
  });
});

describe('team library (T4)', () => {
  it('reads only version 1, and only strings as presets', () => {
    expect(readLibrary({ version: 2 })).toBeNull();
    const lib = readLibrary({ version: 1, publishedAt: '2026-10-22', fills: { slides: ['linear-gradient(red, blue)', 3] }, cfTemplates: [{ id: 'x' }] });
    expect(lib?.fills.slides).toEqual(['linear-gradient(red, blue)']);
    expect(lib?.fills.drawing).toEqual([]);
    expect(lib?.cfTemplates).toHaveLength(1);
  });
});
