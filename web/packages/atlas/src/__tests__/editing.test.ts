// AtlasKit's MarkdownEditingTests, SlashCommandTests, InsertImagesTests, BlockImageTests,
// FilePreviewTests, PastedLinkTests, MoveLinesTests, the completion half of WikiLinkTests, and
// VaultWorkspaceTests' attachments and folder moves, ported.
import { describe, expect, it } from 'vitest';
import { blockImage, fileLinkAt, imageFileExtension, insertBlocks, insertEmbeds, setPreview } from '../editing/images';
import {
  acceptCompletion,
  applyEdit,
  indent,
  linkCompletionContext,
  newline,
  outdent,
  toggleTask,
  toggleWrap,
  type TextEdit,
} from '../editing/markdownEditing';
import { moveLines } from '../editing/moveLines';
import { pastedLink, pasteLink } from '../editing/pastedLinks';
import { applySlashCommand, builtInSlashCommands, matchingSlashCommands, slashContext } from '../editing/slashCommands';
import { parse } from '../parse';
import { pageSyntax, type PageSyntax } from '../syntax/pageSyntax';
import { MemoryStorage, Vault } from '../sync/vault';
import { childrenOf, plainText } from '../tree';
import { VaultWorkspace, folderMovedInto, pastedImageName } from '../workspace/vaultWorkspace';
import { movedInto } from '../workspace/pagePaths';
import { FakeDrive } from './fakeDrive';

type Selection = { from: number; to: number };

/**
 * Applies a command to text with the cursor (or selection) marked by `|` (or `|…|`), and returns
 * the result with a `|` where the new selection ends (or `|…|` around it, with `both`). Null if
 * there is no edit.
 */
function run(marked: string, command: (text: string, selection: Selection, syntax: PageSyntax) => TextEdit | null, both = false): string | null {
  const parts = marked.split('|');
  const text = parts.join('');
  const from = parts[0].length;
  const to = parts.length > 2 ? from + parts[1].length : from;
  const edit = command(text, { from, to }, pageSyntax(text));
  if (!edit) return null;
  let out = applyEdit(text, edit);
  out = out.slice(0, edit.selection.to) + '|' + out.slice(edit.selection.to);
  if (both && edit.selection.from !== edit.selection.to) out = out.slice(0, edit.selection.from) + '|' + out.slice(edit.selection.from);
  return out;
}

describe('Return, Tab, tasks and wrapping', () => {
  const nl = (s: string) => run(s, newline);
  const ind = (s: string) => run(s, indent);
  const out = (s: string) => run(s, outdent);

  it('continues lists, tasks and quotes', () => {
    expect(nl('- one|')).toBe('- one\n- |');
    expect(nl('  * one|')).toBe('  * one\n  * |');
    expect(nl('1. one|')).toBe('1. one\n2. |');
    expect(nl('9) one|')).toBe('9) one\n10) |');
    expect(nl('- [x] done|')).toBe('- [x] done\n- [ ] |');
    expect(nl('> quote|')).toBe('> quote\n> |');
    expect(nl('> - in a quote|')).toBe('> - in a quote\n> - |');
    expect(nl('- one  |')).toBe('- one\n- |');
    expect(nl('- one|two')).toBe('- one\n- |two');
  });

  it('ends the list on an empty item', () => {
    expect(nl('- one\n- |')).toBe('- one\n|');
    expect(nl('- [ ] |')).toBe('|');
    expect(nl('> |')).toBe('|');
    expect(nl('> > |')).toBe('> |');
    expect(nl('> - |')).toBe('> |');
  });

  it('is plain elsewhere', () => {
    expect(nl('plain|')).toBeNull();
    expect(nl('|- before the marker')).toBeNull();
    expect(nl('```\n- in code|\n```')).toBeNull();
    expect(nl('- o|n|e')).toBeNull();
  });

  it('indents under the item above, and outdents', () => {
    expect(ind('- one\n- tw|o')).toBe('- one\n  - tw|o');
    expect(ind('1. one\n2. tw|o')).toBe('1. one\n   2. tw|o');
    expect(ind('not a list|')).toBeNull();
    expect(out('- one\n  - tw|o')).toBe('- one\n- tw|o');
    expect(out('1. one\n   - a\n     - b|')).toBe('1. one\n   - a\n   - b|');
    expect(out('- top|')).toBeNull();
  });

  it('indents every selected item', () => {
    const text = '- a\n- b\n- c';
    const edit = indent(text, { from: 4, to: 11 }, pageSyntax(text))!;
    expect(applyEdit(text, edit)).toBe('- a\n  - b\n  - c');
    expect(edit.selection).toEqual({ from: 6, to: 15 });
  });

  it('toggles a task by changing one character', () => {
    const text = '- [ ] buy milk\n- [x] done\n';
    const syntax = pageSyntax(text);
    const tick = toggleTask(3, text, syntax)!;
    expect(applyEdit(text, tick)).toBe('- [x] buy milk\n- [x] done\n');
    expect(tick.to - tick.from).toBe(1);
    expect(applyEdit(text, toggleTask(20, text, syntax, true)!)).toBe('- [ ] buy milk\n- [ ] done\n');
    expect(toggleTask(10, text, syntax), "a click on the text isn't a click on the box").toBeNull();
  });

  it('wraps and unwraps', () => {
    const wrap = (m: string) => (t: string, s: Selection) => toggleWrap(m, t, s);
    expect(run('a |word| b', wrap('**'))).toBe('a **word|** b');
    expect(run('a **|word|** b', wrap('**'))).toBe('a word| b');
    expect(run('a |**word**| b', wrap('**'))).toBe('a word| b');
    expect(run('a |b', wrap('_'))).toBe('a _|_b');
  });
});

describe('wiki-link completion', () => {
  /** `|` marks the cursor. */
  const context = (marked: string) => {
    const cursor = marked.indexOf('|');
    const text = marked.replace('|', '');
    return linkCompletionContext(text, cursor, pageSyntax(text));
  };

  it('starts after an unclosed [[', () => {
    expect(context('See [[Pla|')?.query).toBe('Pla');
    expect(context('See [[Pla|')).toMatchObject({ from: 6, to: 9 });
    expect(context('[[|')?.query).toBe('');
    expect(context('![[Ima|')?.query).toBe('Ima');
    expect(context('[[Two words|]]')?.query).toBe('Two words');
    expect(context('[[Done]] and |')).toBeNull();
    expect(context('[[Page#^blo|'), 'a block reference has nothing to complete').toBeNull();
    expect(context('`[[code|`')).toBeNull();
    expect(context('[[one\ntwo|')).toBeNull();
    expect(context('plain|')).toBeNull();
  });

  it('completes the heading after a #', () => {
    expect(context('See [[Plan#Go|')).toEqual({ from: 11, to: 13, query: 'Go', page: 'Plan' });
    expect(context('[[ Projects/Plan #|')).toEqual({ from: 18, to: 18, query: '', page: 'Projects/Plan' });
    expect(context('[[#Goa|'), 'this page').toEqual({ from: 3, to: 6, query: 'Goa', page: '' });
    expect(context('[[Plan#C# tips|')?.query, 'a heading keeps its inner #').toBe('C# tips');
    const open = 'See [[Plan#Go';
    expect(applyEdit(open, acceptCompletion({ title: 'Goals', target: 'Goals' }, context(open + '|')!, open))).toBe('See [[Plan#Goals]]');
  });

  it('closes the link once', () => {
    const open = 'See [[Pla';
    const e1 = acceptCompletion({ title: 'Plan', target: 'Projects/Plan' }, linkCompletionContext(open, 9, pageSyntax(open))!, open);
    expect(applyEdit(open, e1)).toBe('See [[Projects/Plan]]');
    expect(e1.selection).toEqual({ from: 21, to: 21 });
    const closed = 'See [[Pla]] now';
    const e2 = acceptCompletion({ title: 'Plan', target: 'Plan' }, linkCompletionContext(closed, 9, pageSyntax(closed))!, closed);
    expect(applyEdit(closed, e2)).toBe('See [[Plan]] now');
    expect(e2.selection).toEqual({ from: 12, to: 12 });
  });
});

describe('the / menu', () => {
  /** `‸` marks the cursor (tables use `|`). */
  const context = (marked: string) => {
    const cursor = marked.indexOf('‸');
    const text = marked.replace('‸', '');
    return slashContext(text, cursor, pageSyntax(text));
  };
  const apply = (id: string, marked: string) => {
    const cursor = marked.indexOf('‸');
    const text = marked.replace('‸', '');
    const ctx = slashContext(text, cursor, pageSyntax(text))!;
    const edit = applySlashCommand(builtInSlashCommands().find((c) => c.id === id)!, ctx, text);
    const out = applyEdit(text, edit);
    return out.slice(0, edit.selection.from) + '‸' + out.slice(edit.selection.from);
  };

  it('opens after a slash at a line start or after a space', () => {
    expect(context('/‸')).toEqual({ from: 0, to: 1, query: '' });
    expect(context('Text /hea‸')).toEqual({ from: 5, to: 9, query: 'hea' });
    expect(context('- item\n  /ta‸')).toEqual({ from: 9, to: 12, query: 'ta' });
    expect(context('and/or‸'), 'not inside a word').toBeNull();
    expect(context('1/2‸')).toBeNull();
    expect(context('/two words‸'), 'a space ends it').toBeNull();
    expect(context('`/code‸`')).toBeNull();
    expect(context('```\n/inside‸\n```\n')).toBeNull();
    expect(context('/' + 'a'.repeat(31) + '‸')).toBeNull();
  });

  it('matches titles, words and keywords', () => {
    const all = builtInSlashCommands();
    const ids = (q: string) => matchingSlashCommands(all, q).map((c) => c.id);
    expect(ids('')).toHaveLength(all.length);
    expect(ids('head')).toEqual(['h1', 'h2', 'h3']);
    expect(ids('h2')).toEqual(['h2']);
    expect(ids('todo')).toEqual(['task']);
    expect(ids('li')[0], 'a title prefix comes before a word or keyword match').toBe('link');
    expect(ids('li'), 'Bulleted list has a word starting with it').toContain('bullet');
    expect(ids('zzz')).toEqual([]);
  });

  it("keeps the line's text for line commands", () => {
    expect(apply('h1', '/h1‸')).toBe('# ‸');
    expect(apply('h2', 'Plans /h2‸')).toBe('## Plans‸');
    expect(apply('h1', '## Plans /h1‸'), 'replaces the heading marker').toBe('# Plans‸');
    expect(apply('task', '- milk /ta‸'), 'a list item becomes a task').toBe('- [ ] milk‸');
    expect(apply('bullet', '  1. one /bu‸'), 'keeps the indentation').toBe('  - one‸');
    expect(apply('quote', 'Said /quo‸ it')).toBe('> Said ‸ it');
    expect(apply('number', 'a\n/num‸\nb')).toBe('a\n1. ‸\nb');
  });

  it('inserts blocks and text', () => {
    expect(apply('code', '/code‸')).toBe('```‸\n\n```');
    expect(apply('code', 'Para\n/code‸'), 'a block gets a blank line after text').toBe('Para\n\n```‸\n\n```');
    expect(apply('divider', 'Para /div‸'), 'never a setext underline').toBe('Para \n\n---‸');
    expect(apply('divider', '/div‸ after')).toBe('---‸\n\n after');
    expect(apply('math', '  /math‸'), "an empty line's whitespace goes too").toBe('$$\n‸\n$$');
    expect(apply('table', '/tab‸')).toBe('| Column | Column |\n| --- | --- |\n| ‸ |  |');
    expect(apply('callout', '/call‸')).toBe('> [!note]\n> ‸');
    expect(apply('link', 'See /link‸')).toBe('See [[‸');
    const commands = builtInSlashCommands(new Date(2026, 9, 30, 9, 5));
    expect(commands.find((c) => c.id === 'date')?.action).toEqual({ type: 'insert', text: '2026-10-30', cursor: null, block: false });
    expect(commands.find((c) => c.id === 'time')?.action).toEqual({ type: 'insert', text: '09:05', cursor: null, block: false });
  });

  it('makes what each block command says', () => {
    const expected: Record<string, string> = { code: 'code', math: 'math', table: 'table', divider: 'thematicBreak', callout: 'callout' };
    for (const [id, type] of Object.entries(expected)) {
      const text = apply(id, 'Para\n/x‸').replace('‸', '');
      const blocks = childrenOf(parse(text));
      expect(blocks, id).toHaveLength(2);
      expect(blocks[1].type, `${id}: ${text}`).toBe(type);
    }
  });
});

describe('images', () => {
  const insert = (targets: string[], marked: string) => run(marked, (t, s) => insertEmbeds(targets, t, s));
  const images = (text: string) => pageSyntax(text).blocks.map((b) => blockImage(b, text));

  it('puts each image in a block of its own', () => {
    expect(insert(['a.png'], '|')).toBe('![[a.png]]|');
    expect(insert(['a.png'], 'Intro|')).toBe('Intro\n\n![[a.png]]|');
    expect(insert(['a.png'], 'Intro\n|')).toBe('Intro\n\n![[a.png]]|');
    expect(insert(['a.png'], 'Intro\n\n|\n\nAfter')).toBe('Intro\n\n![[a.png]]|\n\nAfter');
    expect(insert(['a.png'], '|\nAfter'), 'not run into the line below').toBe('![[a.png]]|\n\nAfter');
    expect(insert(['a.png'], 'One |two'), 'splits a paragraph').toBe('One \n\n![[a.png]]|\n\ntwo');
    expect(insert(['a.png', 'b c.jpg'], '|')).toBe('![[a.png]]\n\n![[b c.jpg]]|');
    expect(insert(['a.png'], '  |  '), "an empty line's spaces go").toBe('![[a.png]]|');
    expect(insert(['a.png'], 'Keep |this| text'), 'replaces the selection').toBe('Keep \n\n![[a.png]]|\n\n text');
    expect(insert([], '|')).toBeNull();
    const text = 'Intro\n\n![[a.png]]\n\nAfter';
    expect(blockImage(pageSyntax(text).blocks[1], text)).not.toBeNull();
  });

  it('knows image types from their bytes', () => {
    const b = (...xs: (number | string)[]) => new Uint8Array(xs.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])));
    expect(imageFileExtension(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe('png');
    expect(imageFileExtension(b(0xff, 0xd8, 0xff, 0xe0))).toBe('jpg');
    expect(imageFileExtension(b('GIF89a'))).toBe('gif');
    expect(imageFileExtension(b('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(imageFileExtension(b(0, 0, 0, 0x18, 'ftypheic'))).toBe('heic');
    expect(imageFileExtension(b(0x49, 0x49, 0x2a, 0x00))).toBe('tiff');
    expect(imageFileExtension(b('%PDF-1.7'))).toBeNull();
    expect(imageFileExtension(new Uint8Array())).toBeNull();
  });

  it('shows an image on its own line', () => {
    expect(images('![[photo.png]]')).toEqual([{ source: { type: 'embed', ref: { target: 'photo.png', heading: null, blockId: null, alias: null } }, width: null }]);
    expect(images('![[Assets/Diagram.JPEG]]')[0]?.source).toMatchObject({ type: 'embed', ref: { target: 'Assets/Diagram.JPEG' } });
    expect(images('![A cat](cats/my%20cat.png)')).toEqual([{ source: { type: 'path', path: 'cats/my cat.png' }, width: null }]);
    expect(images('Intro\n\n![[a.gif]]\n\nAfter').map((i) => i !== null)).toEqual([false, true, false]);
  });

  it('reads the width hint', () => {
    expect(images('![[photo.png|300]]')[0]?.width).toBe(300);
    expect(images('![[photo.png|300x200]]')[0]?.width).toBe(300);
    expect(images('![[photo.png|A caption]]')[0]?.width).toBeNull();
    expect(images('![[photo.png|A caption]]')[0]).not.toBeNull();
  });

  it('leaves others as links', () => {
    expect(images('See ![[photo.png]] here')[0], 'inside a sentence').toBeNull();
    expect(images('![[Page]]')[0], 'a page embed').toBeNull();
    expect(images('![[talk.pdf]]')[0], 'not an image').toBeNull();
    expect(images('![x](https://example.com/a.png)')[0], 'a web image would tell its server').toBeNull();
    expect(images('![x](//cdn.example.com/a.png)')[0]).toBeNull();
    expect(images('![x](data:image/png;base64,AAAA)')[0]).toBeNull();
    expect(images('- ![[photo.png]]')[0], 'in a list item').toBeNull();
    expect(images('![[a.png]] ![[b.png]]')[0], 'two images').toBeNull();
  });
});

describe('file links as previews and chips', () => {
  const isFileLink = (url: string) => url.includes('/open/');
  const set = (preview: boolean, marked: string) => {
    const at = marked.indexOf('|');
    const text = marked.replace('|', '');
    const edit = setPreview(preview, at, text, pageSyntax(text), isFileLink);
    if (!edit) return null;
    const out = applyEdit(text, edit);
    return out.slice(0, edit.selection.to) + '|' + out.slice(edit.selection.to);
  };

  it('shows a file link as an image only when the app vouches for it', () => {
    const text = '![Q4 plan](https://www.getneutrino.app/open/doc/a)';
    const block = pageSyntax(text).blocks[0];
    expect(blockImage(block, text, isFileLink)?.source).toEqual({ type: 'url', url: 'https://www.getneutrino.app/open/doc/a' });
    expect(blockImage(block, text)).toBeNull();
    const web = '![x](https://example.com/a.png)';
    expect(blockImage(pageSyntax(web).blocks[0], web, isFileLink)).toBeNull();
  });

  it('switches between preview and chip', () => {
    const link = '[Q4](https://g/open/doc/a)';
    expect(set(true, '[Q|4](https://g/open/doc/a)'), 'on a line of its own: the `!` is added').toBe('!' + link + '|');
    expect(set(false, '![Q|4](https://g/open/doc/a)'), 'and taken off').toBe(link + '|');
    expect(set(true, 'See [Q|4](https://g/open/doc/a) now.\nNext')).toBe('See now.\n\n!' + link + '|\n\nNext');
    expect(set(true, 'See [Q|4](https://g/open/doc/a).')).toBe('See.\n\n!' + link + '|');
    expect(set(true, '![Q|4](https://g/open/doc/a)'), 'already a preview').toBeNull();
    expect(set(true, '[A |site](https://example.com)'), 'not a file link').toBeNull();
  });

  it('finds the file link at the cursor, and puts blocks on lines of their own', () => {
    const text = 'a [Q4](https://g/open/doc/a) b';
    expect(fileLinkAt(4, pageSyntax(text), isFileLink)?.isPreview).toBe(false);
    expect(fileLinkAt(0, pageSyntax(text), isFileLink)).toBeNull();
    const edit = insertBlocks(['![A](u)', '![B](v)'], 'Intro', { from: 5, to: 5 });
    expect(edit && applyEdit('Intro', edit)).toBe('Intro\n\n![A](u)\n\n![B](v)');
  });
});

describe('pasting a copied link', () => {
  const url = 'https://www.getneutrino.app/open/note/n1';

  it('pastes it with its title', () => {
    expect(pastedLink(url, `<a href="${url}">Q4 plan</a>`)).toBe(`[Q4 plan](${url})`);
    expect(pastedLink(url + '\n', `<meta charset='utf-8'><a class="x" href='${url}' target="_blank"><b>Q4</b>  plan</a>`)).toBe(`[Q4 plan](${url})`);
    expect(pastedLink(url, `<a href="${url}">Ideas &amp; [draft] &lt;1&gt; &#8212; \\</a>`)).toBe(`[Ideas & \\[draft\\] <1> — \\\\](${url})`);
    expect(pastedLink('https://x.y/a(b)', '<a href="https://x.y/a(b)">Paren</a>')).toBe('[Paren](<https://x.y/a(b)>)');
    expect(pastedLink('https://x.y/?a=1&b=2', '<a href="https://x.y/?a=1&amp;b=2">Q</a>')).toBe('[Q](https://x.y/?a=1&b=2)');
  });

  it('pastes anything else as it is', () => {
    expect(pastedLink(url, null)).toBeNull();
    expect(pastedLink(url, '<a href="https://other">Q4 plan</a>'), "the text isn't that link").toBeNull();
    expect(pastedLink(url, `<p>See <a href="${url}">Q4 plan</a> soon</p>`), 'a paragraph with a link in it').toBeNull();
    expect(pastedLink(url, `<a href="${url}">a</a><a href="${url}">b</a>`)).toBeNull();
    expect(pastedLink(url, `<a href="${url}">${url}</a>`), 'no title to add').toBeNull();
    expect(pastedLink(url, `<a href="${url}"> </a>`)).toBeNull();
    expect(pastedLink('javascript:alert(1)', '<a href="javascript:alert(1)">x</a>')).toBeNull();
    expect(pastedLink('two words', '<a href="two words">x</a>')).toBeNull();
  });

  it('replaces the selection, but not in code', () => {
    const html = `<a href="${url}">Q4 plan</a>`;
    const text = 'See X now\n\n```\ncode\n```\n';
    const edit = pasteLink(url, html, text, { from: 4, to: 5 }, pageSyntax(text));
    expect(edit && applyEdit(text, edit)).toBe(`See [Q4 plan](${url}) now\n\n\`\`\`\ncode\n\`\`\`\n`);
    expect(edit?.selection.from).toBe(4 + `[Q4 plan](${url})`.length);
    const inCode = text.indexOf('code\n') + 2;
    expect(pasteLink(url, html, text, { from: inCode, to: inCode }, pageSyntax(text))).toBeNull();
  });

  it('parses back as the link', () => {
    const pasted = pastedLink(url, `<a href="${url}">Ideas [draft] \\ *x*</a>`)!;
    const [paragraph] = childrenOf(parse(pasted));
    const [link] = childrenOf(paragraph);
    expect(childrenOf(paragraph)).toHaveLength(1);
    expect(link).toMatchObject({ type: 'link', url });
    expect(plainText(link), 'shown as written').toBe('Ideas [draft] \\ *x*');
  });
});

describe('moving lines', () => {
  const move = (direction: 'up' | 'down', marked: string) => run(marked, (t, s, syn) => moveLines(direction, t, s, syn), true);

  it('moves a line, keeping the cursor', () => {
    expect(move('up', 'one\ntw|o\nthree')).toBe('tw|o\none\nthree');
    expect(move('down', 'one\ntw|o\nthree')).toBe('one\nthree\ntw|o');
    expect(move('up', 'one\n|')).toBe('|\none');
  });

  it('stops at the edges', () => {
    expect(move('up', 'o|ne\ntwo')).toBeNull();
    expect(move('down', 'one\ntw|o')).toBeNull();
    expect(move('up', 'only|')).toBeNull();
  });

  it('moves every selected line', () => {
    expect(move('up', 'zero\n|one\ntwo|\nthree')).toBe('|one\ntwo|\nzero\nthree');
    expect(move('down', 'zero\n|one\ntwo|\nthree')).toBe('zero\nthree\n|one\ntwo|');
    expect(move('down', '|one\n|two\nthree'), "a selection ending at a line's start doesn't take that line").toBe('two\n|one\n|three');
  });

  it('takes a list item with its nested items, past a sibling with its own', () => {
    const list = '- a\n- b|\n  - b1\n  - b2\n- c';
    expect(move('up', list)).toBe('- b|\n  - b1\n  - b2\n- a\n- c');
    expect(move('down', list)).toBe('- a\n- c\n- b|\n  - b1\n  - b2');
    expect(move('up', '- a\n  - a1\n  - a2\n- b|')).toBe('- b|\n- a\n  - a1\n  - a2');
    expect(move('down', '- b|\n- a\n  - a1\n- c')).toBe('- a\n  - a1\n- b|\n- c');
    expect(move('down', '- a\n  - a|1\n  - a2\n- b')).toBe('- a\n  - a2\n  - a|1\n- b');
  });

  it('moves and passes code and math blocks whole, and keeps the frontmatter first', () => {
    expect(move('up', 'before\n```\nx = 1\n```\nafter|')).toBe('before\nafter|\n```\nx = 1\n```');
    expect(move('down', 'befor|e\n```\nx = 1\n```\nafter')).toBe('```\nx = 1\n```\nbefor|e\nafter');
    expect(move('up', 'before\n$$\nx|\n$$')).toBe('$$\nx|\n$$\nbefore');
    const page = '---\ntitle: A\n---\nfirs|t\nsecond';
    expect(move('up', page)).toBeNull();
    expect(move('down', page)).toBe('---\ntitle: A\n---\nsecond\nfirs|t');
    expect(move('down', '---\ntitle: |A\n---\nbody')).toBeNull();
  });
});

describe('attachments and folders', () => {
  const workspace = async (drive = new FakeDrive()) => VaultWorkspace.open(await Vault.open(new MemoryStorage()), drive);

  it('numbers attachments and syncs them', async () => {
    const drive = new FakeDrive();
    const w = await workspace(drive);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(await w.addAttachment(png, 'photo.png', 'Attachments')).toBe('Attachments/photo.png');
    expect(await w.addAttachment(png, 'photo.png', 'Attachments')).toBe('Attachments/photo 2.png');
    expect(await w.addAttachment(png, '../.secret/x.png', ''), 'no folders, not hidden').toBe('-.secret-x.png');
    expect(await w.addAttachment(png, '.png', ''), 'hidden name, no extension left').toBe('png');
    expect(await w.content('Attachments/photo 2.png')).toEqual(png);
    await w.sync();
    expect((await drive.list()).map((f) => f.path)).toContain('Attachments/photo.png');
    expect(pastedImageName('png', new Date(2026, 9, 26, 7, 33, 20))).toBe('Pasted image 20261026073320.png');
  });

  it('moves a folder with everything in it, rewriting links', async () => {
    const w = await workspace();
    await w.writeText('See [[Work/Plan]] and ![[Work/Assets/chart.png]]\n', 'Home.md');
    await w.writeText('# Plan\n\nSee [[Notes]].\n', 'Work/Plan.md');
    await w.writeText('notes\n', 'Work/Notes.md');
    await w.write(new Uint8Array([0x89, 0x50]), 'Work/Assets/chart.png');
    await w.writeText('elsewhere\n', 'Workshop/Plan.md');

    expect(await w.moveFolder('Work', 'Archive/2026/Work')).toBeGreaterThan(0);
    expect(w.paths, 'a folder named alike is left alone').toEqual([
      'Archive/2026/Work/Assets/chart.png', 'Archive/2026/Work/Notes.md', 'Archive/2026/Work/Plan.md', 'Home.md', 'Workshop/Plan.md',
    ]);
    expect(w.index.backlinks('Archive/2026/Work/Plan.md').map((l) => l.source)).toEqual(['Home.md']);

    await expect(w.moveFolder('Archive', 'Archive/Inner'), 'not into itself').rejects.toThrow();
    await w.writeText('x\n', 'Other/Notes.md');
    await expect(w.moveFolder('Archive/2026/Work', 'Other'), 'not onto files already there').rejects.toThrow();
    expect(await w.text('Archive/2026/Work/Notes.md'), 'nothing moved').not.toBeNull();

    expect(movedInto('Inbox/Idea.md', 'Projects')).toBe('Projects/Idea.md');
    expect(movedInto('Inbox/Idea.md', '')).toBe('Idea.md');
    expect(folderMovedInto('Inbox/Ideas/', 'Projects')).toBe('Projects/Ideas');
  });
});
