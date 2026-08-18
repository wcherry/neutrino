/**
 * Tests for the field-code model — what a token parses to, and what a code
 * plus a context resolves to.
 *
 * The part worth pinning hardest is the fallback. `{{author:My Self}}` has to
 * render the author when there is one and `My Self` when there is not, and the
 * difference between those two has to stay visible to the caller: a field
 * showing a fallback is a field waiting to be filled in, and one showing
 * neither is a mistake the writer has to be able to see.
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalFieldCode,
  docFieldText,
  emptyDocProperties,
  fieldDef,
  formatFieldToken,
  hasDocProperties,
  normalizeDocProperties,
  parseFieldToken,
  resolveDocField,
  type DocFieldContext,
  type DocProperties,
} from '@/lib/docFields';

function ctx(over: Partial<DocFieldContext> = {}): DocFieldContext {
  return {
    title: 'Quarterly Report',
    page: 3,
    pages: 12,
    properties: emptyDocProperties(),
    date: new Date(2026, 7, 18, 14, 5),
    ...over,
  };
}

function props(over: Partial<DocProperties> = {}): DocProperties {
  return { ...emptyDocProperties(), ...over };
}

describe('parseFieldToken', () => {
  it('reads a bare code', () => {
    expect(parseFieldToken('{{title}}')).toEqual({ code: 'title', arg: null });
  });

  it('reads a code with a fallback', () => {
    expect(parseFieldToken('{{author:My Self}}')).toEqual({ code: 'author', arg: 'My Self' });
  });

  it('tolerates whitespace inside the braces', () => {
    expect(parseFieldToken('{{  author : My Self  }}')).toEqual({ code: 'author', arg: 'My Self' });
  });

  it('treats an empty fallback as no fallback', () => {
    expect(parseFieldToken('{{author:}}')).toEqual({ code: 'author', arg: null });
  });

  it('rejects anything that is not exactly one token', () => {
    expect(parseFieldToken('see {{title}} above')).toBeNull();
    expect(parseFieldToken('{{}}')).toBeNull();
    expect(parseFieldToken('{{1page}}')).toBeNull();
    expect(parseFieldToken('{title}')).toBeNull();
  });

  it('round-trips through formatFieldToken', () => {
    for (const text of ['{{title}}', '{{author:My Self}}', '{{page}}']) {
      expect(formatFieldToken(parseFieldToken(text)!)).toBe(text);
    }
  });
});

describe('canonicalFieldCode', () => {
  it('folds the spellings of the page-number code onto one', () => {
    for (const spelling of ['page', 'page-number', 'PAGE-NUMBER', 'pagenumber', 'page_number']) {
      expect(canonicalFieldCode(spelling)).toBe('page');
    }
  });

  it('folds the spellings of the page-count code onto one', () => {
    for (const spelling of ['pages', 'page-count', 'total-pages', 'num-pages']) {
      expect(canonicalFieldCode(spelling)).toBe('pages');
    }
  });

  it('leaves an unknown code alone, lower-cased, so it can be a custom property', () => {
    expect(canonicalFieldCode('Client')).toBe('client');
    expect(fieldDef('client')).toBeUndefined();
  });

  it('is applied by the parser, so a typed alias is stored canonically', () => {
    expect(parseFieldToken('{{page-number}}')).toEqual({ code: 'page', arg: null });
  });
});

describe('resolveDocField', () => {
  it('resolves the built-in codes', () => {
    expect(resolveDocField({ code: 'title', arg: null }, ctx()).text).toBe('Quarterly Report');
    expect(resolveDocField({ code: 'page', arg: null }, ctx()).text).toBe('3');
    expect(resolveDocField({ code: 'pages', arg: null }, ctx()).text).toBe('12');
  });

  it('resolves a property', () => {
    const resolved = resolveDocField(
      { code: 'author', arg: 'My Self' },
      ctx({ properties: props({ author: 'Ada Lovelace' }) }),
    );
    expect(resolved).toEqual({ text: 'Ada Lovelace', state: 'value' });
  });

  it('falls back when the property is empty', () => {
    const resolved = resolveDocField({ code: 'author', arg: 'My Self' }, ctx());
    expect(resolved).toEqual({ text: 'My Self', state: 'fallback' });
  });

  it('falls back when the property is nothing but whitespace', () => {
    const resolved = resolveDocField(
      { code: 'author', arg: 'My Self' },
      ctx({ properties: props({ author: '   ' }) }),
    );
    expect(resolved.state).toBe('fallback');
  });

  it('falls back on an untitled document', () => {
    expect(resolveDocField({ code: 'title', arg: 'Untitled' }, ctx({ title: '' })).text)
      .toBe('Untitled');
  });

  it('shows its own code when there is no value and no fallback', () => {
    expect(resolveDocField({ code: 'author', arg: null }, ctx())).toEqual({
      text: '{{author}}',
      state: 'unresolved',
    });
  });

  it('reads a custom property nobody built in', () => {
    const resolved = resolveDocField(
      { code: 'client', arg: 'ACME' },
      ctx({ properties: props({ custom: { client: 'Initech' } }) }),
    );
    expect(resolved).toEqual({ text: 'Initech', state: 'value' });
  });

  it('never renders a page number below 1, whatever it is handed', () => {
    expect(resolveDocField({ code: 'page', arg: null }, ctx({ page: 0 })).text).toBe('1');
  });

  it('uses the injected date rather than the wall clock', () => {
    const date = new Date(2026, 7, 18, 14, 5);
    expect(resolveDocField({ code: 'date', arg: null }, ctx({ date })).text)
      .toBe(date.toLocaleDateString());
  });
});

describe('docFieldText — what leaves the editor', () => {
  it('is the value', () => {
    expect(docFieldText({ code: 'title', arg: null }, ctx(), false)).toBe('Quarterly Report');
  });

  it('is the code when the field is showing its code', () => {
    expect(docFieldText({ code: 'title', arg: null }, ctx(), true)).toBe('{{title}}');
  });

  it('is the fallback when there is no value', () => {
    expect(docFieldText({ code: 'author', arg: 'My Self' }, ctx(), false)).toBe('My Self');
  });

  it('is empty for an unresolved field, not the braces it shows on screen', () => {
    // On screen an unresolved field displays its own code, which is what makes
    // it findable. Exported, that would read as literal braces someone forgot
    // to remove — so it contributes nothing instead.
    expect(docFieldText({ code: 'author', arg: null }, ctx(), false)).toBe('');
  });
});

describe('normalizeDocProperties', () => {
  it('defaults every field when the blob is missing', () => {
    expect(normalizeDocProperties(undefined)).toEqual(emptyDocProperties());
  });

  it('keeps strings and drops everything else', () => {
    const result = normalizeDocProperties({ author: 'Ada', subject: 42, company: null });
    expect(result.author).toBe('Ada');
    expect(result.subject).toBe('');
    expect(result.company).toBe('');
  });

  it('canonicalises custom property names', () => {
    expect(normalizeDocProperties({ custom: { Client: 'Initech' } }).custom).toEqual({
      client: 'Initech',
    });
  });

  it('drops a custom property that would be shadowed by a built-in code', () => {
    // `{{author}}` reads the built-in property, so a custom one by that name
    // could never be reached — keeping it would be dead weight in the file.
    const result = normalizeDocProperties({ custom: { author: 'ignored', 'page-number': 'x' } });
    expect(result.custom).toEqual({});
  });
});

describe('hasDocProperties', () => {
  it('is false for an untouched set', () => {
    expect(hasDocProperties(emptyDocProperties())).toBe(false);
  });

  it('is true once a built-in is filled in', () => {
    expect(hasDocProperties(props({ author: 'Ada' }))).toBe(true);
  });

  it('is true once a custom one is filled in', () => {
    expect(hasDocProperties(props({ custom: { client: 'Initech' } }))).toBe(true);
  });
});
