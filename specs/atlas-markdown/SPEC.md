# Atlas Markdown — Specification v1

**Status:** Draft (`1.0.0-draft.2`)
**Date:** 2026-10-29
**Roadmap:** [`agent_docs/neutrino-atlas.md`](../../agent_docs/neutrino-atlas.md), constraint 3

Every Neutrino Atlas page is a Markdown file, and three independent editors read and write those
files: Swift (`AtlasKit`, macOS + iOS), TypeScript (`web/apps/web`) and Kotlin (Android). This
document defines the dialect they share: what the syntax means, what the parsed tree looks like,
what each page contributes to the link graph and index, and exactly which bytes an editor writes.

The [conformance corpus](./corpus/) is part of the spec. When this text and the corpus disagree,
that is a bug in one of them. Fix it here first, then in the corpus, in the same change.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119.

---

## 1. Goals and non-goals

**Goals**

1. **Agreement.** Given the same bytes, every implementation produces the same tree, the same
   links and tags, and the same resolution of every link.
2. **Byte stability.** Opening and saving a page without editing it writes back identical bytes.
   Editing part of a page changes only the bytes of what was edited. Without this, three editors
   reformat each other's files and every save becomes a spurious version or conflict.
3. **Obsidian compatibility.** An imported Obsidian vault parses the way Obsidian reads it, for
   every construct this spec covers. Where Atlas differs, it says so (§10).
4. **Forward safety.** v1 parses syntax that only later phases render (embeds, block ids, math,
   callouts), so a v1 editor never mangles content a newer client wrote.

**Non-goals for v1**

- Rendering and styling. This spec defines structure, not appearance.
- Typed properties, databases and query blocks (Phase 2). v1 treats frontmatter as opaque YAML
  apart from `tags` and `aliases` (§6).
- Flashcard syntax (Phase 3). It will be added as a minor version.

---

## 2. Base dialect

Atlas Markdown is **CommonMark 0.31.2** plus these **GitHub Flavored Markdown** extensions, as
the GFM spec 0.29 defines them: tables, task list items, strikethrough (`~~`) and extended
autolinks (`www.`, `http://`, `https://`, `ftp://` and email addresses). That GFM spec
version is the one GitHub's own cmark-gfm implements. Where an mdast-based parser (micromark)
differs from it, the GFM spec wins; the corpus pins each such case (§3.3).
GFM's "disallowed raw HTML" filter does **not** apply. Raw HTML is parsed as CommonMark parses
it, and renderers MUST sanitize it.

Footnotes (GFM style, `[^1]`) are parsed into `footnoteReference` / `footnoteDefinition` nodes.

On top of that base, v1 adds these extensions, defined in §4:

| Extension | Syntax | Node |
|---|---|---|
| Frontmatter | `---` YAML block at byte 0 | `yaml` |
| Wiki link | `[[target#heading\|alias]]` | `wikiLink` |
| Embed | `![[target]]` | `embed` |
| Tag | `#project/neutrino` | `tag` |
| Highlight | `==text==` | `highlight` |
| Block id | `^block-id` at end of a block | `blockId` field |
| Callout | `> [!note] Title` | `callout` |
| Math | `$x$`, `$$…$$` | `inlineMath`, `math` |

Anything not listed here, such as Obsidian comments (`%%…%%`), Dataview inline fields or
Logseq properties, is ordinary text in v1 and MUST round-trip unchanged under §8.

---

## 3. The tree (AST)

### 3.1 Vocabulary

The tree uses **mdast** (the `syntax-tree/mdast` vocabulary used by remark), extended with the
nodes in §4. Corpus files serialise it as JSON. The conformance comparison rules are:

- `position` (and any other source-location data) is **not** part of the tree and is never
  compared. Implementations MAY keep positions internally, and §8 needs them.
- Object keys are compared as a set; their order is irrelevant.
- Optional fields that mdast leaves out are written explicitly as `null` (`lang`, `meta`,
  `title`, `checked`, `start`, `label` and the extension fields). An absent key and `null` are
  **not** equivalent in the corpus. Always write the key.
- Adjacent `text` nodes are always merged, and a `text` node never has an empty `value`.
- Character references and backslash escapes are resolved in `text` values, as CommonMark
  requires (`\[\[x]]` → text `[[x]]`). An escaped character never starts an Atlas
  extension: `\#tag`, `\==x==`, `\[[x]]`, `\$x$`, `\^id` and `> \[!note]` are all
  ordinary text.
- Soft line breaks stay in `text` values as `"\n"`, whatever line ending the source used.
  Leading whitespace on continuation lines is stripped, as CommonMark requires.

### 3.2 Node catalogue

The tree is made of the standard mdast and GFM nodes:

- **Block nodes:** `root`, `paragraph`, `heading` (`depth`), `thematicBreak`, `blockquote`,
  `list` (`ordered`, `start`, `spread`), `listItem` (`checked`, `spread`),
  `code` (`lang`, `meta`, `value`), `html` (`value`), `table` (`align`), `tableRow`,
  `tableCell` and `footnoteDefinition` (`identifier`, `label`).
- **Inline nodes:** `text`, `emphasis`, `strong`, `delete`, `inlineCode` (`value`), `break`,
  `link` (`url`, `title`), `image` (`url`, `title`, `alt`) and `footnoteReference`
  (`identifier`, `label`).

**Reference links are resolved.** A full, collapsed or shortcut reference (`[text][ref]`,
`[ref][]`, `[ref]`) becomes a `link` or `image` carrying its definition's `url` and `title`.
Link reference definitions (`[ref]: url`) are not part of the tree. mdast's
`linkReference`, `imageReference` and `definition` nodes are therefore never produced. The
definitions' bytes are kept by source preservation (§8.1).

`spread` uses mdast's definitions, which split CommonMark's "loose" in two. A **list** is
spread when a blank line separates two of its items. A **list item** is spread when a blank
line separates two of its direct children in the tree. A renderer shows a list loose when the
list or any of its items is spread.

Footnote `identifier` is the label lowercased; `label` is the label as written. A footnote
label is one or more letters, digits, `-` or `_`. Any other `[^…]` is not a footnote and means
what plain CommonMark says: text, or a link if a reference definition matches it. `footnoteDefinition` nodes are always children
of `root`, in source order by their first line. A definition written inside a container
comes right after the top-level block that contains it. A definition that no reference uses
is not part of the tree, as on GitHub. Its bytes are kept by source preservation (§8.1).

`list.start` is the start number for ordered lists and `null` for bullet lists.
`listItem.checked` is `true`/`false` for task items and `null` otherwise.

`table.align` is an array with one entry per column: `"left"`, `"right"`, `"center"` or `null`.
Every `tableRow` has exactly as many cells as the header row: a short row is padded with empty
`tableCell`s and extra cells are dropped, as the GFM spec says.

**Values.** `inlineCode.value` is the code span's content as CommonMark defines it: line endings
become spaces, and one leading and trailing space is stripped when both are present. The `value`
of `code`, `math` and `html` never ends with a line ending, even for a block that runs to the end
of the file.

### 3.3 Where mdast tools differ

An implementation built on micromark/mdast (the likely TypeScript choice) gets a few of these
wrong out of the box and MUST normalise its output. The corpus covers each one:
- reference links (left as `linkReference` + `definition`);
- inline code line endings (kept as `\n`);
- short table rows (not padded);
- `ftp://` extended autolinks (not linked);
- a trailing line ending on an HTML block at the end of the file;
- footnote definitions that no reference uses (kept), or that are nested in a container (left
  in place);
- footnote labels with characters other than letters, digits, `-` and `_` (accepted);
- `$$` math blocks inside a list item or blockquote (recognised by micromark's math extension).

Extension nodes and fields are defined in §4.

---

## 4. Extensions

### 4.1 Frontmatter — `yaml`

- Recognised **only** when the file's first line, after an optional UTF-8 BOM, is exactly
  `---`. "Exactly" means trailing spaces and tabs are allowed and nothing else is.
- Ends at the next line that is exactly `---` or `...`. If there is no closing line, the
  first line is ordinary Markdown: a thematic break or setext underline, as CommonMark says.
- Produces a `yaml` node, `{ "type": "yaml", "value": "<lines between, joined with \n>" }`,
  as the first child of `root`. `value` has no trailing newline. Empty frontmatter has
  `value: ""`.
- v1 interprets only `tags` and `aliases` (§6). Everything else is preserved byte for byte.

### 4.2 Wiki links — `wikiLink`

```
wikiLink  = "[[" target [ "#" ( heading / "^" blockRef ) ] [ "|" alias ] "]]"
target    = *( any char except "[", "]", "|", "#", "^", line ending )
heading   = 1*( any char except "[", "]", "|", "^", line ending )
blockRef  = 1*( ALPHA / DIGIT / "-" )
alias     = *( any char except "[", "]", line ending )
```

- Recognised in inline content wherever text is, with the highest precedence of any inline
  construct after code spans, inline math, autolinks and raw HTML. Those four win: `[[x]]`
  inside `` `…` `` is code. A wiki link wins over a standard link or emphasis that would
  start inside it.
- **Not** recognised inside the text of a standard `link`, inside `image` alt text, or
  inside another wiki link.
- `target`, `heading` and `alias` are **trimmed** of leading/trailing ASCII whitespace.
- `target` MAY be empty only when a heading or block reference is present (`[[#Heading]]`,
  `[[#^id]]`), meaning "this page". Otherwise the construct is not a wiki link: `[[]]` and
  `[[ ]]` stay literal text.
- A `|` followed by nothing, or by whitespace only, gives `alias: null`.
- `heading` keeps any inner `#` verbatim (`[[Page#A#B]]` → heading `"A#B"`). Nested-heading
  resolution is reserved for a later version.
- The text between the brackets is taken **raw**: backslash escapes and character references
  are not processed, so `[[Notes\*Draft]]` has target `Notes\*Draft`, backslash included
  (see `wikilinks/raw-content`). The one exception is `\|`, which
  is the alias separator exactly like `|`. Inside a table cell, write the separator as `\|`.
  GFM's table parsing turns that back into `|` before inline parsing (see
  `wikilinks/in-table`).
- A backslash before the opening bracket (`\[[x]]`) prevents the wiki link.

```json
{ "type": "wikiLink", "target": "Page", "heading": null, "blockId": null, "alias": "shown" }
```

### 4.3 Embeds — `embed`

`"!" wikiLink`, with the same grammar, fields and rules as §4.2. `type` is `"embed"`. For an
image or other attachment, `alias` holds the display hint verbatim (`![[photo.png|300]]` →
`alias: "300"`). v1 does not interpret it further.

### 4.4 Tags — `tag`

```
tag      = "#" segment *( "/" segment )
segment  = 1*tagChar
tagChar  = Unicode letter (L*) / mark (M*) / decimal digit (Nd) / "_" / "-"
```

- The `#` MUST either be the first character of its block's plain text (§6), or be preceded
  in that plain text by Unicode whitespace. Here a block is the paragraph, heading or table
  cell, and a soft line break counts as whitespace. Markup doesn't count: `*#idea*` is a tag
  in emphasis, while `**bold**#x`, `a#b` and `x.#y` are not tags.
- At least one character of the whole tag MUST be something other than a decimal digit
  (`#123` is not a tag; `#123a` and `#2026/q4` are). Note the digit-only rule applies to the
  whole tag, not per segment.
- The tag ends at the first character that is not `tagChar` or a `/` followed by a `tagChar`.
  A trailing `/` is not part of the tag (`#a/` → tag `a`, then text `/`).
- Not recognised in code, math, HTML, link or image text, wiki links, or embeds.
- `# heading` is an ATX heading, not a tag (the space is required by CommonMark). `#heading`
  at the start of a line is a paragraph containing a tag.
- Matching is **case-insensitive** using Unicode default case folding after NFC normalisation.
  The node keeps the spelling as written.

```json
{ "type": "tag", "name": "project/neutrino" }
```

### 4.5 Highlight — `highlight`

`==text==` uses exactly the delimiter rules GFM uses for `~~` strikethrough: two `=`
characters, left/right flanking, and no nesting of highlight in highlight. It may contain any
inline content. `a == b` is not a highlight.

```json
{ "type": "highlight", "children": [ … ] }
```

### 4.6 Block ids — `blockId` field

A block id names a block so it can be linked (`[[Page#^id]]`) and later embedded.

```
blockIdMarker = 1*WSP "^" 1*( ALPHA / DIGIT / "-" )   ; at the very end of a paragraph
```

1. **Trailing form.** If a `paragraph`'s source ends with whitespace, `^`, then an id, at the
   end of its last line, the marker is removed from the inline content. Trailing whitespace
   left in the final `text` node is trimmed. The id is recorded as `blockId` on the
   **paragraph**. A paragraph that is the first child of a `listItem` therefore carries the
   id for that item. A heading can't carry a trailing id in v1: `## H ^id` is a heading with
   that literal text.
2. **Standalone form.** A paragraph whose whole content is `^id` is **removed** from the tree
   when its previous sibling is a `table`, `code`, `blockquote`, `callout`, `list` or `math`
   block. Its id is recorded as `blockId` on that block. After any other block (a paragraph
   or heading), it stays an ordinary paragraph of text.

   A blank line before the `^id` is required in practice. Without it, the line is absorbed
   by the block: it becomes a table row (GFM), or a lazy continuation of the last paragraph
   in a list or blockquote. This is the same rule Obsidian documents.
3. Every `paragraph`, `table`, `code`, `blockquote`, `callout`, `list` and `math` node has a
   `blockId` key, which is `null` when no id is present. No other node type carries one.
4. Ids are case-sensitive and MUST be unique within a page. If an id is repeated, links
   resolve to the first block in document order.

### 4.7 Callouts — `callout`

A `blockquote` whose first child is a `paragraph` whose source begins with
`[!type]` + optional fold + optional title becomes a `callout`:

```
calloutStart = "[!" calloutType "]" [ "+" / "-" ] [ 1*WSP title ]
calloutType  = 1*( ALPHA / DIGIT / "_" / "-" )
title        = rest of the first line (inline content)
```

- `calloutType` keeps its spelling as written. Comparisons are ASCII case-insensitive.
  Unknown types are valid and render as `note`.
- `fold` is `"+"` (collapsible, open), `"-"` (collapsible, closed) or `null`.
- `title` is an array of inline nodes, or `null` when the first line has nothing after the
  marker.
- If that first paragraph continues past the first line, the remaining lines become a new
  `paragraph` that is the callout's first child. Callout children are otherwise the
  blockquote's remaining children.
- Nested callouts are blockquotes inside a callout and follow the same rule.
- `> [!note]` inside a list item or a callout is a callout too. The rule depends only on the
  blockquote's content.

```json
{ "type": "callout", "calloutType": "warning", "fold": "-", "title": [ … ], "blockId": null, "children": [ … ] }
```

### 4.8 Math — `inlineMath`, `math`

- **Inline:** `$…$`, using pandoc's rule. The opening `$` must be followed by a non-space
  character. The closing `$` must be preceded by a non-space character and must not be
  followed by an ASCII digit. Inline math is on **one line**: it never spans a line ending.
  `\$` is a literal dollar.
  Example: `costs $5 and $10` contains no math.
- **Block:** a line that is exactly `$$` (after up to 3 spaces of indentation), up to the next
  line that is exactly `$$`. Math blocks are recognised only at the **top level** of the page
  in v1. Inside a list item, blockquote or callout, `$$` lines are ordinary text. `value` is the lines between. `$$x$$` on one line is **inline**
  math with value `x`, not a block. There is no info string, so `meta` is always `null`.

```json
{ "type": "inlineMath", "value": "e^{i\\pi}" }
{ "type": "math", "meta": null, "value": "\\int_0^1 x\\,dx", "blockId": null }
```

---

## 5. Character handling

- Files are **UTF-8**. A leading BOM is ignored by the parser, preserved on round-trip (§8),
  and never written to a new file.
- Line endings: `\n`, `\r\n` and lone `\r` are all line endings to the parser, as in
  CommonMark. Writers follow §8.3.
- Text is **not** normalised in the tree or on disk. NFC normalisation and case folding are
  used only for **matching** (tags in §4.4, link resolution in §7).
- Tabs follow CommonMark (a tab stop is 4 columns).

---

## 6. Extraction (what a page contributes to the index)

Every implementation computes the same `extract` record from a parsed page. The link graph,
backlinks, tag browser, quick switcher and search all build on it.

```json
{
  "links":     [ { "kind": "wiki", "target": "Page", "heading": null, "blockId": null, "alias": null } ],
  "embeds":    [ { "target": "photo.png", "heading": null, "blockId": null, "alias": "300" } ],
  "tags":      [ "project/neutrino", "idea" ],
  "aliases":   [ "Neutrino roadmap" ],
  "headings":  [ { "depth": 1, "text": "Plan" } ],
  "blockIds":  [ "summary" ]
}
```

- **`links`**: every `wikiLink`, in document order, duplicates included. Each has
  `kind: "wiki"` plus its four fields. Every standard `link` whose `url` is an internal page
  reference also counts, with `kind: "markdown"`. A url counts as internal if it:
  1. has no URI scheme, and doesn't start with `/`, `#` or `//`;
  2. once percent-decoded and stripped of any `#fragment`, ends in `.md` (case-insensitive).

  For these, `target` is the decoded path without `.md`, and `heading` is the decoded fragment
  (or `blockId` if it starts with `^`). `alias` is always `null`.
  Links inside frontmatter are not extracted.
- **`embeds`**: every `embed`, in document order, duplicates included.
- **`tags`**: frontmatter tags first, then inline `tag` nodes in document order, with
  duplicates removed by the matching rule in §4.4, keeping the first spelling seen.
  Frontmatter `tags` may be a YAML sequence or a single string. A string is split on commas
  and whitespace. Each value has one leading `#` stripped and is then checked against the §4.4
  grammar; invalid values are ignored.
- **`aliases`**: frontmatter `aliases`, as a YAML sequence or a single string (not split).
  Values are trimmed; empty ones are dropped. Duplicates are removed by exact match.
- **`headings`**: every `heading` in document order, as `depth` plus plain text (below).
- **`blockIds`**: every `blockId` in document order, duplicates included. The index warns on
  duplicates.

**Plain text** of a node is the concatenation, in order, of:
- `text`, `inlineCode` and `inlineMath`: their `value`
- `wikiLink` and `embed`: `alias` if not null, else `target`
- `tag`: `"#"` + `name`
- `image`: its `alt`
- `break`: a single space
- every other node: the plain text of its children

The result is trimmed.

If the frontmatter is not valid YAML, or `tags`/`aliases` have another type, those keys
contribute nothing, and the page still parses. Implementations MUST NOT fail to open a page
because of its frontmatter.

---

## 7. Link resolution

Resolution maps a link `target` (from a `wikiLink`, `embed` or markdown link) to a file in the
vault. It runs only on the client (`neutrino-atlas.md`, constraint 2), against the decrypted
vault path index. Paths are relative to the vault root, use `/`, and include the file
extension.

Resolution depends only on the target and the vault, never on the folder of the linking page.
This lets a writer pick a target that means the same thing everywhere.

0. An **empty** target (`[[#Heading]]`, `[[#^id]]`) resolves to the linking page itself.
1. **Normalise** the target and every candidate path: NFC, then Unicode default case folding.
   Strip a single leading `./` from the target.
2. **Pages vs attachments.** A target whose last segment has no extension, or ends in `.md`,
   looks for **pages** (`.md` files); compare without the `.md`. Any other extension
   (`photo.png`, `report.pdf`) looks for **attachments** by full file name.
3. **Candidates.**
   - A target with no `/` matches every file whose last path segment equals it.
   - A target containing `/` matches every file whose path equals it, or ends with `/` + it.
     The match is on whole segments only.
4. **Choose one** when several match:
   1. A candidate whose whole path equals the target wins. (This always has the fewest
      segments of any match, so rule 2 implies it. It is stated for clarity.)
   2. Otherwise the candidate with the fewest path segments wins.
   3. Otherwise the lowest by code-point order of the normalised path wins.
5. **No match** means the link is unresolved. It renders as a "create page" link. Creating a page
   from it uses the target as the title, in the vault's new-page folder (default: root).

**Writing links.** When an editor inserts a link to a file, it MUST write the first of these
that resolves to that file:
1. the bare name;
2. the last two path segments;
3. the last three segments, and so on;
4. the full path, which always resolves (rule 4.1).

The `.md` of a page is never written; an attachment keeps its extension. Example: with
`Roadmap.md` and `Projects/Roadmap.md` in the vault, links to them are written `[[Roadmap]]`
and `[[Projects/Roadmap]]`.

**Renames.** When a page or attachment is renamed or moved, the client rewrites every link
that resolved to it before the change. Each rewritten link gets the shortest target as
above, keeping its `heading`, `blockId` and `alias`. Only the bytes of the rewritten link
change (§8.2). The client syncs all rewritten pages as one batch.

---

## 8. Writing files

### 8.1 Source preservation (MUST)

An editor keeps, for each **top-level block**, the exact source bytes it was parsed from, and
the bytes between blocks. Top-level blocks are the children of `root`, plus the frontmatter
as its own unit. When saving:

- An **unchanged** top-level block is written back from its original bytes.
- A **changed or new** top-level block is written in canonical form (§8.3), with **one blank
  line** separating it from its neighbours, unless the original separator is still valid.
- Saving with no edits therefore reproduces the input exactly, BOM and line endings included.
  The corpus checks this for every case (`R`, §9).

Implementations SHOULD preserve at a finer grain: list items within a list, rows within a
table, and individual links within a paragraph during a rename. They MAY re-serialize a
whole changed top-level block. Finer is better, because it keeps diffs and merge conflicts
small; the corpus does not test this in v1.

### 8.2 Edits that touch only part of a line

A link rewrite (§7) or a toggled task checkbox MUST change only the bytes of that construct,
even in implementations that otherwise re-serialize whole blocks. These are the two edits
Atlas makes automatically on the user's behalf, so they must never reformat anything else.

### 8.3 Canonical form (for new and changed blocks)

| Construct | Canonical form |
|---|---|
| Line endings | The file's existing style, taken from its first line ending. New files use `\n`. Corpus `canonical.md` files always use `\n`. |
| End of file | Exactly one line ending after the last block. |
| Between blocks | One blank line. A list's items have no blank line between them unless the list is spread. |
| Headings | ATX: `#`×depth, one space, content. No closing `#`s. Setext is never written. |
| Paragraphs | Content as written, soft line breaks kept as line endings. No trailing whitespace. |
| Hard break | `\` at the end of the line, never trailing spaces. |
| Emphasis / strong | `*text*` / `**text**`. |
| Strikethrough / highlight | `~~text~~` / `==text==`. |
| Inline code | Backticks: one more than the longest backtick run inside, with one padding space each side only when the content starts or ends with a backtick or space. |
| Bullet list | `-` marker plus one space. If the previous sibling block is also a bullet list, use the other marker of the pair (`-` ↔ `*`). Two adjacent lists with the same marker would merge into one. |
| Ordered list | `N.` markers, numbered consecutively from `start`. After another ordered list, alternate `.` ↔ `)` in the same way. |
| Nested content | Indented by the parent item's content offset (2 spaces for `- `, 3 for `1. `, 4 for `10. `), with spaces, never tabs. |
| Task item | `- [ ] ` / `- [x] ` (lowercase `x`). |
| Code block | Fenced with backticks (three, or one more than the longest backtick run in the content), followed by `lang` and `meta` separated by one space. Indented code is never written. |
| Math block | `$$`, the value, `$$`. |
| Blockquote / callout | `> ` before every line (`>` alone on blank lines inside). Callout first line: `> [!type]` + fold + (space + title if any). |
| Thematic break | `---` |
| Table | `\| a \| b \|` rows, one space of padding, no column alignment padding. Delimiter row uses `---`, `:--`, `--:` or `:-:` per `align`. A `\|` inside a cell is written `\|`. |
| Links / images | `[text](url)` / `![alt](url)`, with `"title"` when set. Write `url` in `<…>` if it contains spaces or parentheses. The tree has no references (§3.2), so a changed block writes reference-style links inline; unchanged blocks and the definitions keep their bytes (§8.1). |
| Autolinks | A `link` with no title and a single `text` child is written as an autolink when the child text and `url` correspond: `<url>` when the text equals the url, `<text>` when the url is `mailto:` + text, and bare `text` when the url is `http://` + text and text starts with `www.`. Every other link uses `[text](url)`. |
| Wiki links / embeds | `[[target#heading\|alias]]` (`#^id` for block refs), with fields written as stored (already trimmed). `\|` inside a table cell. |
| Tags | `#name`. |
| Block ids | Trailing form: one space + `^id` at the end of the paragraph's last line. Standalone form: a blank line, then `^id` on its own line. |
| Frontmatter | `---`, the value verbatim, `---`, then one blank line before the first block. |
| Escaping | Escape a character only if writing it unescaped would parse to a different tree. When escaping any one of several characters would work, escape the leftmost (for literal `[[x]]`, write `\[[x]]`). Escape with `\`, never with a character reference. |

### 8.4 Determinism

`serializeCanonical(tree)` is a pure function: the same tree always produces the same bytes on
every platform. Parsing canonical output returns the same tree (`C`, §9).

---

## 9. Conformance

### 9.1 Corpus layout

```
specs/atlas-markdown/
  SPEC.md                     this document
  corpus/
    manifest.json             spec version + list of cases
    cases/<area>/<name>/
      input.md                bytes to parse
      ast.json                expected tree (§3)
      extract.json            expected extract record (§6)
      canonical.md            OPTIONAL — canonical serialization of ast.json when it differs from input.md
    resolve/<name>.json       link-resolution fixtures (§7)
  check.mjs                   checks the corpus is internally consistent (no parser involved)
```

### 9.2 Checks every implementation runs

For every case:

| Check | Meaning |
|---|---|
| **P** (parse) | `parse(input.md)` equals `ast.json`, using the comparison rules in §3.1. |
| **R** (round-trip) | `serialize(parse(input.md))` with no edits equals the bytes of `input.md`. |
| **C** (canonical) | `serializeCanonical(ast.json)` equals `canonical.md` (or `input.md` if there is no `canonical.md`), and `parse` of that file equals `ast.json`. |
| **E** (extract) | `extract(parse(input.md))` equals `extract.json`. Arrays are compared in order. |

For every resolve fixture, each case's `expect` (a vault path, or `null`) MUST match.

An implementation **conforms to v1** when it passes every check on every case in a corpus
whose `manifest.json` says `"specVersion": "1.x.y"`.

### 9.3 Vendoring the corpus into other repos

`neutrino/specs/atlas-markdown/corpus/` is the only editable copy. `neutrino_atlaskit` and
the Android app copy it into their test fixtures:
- They add a `VENDORED_FROM` file naming the `neutrino` commit.
- They provide a `scripts/sync-atlas-markdown-corpus.sh` script that copies from the sibling
  checkout.

This is the same arrangement `place_envelope_vectors.json` uses. A vendored copy MUST NOT be
edited in place.

### 9.4 Changing the spec

- **Patch** (`1.0.x`): corpus fixes and clarifications that do not change any implementation's
  correct output.
- **Minor** (`1.x.0`): new syntax that older implementations treat as text and preserve, such
  as flashcards. Older editors stay safe because of §8.1.
- **Major**: anything that changes the tree, extraction or resolution of existing input. This
  needs a migration plan for existing vaults.

Every change updates `SPEC.md`, the corpus and `manifest.json` in the same commit.

---

## 10. Differences from Obsidian

| Construct | Obsidian | Atlas v1 | Why |
|---|---|---|---|
| Nested list indentation on write | Tabs by default | Spaces at the content offset | Tabs render inconsistently across the three editors. Unchanged blocks keep their tabs (§8.1), so imported vaults are not rewritten. |
| Comments `%%…%%` | Hidden | Plain text | Not in Phase 1. Preserved byte for byte. |
| `[[Alias]]` via frontmatter aliases | Not resolved; aliases are an autocomplete aid | Same | — |
| Heading block ids `## H ^id` | Supported | Literal text | Reserved; headings are linked by text. |
| Frontmatter `tag` / `alias` (singular) | Deprecated, still read | Ignored | Only the plural keys are part of the format. |

---

## 11. Decisions to confirm

These are the defaults this draft takes. The first two are the hardest to change once vaults
exist.

1. **Top-level-block preservation** (§8.1) as the MUST, with finer-grained preservation as a
   SHOULD. The alternative of always writing canonical form is simpler but reformats every
   imported Obsidian page on first edit.
2. **Spaces, not tabs**, for nested lists in canonical form (§10).
3. **Pandoc's `$` rule** for inline math (§4.8), which avoids false positives on prices.
4. **Plural-only** frontmatter keys (`tags`, `aliases`).
