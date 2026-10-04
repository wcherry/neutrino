/**
 * Turning a text file into highlighted HTML for a preview.
 *
 * Shared by `PreviewModal` (a text file in Drive) and `ZipViewer` (a text file
 * inside a zip in Drive), so a `.ts` reads the same in both.
 */

export function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    mjs: 'javascript', cjs: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c', cpp: 'cpp',
    hpp: 'cpp', cc: 'cpp', cs: 'csharp', rb: 'ruby', sh: 'bash', bash: 'bash',
    zsh: 'bash', kt: 'kotlin', swift: 'swift', php: 'php',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml', plist: 'xml',
    html: 'html', htm: 'html', css: 'css', scss: 'css', sql: 'sql', md: 'markdown',
  };
  return map[ext] ?? 'plaintext';
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Highlighted HTML for `content`, safe to set as `innerHTML`: highlight.js
 * escapes what it emits, and plain text is escaped here. highlight.js is
 * loaded only when a file actually needs it.
 */
export async function highlightText(content: string, filename: string): Promise<{ html: string; language: string }> {
  const language = detectLanguage(filename);
  if (language === 'plaintext') return { html: escapeHtml(content), language };
  const hljs = (await import('highlight.js')).default;
  const html = hljs.getLanguage(language)
    ? hljs.highlight(content, { language }).value
    : escapeHtml(content);
  return { html, language };
}
