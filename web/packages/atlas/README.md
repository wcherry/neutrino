# @neutrino/atlas

Neutrino Atlas for the web client, below the UI: Atlas Markdown, the dialect every page is
written in (`specs/atlas-markdown/SPEC.md`); the vault's data and sync; its index; and what the
editor needs to style a page. All of it is implemented to agree exactly with AtlasKit, the Swift
package the Mac and iOS apps use. The app itself, `/atlas`, is in `apps/web/src/app/(apps)/atlas`.

- `parse(source)` → the tree (SPEC §3–§4), plain objects shaped like the corpus's `ast.json`.
- `extract(tree)` → what a page contributes to the index (§6).
- `LinkResolver` → link resolution and the target to write for a new link (§7);
  `anchorLine` and `headingLinkText` for heading and block targets.
- `MarkdownDocument` → source preservation (§8.1): unchanged blocks and gaps written back
  exactly; `replaceBlock` / `insertBlock` / `removeBlock`; in-place task toggles and link
  rewrites (§8.2).
- `serializeCanonical` → canonical form (§8.3), with §8.3.1's escaping.

Vault data (SPEC-free: this is transport and storage), ported from AtlasKit's `Vault`,
`VaultSync`, `ThreeWayMerge` and `DriveVaultRemote` so that a vault synced by the web and by the
Mac behaves the same:

- `Vault` → the local copy: every file's content, its last-synced base, and its sync record,
  kept as sealed blobs plus a journal (`VaultStorage`).
- `VaultSync` → two-way sync with Drive that never discards a change: line merges
  (`threeWayMerge`), conflicted copies, edits winning over deletions elsewhere.
- `DriveVaultRemote` → the vault as a Drive folder tree, every file end-to-end encrypted with
  `@neutrino/e2e-crypto` and its keys from the session keyring.
- `LocalVault` → a vault's copy in this browser: `IndexedDBStorage`, sealed with `DeviceSealer`
  (AES-GCM under a non-extractable WebCrypto key kept in IndexedDB), and held by one tab at a
  time through the Web Locks API. No plaintext reaches the disk, and nothing but Drive file and
  folder names reaches the server.

The index, ported from AtlasKit's `VaultIndex` and `VaultWorkspace`:

- `VaultIndex` → what every page contributes, in memory: backlinks and outgoing links,
  unresolved targets, tags, headings, unlinked mentions, full-text search with snippets, and the
  quick switcher's fuzzy match (also `matchingHeadings` and `fuzzyMatching` for other lists).
- `VaultWorkspace` → an open vault: its files, index and sync together, so the index never falls
  behind. Writes, page creation, moves that rewrite the links to what moved, deletions, and sync
  passes; edits made during a pass are held back and written after it, as AtlasKit does.
- `storageIndexCache` (`LocalVault.indexCache`) → what was extracted from each page, sealed in
  the vault's copy, so reopening a vault parses only the pages that changed. The Mac rebuilds
  its index on every open, but parsing in the browser is slower: about 4 s for 1,200 pages.

For the editor and the app, from AtlasKit's `PageSyntax`, `MarkdownStyler`, `MentionLinker` and
`PageList`, and the Mac app's `PagePaths`:

- `pageSyntax(source)` → where each construct of a page is in its source, in UTF-16 offsets:
  every top-level block's tree aligned with its text, so delimiters, markers and escapes are
  known as syntax. `styleRuns` turns a block into styled runs, with Live Preview's hidden syntax
  away from the cursor; `linkAt` and `shouldOpenLink` decide what a click follows.
- `linkingMentions` ("link it", `VaultWorkspace.linkMentions`) → unlinked mentions of a page
  made wiki links, in plain text only, and only when the result reads back as exactly those new
  links.
- `pageTree`, `tagTree`, `PageList`, `renamedPath`, `pageForUnresolvedLink` → the sidebar's
  trees, favourites and recent pages, and where renames and new pages go.
- `editing/`, from `MarkdownEditing`, `SlashCommands`, `Images`, `PastedLinks` and `MoveLines`:
  the editor's commands, each an edit a person could have typed. Return continues lists, tasks
  and quotes; Tab and Shift-Tab indent list items; tasks toggle; bold, italic and code wrap;
  `[[` completes pages and then headings; the `/` menu; images alone in a paragraph show as
  images, inserted as embeds; links to Neutrino files show as chips or previews; a copied link
  pastes with its title; lines move with the blocks they belong to.
- `VaultWorkspace.addAttachment`, `moveFolder` → images saved into the vault, numbered as
  needed, and folders moved or renamed with every link to what's in them rewritten.

## How the vault agrees with AtlasKit

`sync/` is a line-for-line port. Its tests are AtlasKit's: the scenarios, and the property that
random edits, moves, deletions and interrupted syncs on three devices converge without losing
an edit (`vaultSync.test.ts`; `ATLAS_SYNC_SEEDS` and `ATLAS_SYNC_OPS` lengthen the run).
`driveVaultRemote.test.ts` runs the remote against an in-memory Drive API with real
encryption; `scripts/test-against-server.sh` runs `driveIntegration.test.ts` against a real
server built from this repo.

## How the index agrees with AtlasKit

AtlasKit's index is SQLite with FTS5. Here it's maps, answering in SQLite's orders (rows by
rowid, text by code point, `LIKE` ignoring case for ASCII only), and `indexing/fts.ts` is a port
of FTS5 itself: the `unicode61 remove_diacritics 2` tokenizer with SQLite's case folding and
diacritic tables, prefix and phrase matching, `bm25(10.0, 5.0, 1.0)` and `snippet()`. Which
characters count as letters comes from SQLite's own Unicode tables too
(`scripts/gen-fts5-token-chars.py` writes them from an SQLite amalgamation); they differ from the
browser's mostly on emoji. `vaultIndex.test.ts` and `vaultWorkspace.test.ts` are AtlasKit's tests.
Run against AtlasKit on 1,212 real Markdown files, with several hundred searches, switcher
queries and mention lookups, before and after 366 random renames, removals and edits, every
answer was the same, down to the order of results and the text and highlights of each snippet.

## How the syntax map agrees with AtlasKit

`syntax/pageSyntax.ts` is a port of `PageSyntax.swift`'s aligner, walking code points with `\r\n`
as one character as Swift does. Its tests are AtlasKit's, the corpus included: every case aligns
completely, and on random pages complete blocks hold exactly their tree's constructs. Run against
AtlasKit on the same 1,212 real files and 6,000 random pages, every page whose tree and block
lines agree with AtlasKit's gets the same spans. Where they don't, the difference is the parser's,
not the map's: on 174 of the random pages (none of the real ones) the trees differ, mostly with
a lone `\r`, an out-of-range `&#…;` or footnote definitions inside containers, and those are
open parser gaps to pin in the corpus.

## How the parser agrees with AtlasKit

It is a port of AtlasCore's parser pipeline: `preprocess.ts` (`SourcePreprocessor`),
`convert.ts` (`CMarkConverter`), `passes.ts` (`ExtensionPasses`), and the writer and edits.
The CommonMark + GFM base is micromark instead of cmark-gfm, normalised wherever the two
differ, each to cmark-gfm's behaviour since that is what AtlasKit runs:

| Where | What micromark does differently, and what this package does instead |
|---|---|
| Extended autolinks (`autolinks.ts`) | Its own GFM autolinking is replaced by a port of cmark-gfm's `autolink.c`: matched on raw source, to the next space or `<`, trailing punctuation trimmed, no link inside an open `[`; emails found afterwards in text. |
| Emphasis flanking (`attention.ts`) | Flanking reads past `~` (cmark's `skip_chars`, from strikethrough) and uses cmark's punctuation and whitespace classes. micromark's matching resolver is kept. |
| List starts (`containers.ts`) | An empty item or an ordered item not starting at 1 is refused only when it would interrupt a paragraph, not after any open block or when nested on the same line. |
| Tasks (`convert.ts`) | The checkbox is read from the source; an empty task followed by an unindented line ends the list; whitespace after the box is stripped. |
| HTML after a list (`convert.ts`) | A tag line not indented to the item's content ends the list, as an HTML block. |
| Code spans, info strings, footnotes, references, tables | §3.3's list: line endings, trimming, unused or nested footnote definitions, labels, resolved references, padded rows. |

The corpus (`specs/atlas-markdown/corpus`, read in place) pins the spec. Beyond it, AtlasKit's
own edit, fuzz and regression tests are ported (`document.test.ts`, `fuzz.test.ts`,
`regression.test.ts`), the fuzz tests with the same generator so both run on the same inputs.

Differential testing against AtlasKit, with a throwaway harness: every one of 1,212 real
Markdown files in the platform's repositories (8 MB) parses to an identical tree, and so do 4,930
of 5,000 random pages built from the trickiest pieces of the syntax. The 70 that differ are
pathological combinations: reference definitions right after a task checkbox, long `***` runs
where cmark 0.29's delimiter bookkeeping differs, duplicate footnote definitions, and a `---`
directly under a definition line.
