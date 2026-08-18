/**
 * Ranking for the `{{` autocomplete.
 *
 * The menu is what makes the codes discoverable at all, so the two properties
 * that matter are: typing nothing shows everything, and each character narrows
 * it in the order someone would expect — a code the query *starts* ahead of one
 * that merely contains it. Typing `p` has to put Page number and Page count
 * above Company, which has a p in the middle of it.
 */

import { describe, it, expect } from 'vitest';
import { FIELD_DEFS, fieldSuggestions } from '@/lib/docFields';

const codes = (query: string, custom: string[] = []) =>
  fieldSuggestions(query, custom).map(s => s.code);

describe('fieldSuggestions', () => {
  it('offers every built-in code for an empty query', () => {
    expect(codes('')).toEqual(FIELD_DEFS.map(d => d.code));
  });

  it('carries a label and a description for each row', () => {
    const [first] = fieldSuggestions('');
    expect(first.label).toBeTruthy();
    expect(first.hint).toBeTruthy();
  });

  it('puts prefix matches ahead of matches in the middle of a word', () => {
    const result = codes('p');
    expect(result.slice(0, 2)).toEqual(['page', 'pages']);
    // 'company' matches on the p at index 4, so it is offered but ranked last.
    expect(result).toContain('company');
    expect(result.indexOf('company')).toBeGreaterThan(result.indexOf('pages'));
  });

  it('drops what does not match at all', () => {
    expect(codes('p')).not.toContain('title');
    expect(codes('zzz')).toEqual([]);
  });

  it('narrows as more is typed', () => {
    expect(codes('pag')).toEqual(['page', 'pages']);
    expect(codes('pages')).toEqual(['pages']);
  });

  it('matches the label, not only the code', () => {
    // Nothing has "number" in its code; "Page number" has it in its label.
    expect(codes('number')).toEqual(['page']);
  });

  it('finds a field by an alias someone knows from another word processor', () => {
    expect(codes('page-n')).toEqual(['page']);
    expect(codes('total')).toEqual(['pages']);
  });

  it('is case-insensitive', () => {
    expect(codes('PAGE')).toEqual(codes('page'));
  });

  it('keeps a stable order between equally good matches', () => {
    // Both are prefix matches on their code, so declaration order decides —
    // otherwise the two rows would swap places as the list is rebuilt.
    expect(codes('page')).toEqual(['page', 'pages']);
  });

  it("offers the document's own custom properties, after the built-ins", () => {
    const result = codes('', ['client']);
    expect(result).toContain('client');
    expect(result.indexOf('client')).toBeGreaterThan(result.indexOf('manager'));
    expect(fieldSuggestions('', ['client']).find(s => s.code === 'client')?.custom).toBe(true);
  });

  it('ranks a custom property like any other', () => {
    expect(codes('cl', ['client'])).toEqual(['client']);
  });

  it('canonicalises custom property names and drops duplicates of a built-in', () => {
    expect(codes('', ['Client', 'client', 'author'])).toEqual([
      ...FIELD_DEFS.map(d => d.code),
      'client',
    ]);
  });
});
