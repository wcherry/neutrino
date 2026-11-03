# @neutrino/atlas

Neutrino Atlas for the web client, below the UI: Atlas Markdown, the dialect every page is
written in (`specs/atlas-markdown/SPEC.md`), and the vault's data and sync. Both are implemented
to agree exactly with AtlasKit, the Swift package the Mac and iOS apps use.
Atlas Markdown for the web client: the dialect every Neutrino Atlas page is written in
(`specs/atlas-markdown/SPEC.md`), implemented to agree exactly with AtlasKit, the Swift
implementation the Mac and iOS apps use.

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

## How the vault agrees with AtlasKit

`sync/` is a line-for-line port. Its tests are AtlasKit's: the scenarios, and the property that
random edits, moves, deletions and interrupted syncs on three devices converge without losing
an edit (`vaultSync.test.ts`; `ATLAS_SYNC_SEEDS` and `ATLAS_SYNC_OPS` lengthen the run).
`driveVaultRemote.test.ts` runs the remote against an in-memory Drive API with real
encryption; `scripts/test-against-server.sh` runs `driveIntegration.test.ts` against a real
server built from this repo.

## How the parser agrees with AtlasKit
## How it agrees with AtlasKit

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
