// AtlasKit's VaultIndexTests, ported. The snapshot tests are left out: neither app keeps the
// index at rest, both rebuild it when a vault opens.
import { describe, expect, it } from 'vitest';
import { MarkdownDocument } from '../document';
import { tokenize } from '../indexing/fts';
import { VaultIndex, compareCodePoints, parseSearchQuery } from '../indexing/vaultIndex';
import { LinkResolver } from '../resolve';

function index(pages: Record<string, string>, files: string[] = []): VaultIndex {
  const index = new VaultIndex();
  index.batch(() => {
    for (const file of files) index.addFile(file);
    for (const path of Object.keys(pages).sort()) index.upsertPage(path, pages[path]);
  });
  return index;
}

describe('links', () => {
  it('finds backlinks across link kinds', () => {
    const i = index(
      {
        'A.md': 'See [[B]], [[Projects/C|the C]], [b](B.md#Intro) and ![[img.png]]. Also [[Missing]].\n',
        'B.md': 'Back to [[A#Top]] and [[#Intro]].\n\n# Intro\n',
        'Projects/C.md': 'Nothing.\n',
      },
      ['img.png'],
    );
    expect(i.backlinks('B.md').map((l) => l.source)).toEqual(['A.md', 'A.md', 'B.md']);
    expect(i.backlinks('B.md').map((l) => l.kind)).toEqual(['wiki', 'markdown', 'wiki']);
    expect(i.backlinks('img.png')[0]?.kind).toBe('embed');
    expect(i.outgoingLinks('A.md').map((l) => l.resolved)).toEqual(['B.md', 'Projects/C.md', 'B.md', null, 'img.png']);
    expect(i.unresolvedTargets().map((t) => t.target)).toEqual(['Missing']);
    // Same-page links don't make a page need rewriting when it's renamed.
    expect(i.pagesLinking('B.md')).toEqual(['A.md']);
  });

  it('re-resolves links when a new page takes over a name', () => {
    const i = index({ 'Inbox.md': '[[Spec]]\n', 'Archive/Spec.md': 'old\n' });
    expect(i.backlinks('Archive/Spec.md')).toHaveLength(1);
    // A root-level Spec.md has fewer segments, so `[[Spec]]` now means it (SPEC §7).
    i.upsertPage('Spec.md', 'new\n');
    expect(i.backlinks('Archive/Spec.md')).toHaveLength(0);
    expect(i.backlinks('Spec.md').map((l) => l.source)).toEqual(['Inbox.md']);
    i.removePage('Spec.md');
    expect(i.backlinks('Archive/Spec.md').map((l) => l.source)).toEqual(['Inbox.md']);
    // Removing a page removes everything it contributed.
    i.removePage('Inbox.md');
    expect(i.backlinks('Archive/Spec.md')).toEqual([]);
    expect(i.outgoingLinks('Inbox.md')).toEqual([]);
    expect(i.unresolvedTargets()).toEqual([]);
  });

  /** The whole rename flow: find the linking pages, rewrite them (SPEC §7, §8.2), re-index. */
  it('renames a page end to end', () => {
    const sources: Record<string, string> = {
      'Roadmap.md': '# Roadmap\n\nSee [[#Roadmap]].\n',
      'Inbox.md': 'Plan in [[Roadmap|the roadmap]] and [here](Roadmap.md).\n',
      'Other.md': 'Nothing to do with it.\n',
    };
    const i = index(sources);
    const before = new LinkResolver(Object.keys(sources));
    const after = new LinkResolver(Object.keys(sources).map((p) => (p === 'Roadmap.md' ? 'Plans/Roadmap 2027.md' : p)));

    const toRewrite = i.pagesLinking('Roadmap.md');
    expect(toRewrite).toEqual(['Inbox.md']);
    i.renameFile('Roadmap.md', 'Plans/Roadmap 2027.md');
    sources['Plans/Roadmap 2027.md'] = sources['Roadmap.md'];
    delete sources['Roadmap.md'];
    for (const page of toRewrite) {
      const doc = new MarkdownDocument(sources[page]);
      expect(doc.rewriteLinksToRenamed('Roadmap.md', 'Plans/Roadmap 2027.md', page, before, after).inPlace).toBe(true);
      sources[page] = doc.serialized();
      i.upsertPage(page, doc.serialized());
    }
    expect(sources['Inbox.md']).toBe('Plan in [[Roadmap 2027|the roadmap]] and [here](<Roadmap 2027.md>).\n');
    expect(i.backlinks('Plans/Roadmap 2027.md').map((l) => l.source)).toEqual(['Inbox.md', 'Inbox.md', 'Plans/Roadmap 2027.md']);
    expect(i.unresolvedTargets()).toHaveLength(0);
    expect(i.quickSwitch('roadmap 2027')[0]?.path).toBe('Plans/Roadmap 2027.md');
  });

  it('shows each missing target once, spelled as its first link', () => {
    const i = index({ 'A.md': '[[Missing]] [[Zed]]\n', 'B.md': '[[MISSING]]\n', 'C.md': '[[missing]]\n' });
    expect(i.unresolvedTargets()).toEqual([{ target: 'Missing', count: 3 }, { target: 'Zed', count: 1 }]);
    // A page re-indexed gets later rowids, so another spelling comes first.
    i.upsertPage('A.md', '[[Missing]] [[Zed]]\n');
    expect(i.unresolvedTargets()[0]).toEqual({ target: 'MISSING', count: 3 });
  });
});

describe('tags and search', () => {
  it('nests tags, ignores case and includes frontmatter', () => {
    const i = index({
      'A.md': '---\ntags: [project/atlas]\n---\n\nText #idea\n',
      'B.md': '#Project/atlas and #project\n',
      'C.md': '#idea #idea\n',
    });
    // B writes `#Project/atlas` and `#project`: each group shows its (first) spelling.
    expect(i.tags().map((t) => t.tag)).toEqual(['idea', 'project', 'Project/atlas']);
    expect(i.tags().map((t) => t.count)).toEqual([2, 1, 2]);
    expect(i.search('#project').map((h) => h.path).sort()).toEqual(['A.md', 'B.md']);
    expect(i.search('tag:project/atlas').map((h) => h.path).sort()).toEqual(['A.md', 'B.md']);
  });

  it('supports the search syntax and ranks titles first', () => {
    const i = index({
      'Planning.md': 'Something else entirely.\n',
      'Notes/Café visit.md': 'We planned the trip to the café near the station.\n',
      'Notes/Station.md': 'The station plan was cancelled. #travel\n',
      'Recipes/Bread.md': 'Knead the dough. Plan ahead.\n',
    });
    // Prefix match; a title match ranks first.
    expect(i.search('plan')[0]?.path).toBe('Planning.md');
    // Diacritics and case are ignored.
    expect(i.search('CAFE').map((h) => h.path)).toEqual(['Notes/Café visit.md']);
    // Phrases, exclusion, folders and tags.
    expect(i.search('"station plan"').map((h) => h.path)).toEqual(['Notes/Station.md']);
    expect(i.search('plan -dough').map((h) => h.path)).not.toContain('Recipes/Bread.md');
    expect(i.search('plan path:Recipes').map((h) => h.path)).toEqual(['Recipes/Bread.md']);
    expect(i.search('plan path:recipes').map((h) => h.path), 'LIKE ignores ASCII case').toEqual(['Recipes/Bread.md']);
    expect(i.search('plan #travel').map((h) => h.path)).toEqual(['Notes/Station.md']);
    // FTS5 syntax in the query is just text.
    expect(() => i.search('"unbalanced OR NEAR( * ^')).not.toThrow();
    // Only exclusions, or only punctuation: nothing.
    expect(i.search('-plan')).toEqual([]);
    expect(i.search('!!!')).toEqual([]);
    expect(i.search('plan -!!!').length).toBe(4);
    // Snippets mark the matched words.
    const hit = i.search('cancelled')[0];
    expect(hit.snippet.matches.map((m) => hit.snippet.text.slice(m.start, m.end))).toEqual(['cancelled']);
    expect(hit.snippet.text).toBe('The station plan was cancelled. #travel');
  });

  it('cuts snippets as FTS5 does', () => {
    const words = Array.from({ length: 40 }, (_, n) => `w${n}`);
    words[20] = 'needle';
    const i = index({ 'Long.md': words.join(' ') + '\n', 'Other.md': 'no\n' });
    const hit = i.search('needle')[0];
    // Twelve tokens around the match, with an ellipsis on each side.
    expect(hit.snippet.text).toBe('…w15 w16 w17 w18 w19 needle w21 w22 w23 w24 w25 w26…');
    expect(hit.snippet.matches).toHaveLength(1);
    // A sentence start just before the match is preferred.
    const j = index({ 'S.md': 'One two three four five six seven eight. Nine ten needle eleven twelve thirteen fourteen fifteen sixteen.\n' });
    expect(j.search('needle')[0].snippet.text).toBe('…Nine ten needle eleven twelve thirteen fourteen fifteen sixteen.');
  });

  it('finds unlinked mentions', () => {
    const i = index({
      'Atlas Plan.md': '---\naliases: [The Map]\n---\n\nThe plan.\n',
      'Linked.md': 'See [[Atlas Plan]]. The atlas plan is good.\n',
      'Unlinked.md': 'We should revisit the atlas plan soon.\n',
      'Alias.md': 'Bring the map.\n',
      'Unrelated.md': 'Atlas and plan, but not together.\n',
    });
    const mentions = i.unlinkedMentions('Atlas Plan.md');
    expect(new Set(mentions.map((m) => m.source))).toEqual(new Set(['Unlinked.md', 'Alias.md']));
    expect(mentions.find((m) => m.source === 'Alias.md')?.name).toBe('The Map');
  });
});

describe('quick switcher and headings', () => {
  it('orders the quick switcher', () => {
    const i = index({
      'Plan.md': '',
      'Planning.md': '',
      'Project plan.md': '',
      'Pull later now.md': '',
      'Archive/Old plan.md': '---\naliases: [Legacy]\n---\n',
    });
    // Exact, then prefix, then the rest by fzf-style score (shorter, tighter matches first).
    expect(i.quickSwitch('plan').map((h) => h.path).slice(0, 4)).toEqual(['Plan.md', 'Planning.md', 'Archive/Old plan.md', 'Project plan.md']);
    expect(i.quickSwitch('pln')[0]?.path).toBe('Plan.md');
    expect(i.quickSwitch('legacy')[0]?.alias).toBe('Legacy');
    expect(i.quickSwitch('archive/old')[0]?.path).toBe('Archive/Old plan.md');
    expect(i.quickSwitch('zzz')).toEqual([]);
  });

  it('lists headings for completion', () => {
    const i = index({ 'Plan.md': '# Plan\n\n## Goals\n\n> ### Goals!\n\n## Risks [open]\n\n## Next steps\n' });
    const headings = i.headings('Plan.md');
    expect(headings.map((h) => h.text)).toEqual(['Plan', 'Goals', 'Goals!', 'Risks [open]', 'Next steps']);
    expect(headings.map((h) => h.depth)).toEqual([1, 2, 3, 2, 2]);
    expect(i.headings('Missing.md')).toEqual([]);

    const texts = (q: string, hs = headings) => VaultIndex.matchingHeadings(hs, q).map((h) => h.text);
    expect(texts('')).toEqual(['Plan', 'Goals', 'Goals!', 'Risks [open]', 'Next steps']);
    expect(texts('go')).toEqual(['Goals', 'Goals!']);
    expect(texts('nst')).toEqual(['Next steps']);
    expect(texts('risks open'), 'matched as a link writes it').toEqual(['Risks [open]']);
    expect(texts('goals', [...headings, { depth: 3, text: 'goals' }]), "a heading a link can't tell apart is offered once").toEqual(['Goals', 'Goals!']);
  });

  it('ranks any list fuzzily', () => {
    const commands: [string, string[]][] = [
      ['New Page', ['create']],
      ['Sync Now', []],
      ['Add Page to Favourites', ['star', 'bookmark']],
      ["Today's Note", ['daily']],
    ];
    const titles = (q: string) => VaultIndex.fuzzyMatching(commands, q, ([t, k]) => [t, ...k]).map(([t]) => t);
    expect(titles('')).toEqual(commands.map(([t]) => t));
    expect(titles('sync')).toEqual(['Sync Now']);
    expect(titles('star'), 'by a keyword').toEqual(['Add Page to Favourites']);
    expect(titles('page'), 'the shorter title first').toEqual(['New Page', 'Add Page to Favourites']);
    expect(titles('TODAY')).toEqual(["Today's Note"]);
    expect(titles('np')).toEqual(['New Page']);
    expect(titles('zzz')).toEqual([]);
  });
});

describe('the FTS5 port', () => {
  it('tokenizes as unicode61 with remove_diacritics 2', () => {
    const t = (s: string) => tokenize(s).map((x) => x.text);
    expect(t('Café NAÏVE façade')).toEqual(['cafe', 'naive', 'facade']);
    expect(t("don't c-3po x_y")).toEqual(['don', 't', 'c', '3po', 'x', 'y']);
    // Combining marks continue a token and are dropped; they don't start one.
    expect(t('Café ́x')).toEqual(['cafe', 'x']);
    // Letters outside Latin keep their marks, as SQLite's table only covers Latin.
    expect(t('Йод Ἀθῆναι ΣΟΦΊΑ ǅemal ĳ Ǆ')).toEqual(['йод', 'ἀθῆναι', 'σοφία', 'ǆemal', 'ĳ', 'ǆ']);
    // By SQLite's Unicode tables, not the browser's: emoji they don't know are words, others aren't.
    expect(t('emoji 🙂 here 東京 👉 🧱')).toEqual(['emoji', '🙂', 'here', '東京', '🧱']);
    expect(tokenize('  ab, cd')).toEqual([{ text: 'ab', start: 2, end: 4 }, { text: 'cd', start: 6, end: 8 }]);
  });

  it('parses queries without FTS5 syntax', () => {
    expect(parseSearchQuery('plan "two words" -no #tag tag:#x path:A/B -#neg')).toEqual({
      terms: [
        { text: 'plan', phrase: false, negated: false },
        { text: 'two words', phrase: true, negated: false },
        { text: 'no', phrase: false, negated: true },
        { text: '#neg', phrase: false, negated: true },
      ],
      tags: ['tag', 'x'],
      folders: ['A/B'],
    });
  });

  it('orders text by code point, as SQLite does', () => {
    const sorted = ['\u{1F600}', 'Ａ', 'b', 'a'].sort(compareCodePoints);
    expect(sorted).toEqual(['a', 'b', 'Ａ', '\u{1F600}']);
  });
});

// AtlasKit's Phase 1 exit criteria: search < 100 ms at 5,000 pages. Here the index is rebuilt
// on open, so building it counts too.
describe('5,000 pages', () => {
  it('builds and answers quickly', () => {
    const words = ['atlas', 'neutrino', 'encryption', 'graph', 'backlink', 'garden', 'river', 'station', 'café',
      'bread', 'planning', 'meeting', 'quarter', 'roadmap', 'sync', 'vault', 'editor', 'search'];
    let seed = 42;
    const random = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
    const paragraph = (n: number) => Array.from({ length: n }, () => words[random(words.length)]).join(' ');
    const pages: Record<string, string> = {};
    for (let i = 0; i < 5_000; i++) {
      const links = Array.from({ length: 4 }, () => `[[Page ${random(5_000)}]]`).join(' ');
      pages[`Folder ${i % 50}/Page ${i}.md`] = `# Page ${i}\n\n${paragraph(120)} ${links} #topic/${i % 20}\n\n- [ ] ${paragraph(20)}\n\n${paragraph(150)}\n`;
    }
    let t = performance.now();
    const i = index(pages);
    const build = performance.now() - t;

    const searches = ['encryption roadmap', '"river station"', 'plan #topic/3', 'café', 'backl'].map((q) => {
      t = performance.now();
      i.search(q);
      return performance.now() - t;
    });
    t = performance.now();
    i.quickSwitch('pg 42');
    const switcher = performance.now() - t;
    t = performance.now();
    i.backlinks('Folder 0/Page 0.md');
    const backlinks = performance.now() - t;
    console.log(`5,000 pages: build ${build.toFixed(0)} ms, search max ${Math.max(...searches).toFixed(1)} ms, `
      + `switcher ${switcher.toFixed(1)} ms, backlinks ${backlinks.toFixed(1)} ms`);
    expect(i.pageCount).toBe(5_000);
    expect(Math.max(...searches)).toBeLessThan(100);
    expect(switcher).toBeLessThan(100);
    expect(backlinks).toBeLessThan(50);
  }, 60_000);
});
