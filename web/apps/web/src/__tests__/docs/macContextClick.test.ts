/**
 * A Mac Ctrl-click is a right-click that arrives as a left-button mousedown; the Docs editor
 * leaves it to the browser so the selection the context menu acts on survives.
 */

import { describe, it, expect } from 'vitest';
import { isMacContextClick } from '@/app/(apps)/docs/editor/macContextClick';

describe('isMacContextClick', () => {
  it('is a left-button mousedown with Ctrl held, on a Mac', () => {
    expect(isMacContextClick({ ctrlKey: true, button: 0 }, 'mac')).toBe(true);
  });

  it('is not a plain click, or Cmd-click, on a Mac', () => {
    expect(isMacContextClick({ ctrlKey: false, button: 0 }, 'mac')).toBe(false);
  });

  it('is not a real right-click, which ProseMirror already leaves alone', () => {
    expect(isMacContextClick({ ctrlKey: true, button: 2 }, 'mac')).toBe(false);
  });

  it('is not Ctrl-click elsewhere, where it is an ordinary click', () => {
    expect(isMacContextClick({ ctrlKey: true, button: 0 }, 'other')).toBe(false);
  });
});
