import { matchKey } from './tags';

/**
 * Resolves link targets to vault files, and picks the target to write for a new link (SPEC §7).
 * It runs only in the client, against decrypted vault paths. Paths are relative to the vault
 * root, use `/`, and include the extension.
 */
export class LinkResolver {
  /** Files grouped by the match key of their last segment: every candidate shares the target's. */
  private byName = new Map<string, { path: string; key: string; segments: number; isPage: boolean }[]>();

  constructor(files: Iterable<string>) {
    for (const path of files) {
      const isPage = isPageName(path);
      const key = matchKey(isPage ? path.slice(0, -3) : path);
      const name = lastSegment(key);
      if (!this.byName.has(name)) this.byName.set(name, []);
      this.byName.get(name)!.push({ path, key, segments: path.split('/').filter(Boolean).length, isPage });
    }
  }

  /** The file `target` names, or null when unresolved. Only an empty target depends on where the link is. */
  resolve(target: string, from: string): string | null {
    if (target === '') return from;
    let t = target.startsWith('./') ? target.slice(2) : target;
    const segs = t.split('/').filter(Boolean);
    const last = segs[segs.length - 1] ?? t;
    const wantsPage = !hasExtension(last) || isPageName(last);
    if (wantsPage && isPageName(t)) t = t.slice(0, -3);
    const key = matchKey(t);
    const hits = (this.byName.get(lastSegment(key)) ?? []).filter((e) => e.isPage === wantsPage && (e.key === key || e.key.endsWith('/' + key)));
    const exact = hits.find((e) => e.key === key);
    if (exact) return exact.path;
    let best: (typeof hits)[number] | null = null;
    for (const h of hits) {
      if (!best || h.segments < best.segments || (h.segments === best.segments && codePointLess(h.key, best.key))) best = h;
    }
    return best?.path ?? null;
  }

  /** The target to write for a link to `file`: the shortest suffix of its path that resolves back to it. */
  linkTarget(file: string): string {
    const name = isPageName(file) ? file.slice(0, -3) : file;
    const parts = name.split('/').filter(Boolean);
    for (let n = 1; n <= Math.max(parts.length, 1); n++) {
      const candidate = parts.slice(-n).join('/');
      if (this.resolve(candidate, '') === file) return candidate;
    }
    return name;
  }
}

const isPageName = (s: string) => s.toLowerCase().endsWith('.md');
const lastSegment = (key: string) => { const parts = key.split('/'); return parts[parts.length - 1]; };
function hasExtension(segment: string): boolean {
  const dot = segment.lastIndexOf('.');
  return dot > 0 && dot < segment.length - 1;
}
function codePointLess(a: string, b: string): boolean {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d !== 0) return d < 0;
  }
  return x.length < y.length;
}
