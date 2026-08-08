/**
 * Extract all `[[title]]` wiki-link targets from raw text content.
 * Mirrors the backend's `parse_wiki_links` (src/notes/service.rs), which
 * this package supersedes as the source of truth for link extraction now
 * that note content is E2EE-encrypted before it reaches the server.
 */
export function extractWikiLinks(content: string): string[] {
  const titles: string[] = [];
  const pattern = /\[\[([^\]]*)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const title = match[1].trim();
    if (title) titles.push(title);
  }
  return titles;
}
