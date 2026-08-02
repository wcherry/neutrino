/**
 * Tests for the Keep HTML → note-markdown conversion (`lib/takeout/inlineHtml.ts`).
 */

import { describe, it, expect } from 'vitest';
import { htmlToMarkdown, keepTextToMarkdown, stripInlineMarkdown } from '@/lib/takeout/inlineHtml';

/** The <span style> shape Keep actually emits, minus the fields we ignore. */
function keepSpan(text: string, style = ''): string {
  return `<p dir="ltr" style="line-height:1.38;margin-top:0.0pt;"><span style="font-size:7.2pt;font-family:'Google Sans';color:#000000;${style}">${text}</span></p>`;
}

describe('htmlToMarkdown', () => {
  it('returns the plain text of unstyled Keep markup', () => {
    expect(htmlToMarkdown(keepSpan('Passion for quality'))).toBe('Passion for quality');
  });

  it('ignores font-weight:400 and font-style:normal', () => {
    const html = keepSpan('Egoless', 'font-weight:400;font-style:normal;text-decoration:none;');
    expect(htmlToMarkdown(html)).toBe('Egoless');
  });

  it('converts styled spans to inline markdown', () => {
    expect(htmlToMarkdown(keepSpan('bold', 'font-weight:700;'))).toBe('**bold**');
    expect(htmlToMarkdown(keepSpan('em', 'font-style:italic;'))).toBe('*em*');
    expect(htmlToMarkdown(keepSpan('gone', 'text-decoration:line-through;'))).toBe('~~gone~~');
  });

  it('converts semantic tags too', () => {
    expect(htmlToMarkdown('<p><b>a</b> <i>b</i> <s>c</s> <code>d</code></p>')).toBe('**a** *b* ~~c~~ `d`');
  });

  it('keeps surrounding whitespace outside the markers', () => {
    // `** bold **` does not match the editor's INLINE_PATTERN.
    expect(htmlToMarkdown('<p>x<b> bold </b>y</p>')).toBe('x **bold** y');
  });

  it('does not emit markers for an empty element', () => {
    expect(htmlToMarkdown('<p>a<b></b>b</p>')).toBe('ab');
  });

  it('turns <br> and block elements into line breaks', () => {
    expect(htmlToMarkdown('<p>one<br>two</p><p>three</p>')).toBe('one\ntwo\nthree');
  });

  it('collapses more than one blank line', () => {
    expect(htmlToMarkdown('<div>a</div><div></div><div></div><div></div><div>b</div>')).toBe('a\n\nb');
  });

  it('renders a list as bullet lines', () => {
    expect(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two');
  });

  it('writes a link as text plus its URL', () => {
    expect(htmlToMarkdown('<p><a href="https://example.com">Example</a></p>')).toBe(
      'Example (https://example.com)',
    );
  });

  it('writes a bare link once', () => {
    expect(htmlToMarkdown('<p><a href="https://example.com">https://example.com</a></p>')).toBe(
      'https://example.com',
    );
  });

  it('returns an empty string for markup with no text', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('<p></p>')).toBe('');
  });

  it('drops script and style content', () => {
    expect(htmlToMarkdown('<p>safe<script>alert(1)</script></p>')).toBe('safe');
  });
});

describe('stripInlineMarkdown', () => {
  it('removes every marker the converter can emit', () => {
    expect(stripInlineMarkdown('**a** *b* ~~c~~ `d`')).toBe('a b c d');
  });
});

describe('keepTextToMarkdown', () => {
  it('prefers the HTML when it round-trips to the plain text', () => {
    const html = keepSpan('Sense of urgency', 'font-weight:700;');
    expect(keepTextToMarkdown('Sense of urgency', html)).toBe('**Sense of urgency**');
  });

  it('falls back to the plain text when the HTML says something else', () => {
    // Markup we cannot faithfully represent must not silently lose words.
    const html = '<p>Sense of <img src="x"> urgency and more</p>';
    expect(keepTextToMarkdown('Sense of urgency', html)).toBe('Sense of urgency');
  });

  it('uses the plain text when there is no HTML', () => {
    expect(keepTextToMarkdown('Adaptable', undefined)).toBe('Adaptable');
    expect(keepTextToMarkdown('Adaptable', '')).toBe('Adaptable');
  });

  it('uses the HTML when there is no plain text to check against', () => {
    expect(keepTextToMarkdown(undefined, keepSpan('Only HTML'))).toBe('Only HTML');
  });

  it('tolerates trailing whitespace differences between the two fields', () => {
    expect(keepTextToMarkdown('Comfortable with ambiguity ', keepSpan('Comfortable with ambiguity '))).toBe(
      'Comfortable with ambiguity',
    );
  });
});
