/**
 * A document's Tiptap JSON as read-only HTML, for previews that should not load the editor.
 *
 * Used by Drive's document preview and by the folder-link preview on `/share` (#321). The input is
 * a document — often a `.docx` read by `readDocx` — and a document is content from whoever wrote
 * it: on `/share` that can be a stranger with an editor link, and the HTML lands in another
 * person's page through `dangerouslySetInnerHTML`. So nothing from the document reaches the markup
 * unchecked:
 *
 * - text and attribute values are escaped;
 * - a link keeps its href only for `http(s):`, `mailto:` and in-page `#` targets — `javascript:`
 *   and every other scheme becomes a dead `#`;
 * - an image keeps its src only for `data:image/…`, `blob:` and `https:` — never `javascript:`;
 * - style values (colour, font, alignment) pass only if they match a narrow shape, so a value
 *   cannot close its attribute and add a handler;
 * - a heading level is clamped to 1–6.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Tiptap JSON is untyped document data. */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** A link target that cannot run script: http(s), mailto, or an in-page anchor. */
export function safeHref(href: unknown): string {
  if (typeof href !== 'string') return '#';
  const h = href.trim();
  if (h.startsWith('#')) return h;
  return /^(https?:|mailto:)/i.test(h) ? h : '#';
}

/** An image source that loads a picture and nothing else. */
export function safeImageSrc(src: unknown): string {
  if (typeof src !== 'string') return '';
  const s = src.trim();
  return /^(data:image\/[a-z0-9.+-]+[;,]|blob:|https:)/i.test(s) ? s : '';
}

/** `#abc`, `#aabbcc`, `rgb(…)`/`rgba(…)` or a bare colour name. */
function safeColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = v.trim();
  return /^(#[0-9a-f]{3,8}|rgba?\([0-9.,\s%]+\)|[a-z]{3,30})$/i.test(c) ? c : null;
}

/** Font names: letters, digits, spaces, hyphens, commas and plain quotes-free lists. */
function safeFontFamily(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const f = v.trim();
  return /^[a-z0-9 ,\-_]{1,80}$/i.test(f) ? f : null;
}

const ALIGNMENTS = new Set(['left', 'right', 'center', 'justify', 'start', 'end']);

function tiptapMarksToHtml(text: string, marks: any[] | undefined): string {
  let result = escapeHtml(text);
  if (!marks || marks.length === 0) return result;
  for (const mark of marks) {
    switch (mark?.type) {
      case 'bold':
        result = `<strong>${result}</strong>`;
        break;
      case 'italic':
        result = `<em>${result}</em>`;
        break;
      case 'underline':
        result = `<u>${result}</u>`;
        break;
      case 'strike':
        result = `<s>${result}</s>`;
        break;
      case 'code':
        result = `<code>${result}</code>`;
        break;
      case 'link':
        result = `<a href="${escapeHtml(safeHref(mark.attrs?.href))}" target="_blank" rel="noopener noreferrer">${result}</a>`;
        break;
      case 'highlight':
        result = `<mark>${result}</mark>`;
        break;
      case 'textStyle': {
        const parts: string[] = [];
        const color = safeColor(mark.attrs?.color);
        const font = safeFontFamily(mark.attrs?.fontFamily);
        if (color) parts.push(`color:${color}`);
        if (font) parts.push(`font-family:${font}`);
        if (parts.length > 0) result = `<span style="${escapeHtml(parts.join(';'))}">${result}</span>`;
        break;
      }
    }
  }
  return result;
}

function children(node: any): string {
  return (Array.isArray(node?.content) ? node.content : []).map(tiptapNodeToHtml).join('');
}

function tiptapNodeToHtml(node: any): string {
  if (!node || typeof node !== 'object') return '';

  switch (node.type) {
    case 'doc':
      return children(node);

    case 'paragraph': {
      const align = node.attrs?.textAlign;
      const style = ALIGNMENTS.has(align) ? ` style="text-align:${align}"` : '';
      return `<p${style}>${children(node) || '&#8203;'}</p>`;
    }

    case 'text':
      return tiptapMarksToHtml(typeof node.text === 'string' ? node.text : '', node.marks);

    case 'hardBreak':
      return '<br>';

    case 'heading': {
      const n = Number(node.attrs?.level);
      const level = Number.isInteger(n) && n >= 1 && n <= 6 ? n : 2;
      return `<h${level}>${children(node)}</h${level}>`;
    }

    case 'bulletList':
      return `<ul>${children(node)}</ul>`;

    case 'orderedList':
      return `<ol>${children(node)}</ol>`;

    case 'listItem':
      return `<li>${children(node)}</li>`;

    case 'codeBlock': {
      const inner = escapeHtml(
        (Array.isArray(node.content) ? node.content : [])
          .map((n: any) => (typeof n?.text === 'string' ? n.text : ''))
          .join(''),
      );
      return `<pre><code>${inner}</code></pre>`;
    }

    case 'blockquote':
      return `<blockquote>${children(node)}</blockquote>`;

    case 'horizontalRule':
      return '<hr>';

    case 'image': {
      const src = safeImageSrc(node.attrs?.src);
      if (!src) return '';
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`;
    }

    case 'table':
      return `<table>${children(node)}</table>`;

    case 'tableRow':
      return `<tr>${children(node)}</tr>`;

    case 'tableCell':
      return `<td>${children(node)}</td>`;

    case 'tableHeader':
      return `<th>${children(node)}</th>`;

    default:
      // Unknown node: render its children, never the node itself.
      return children(node);
  }
}

export function tiptapJsonToHtml(json: unknown): string {
  return tiptapNodeToHtml(json);
}
