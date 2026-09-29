import { describe, it, expect } from 'vitest';
import { allTags, splitTags, suggestTags } from '../../app/(apps)/calendar/tags';
import type { TaskResponse } from '../../lib/api';

const task = (tags: string[]) => ({ tags }) as TaskResponse;

describe('task tags', () => {
  it('splits on spaces and commas, lowercases and drops the #', () => {
    expect(splitTags('#Errands, home  ##work home')).toEqual(['errands', 'home', 'work']);
    expect(splitTags('  ')).toEqual([]);
  });

  it('lists the tags in use most used first, then alphabetically', () => {
    expect(allTags([task(['home', 'work']), task(['work']), task(['errands'])])).toEqual([
      'work',
      'errands',
      'home',
    ]);
  });

  it('suggests prefix matches before other matches and skips chosen ones', () => {
    const known = ['homework', 'work', 'errands', 'home'];
    expect(suggestTags('ho', known, [])).toEqual(['homework', 'home']);
    expect(suggestTags('#WO', known, [])).toEqual(['work', 'homework']);
    expect(suggestTags('', known, ['work'])).toEqual(['homework', 'errands', 'home']);
    expect(suggestTags('zzz', known, [])).toEqual([]);
  });
});
