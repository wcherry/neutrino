/**
 * The read-only document renderer used by Drive's preview and the folder-link preview. A document
 * can come from anyone with an editor link, so what matters most here is what it refuses to emit.
 */

import { describe, it, expect } from 'vitest';
import { tiptapJsonToHtml } from '@/lib/tiptapHtml';

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, marks });

describe('tiptapJsonToHtml', () => {
  it('renders ordinary structure', () => {
    const html = tiptapJsonToHtml(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [text('Title')] },
        p(text('bold', [{ type: 'bold' }]), text(' and '), text('link', [{ type: 'link', attrs: { href: 'https://example.com' } }])),
      ),
    );
    expect(html).toBe(
      '<h1>Title</h1><p><strong>bold</strong> and <a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a></p>',
    );
  });

  it('escapes text', () => {
    expect(tiptapJsonToHtml(doc(p(text('<script>alert(1)</script>'))))).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  it('turns a javascript: link into a dead one', () => {
    const html = tiptapJsonToHtml(doc(p(text('x', [{ type: 'link', attrs: { href: ' JavaScript:alert(1)' } }]))));
    expect(html).toContain('href="#"');
    expect(html.toLowerCase()).not.toContain('javascript');
  });

  it('drops a style value that would break out of its attribute', () => {
    const html = tiptapJsonToHtml(
      doc(p(text('x', [{ type: 'textStyle', attrs: { color: 'red" onmouseover="alert(1)', fontFamily: 'a;}</style>' } }]))),
    );
    expect(html).toBe('<p>x</p>');
  });

  it('keeps a plain colour and font', () => {
    const html = tiptapJsonToHtml(
      doc(p(text('x', [{ type: 'textStyle', attrs: { color: '#ff0000', fontFamily: 'Georgia, serif' } }]))),
    );
    expect(html).toBe('<p><span style="color:#ff0000;font-family:Georgia, serif">x</span></p>');
  });

  it('clamps a heading level and ignores an unknown alignment', () => {
    expect(tiptapJsonToHtml(doc({ type: 'heading', attrs: { level: '1 onclick=x' }, content: [text('h')] }))).toBe('<h2>h</h2>');
    expect(tiptapJsonToHtml(doc({ type: 'paragraph', attrs: { textAlign: 'left" onclick="x' }, content: [text('t')] }))).toBe('<p>t</p>');
  });

  it('keeps data, blob and https images and drops the rest', () => {
    const img = (src: string) => tiptapJsonToHtml(doc({ type: 'image', attrs: { src } }));
    expect(img('data:image/png;base64,AAAA')).toContain('src="data:image/png;base64,AAAA"');
    expect(img('https://example.com/a.png')).toContain('src="https://example.com/a.png"');
    expect(img('javascript:alert(1)')).toBe('');
    expect(img('data:text/html,<script>')).toBe('');
  });
});
