# Images in Notes and Sheets

**Status:** design, for review. No code yet.
**Context:** step 4 of the clipboard work (`feature/paste-drawings-diagrams`). Steps 1–3 let Drawing
and Diagrams copy a selection as a PNG plus a clip, and let Docs and Slides paste it as a live embed
or a picture, and paste any lone picture. Notes and Sheets cannot take part yet for a simpler
reason: **neither can hold an image at all.** A note is Markdown text blocks; a spreadsheet is cells.
This doc proposes the smallest model that fixes that in each, so paste can follow.

What both inherit from Docs and Slides, unchanged:

- **Images are references, not bytes** (`lib/driveImages.ts`). A pasted or inserted picture is
  uploaded to the Attachments folder, encrypted with its own DEK, and the document stores
  `neutrino-drive:<fileId>`. Rendering resolves and decrypts.
- **`useRichPaste`** decides synchronously what a paste is (sheet selection / canvas clip / lone
  picture / leave it alone). Notes and Sheets would call it from their own paste handlers.
- **`InsertImageDialog`** is the one Insert image control.

---

## Notes: an image block

### Model

A new `BlockType`, `'image'`, holding `{ src, alt, width? }`. One image per block, block-level only —
a note's blocks are `<textarea>`s, and an inline image inside one is not something a textarea can show.

### Stored format

Standard Markdown, so the file stays readable everywhere:

```markdown
<!-- neutrino:image {"width":320} -->
![Whiteboard after the planning call](neutrino-drive:7f3c…)
```

- `![alt](src)` is what `noteMarkdown.ts` writes and `parseBlocks` reads. A line that is *only* an
  image becomes an image block; an image in the middle of a text line stays text, as today.
- Width rides in an HTML comment ahead of the block, exactly as table extras already do
  (`<!-- neutrino:table … -->`). Drop the comment and the image shows at its natural width.
- `neutrino-drive:` is not a URL any other Markdown renderer can fetch. Elsewhere the image shows as
  its alt text, which is the honest fallback. That is a reason to make alt text easy to fill in.

### Clients

- **iOS Notes** already parses Markdown images (`MarkdownParser.swift` → `.image(alt:source:title:)`).
  It needs a renderer that resolves `neutrino-drive:` through `NeutrinoCrypto`, which Docs iOS
  already does for document images. Until then it shows the Markdown source, which loses nothing.
  The round trip is safe either way, because the line is plain Markdown.
- **Search:** index the alt text (`extractNoteText`).
- **Keep import:** Keep exports attachments beside each note. With an image block they can come
  across instead of being dropped. A follow-up, not part of this work.

### Paste

`BlockRow`'s `onPaste` calls `useRichPaste` first:

- **lone picture:** upload, then insert an image block after the current one.
- **canvas clip:** **picture only** in v1. A live embed in a note would need a Markdown spelling
  for "this part of that drawing" that no other renderer understands. See open question 2.
- **sheet selection:** already pastes as text; unchanged.

### Size

Small: one block type, one row component, parse and serialize cases, paste routing, iOS renderer
follow-up. Probably one PR plus one iOS PR.

---

## Sheets: floating images

### Model

Per sheet, a list beside `charts`:

```ts
type SheetImage = {
  id: string;
  src: string;              // neutrino-drive:<fileId>
  alt: string;
  anchor: { col: number; row: number; dx: number; dy: number }; // top-left cell + offset in px
  w: number; h: number;     // px at 100% zoom
};
```

**Anchored to a cell, not to pixels.** Charts today store `x/y` in pixels from the grid's top-left
(`ChartDef`), so inserting a row above a chart leaves it over the wrong data. An image anchored to
a cell moves with it through `structuralShift.ts`, the same function every row and column
insert/delete already goes through. That is also what OOXML's `oneCellAnchor` means, so the
on-disk form and the model agree. (Moving charts to cell anchors is worth doing too, separately.)

### Stored format: the real OOXML drawing part

"A spreadsheet is an `.xlsx`, and only that." An image should be one Excel and Numbers show, not
something only Neutrino can read:

- `xl/drawings/drawing<n>.xml` with one `xdr:oneCellAnchor` + `xdr:pic` per image,
- `xl/media/image<n>.<ext>` holding the bytes,
- the sheet → drawing and drawing → media relationships, and content types.

The `neutrino-drive:` reference and alt text ride in `customXml` extras keyed by image id, as charts
do, so reopening in Neutrino restores a reference instead of re-uploading the bytes.

**The real decision here is the bytes** (open question 1). OOXML cannot reference a Drive file, so
writing a real drawing part means inlining the image into the package, and Sheets autosaves every
3 s while dirty. Two ways to keep that cheap:

- cache each image's bytes by `fileId` for the session and reuse them, so they are not re-fetched
  per save, and
- leave the `xl/media/` entries uncompressed, since PNG and JPEG are already compressed.

The alternative is reference-only (extras, no drawing part). Saves stay tiny, but Excel shows no
images, which breaks the rule above.

Today `writeXlsx` copies forward parts it does not model, images from Excel included, and iOS
Sheets does the same (`XlsxRoundTripTests.swift`). Once images are modelled, the reader must turn
existing `xl/drawings` pictures into `SheetImage`s and the writer must stop copying those parts
forward. Otherwise every image is written twice. iOS Sheets keeps copying forward until it models
images too, which stays safe because it writes the parts back unchanged.

### Rendering and editing

An overlay layer like `ChartLayer`, positioned from the anchor through the same prefix sums
`SheetGrid` uses, and using `ChartFrame`'s move and resize. Selecting an image follows the "a panel
that shows a selection follows it" rule if it gets a properties panel (alt text, size, reset).

### Collaboration

The sheets collab socket carries cell values (`Map<sheetIndex, Map<cellId, …>>`). Images need a
message of their own, `image:upsert` / `image:remove` per sheet, buffered under the same "only sync
with company" rule. Without it, a collaborator sees an image only after reopening the file.

### Paste

`useClipboard`'s paste path calls `useRichPaste` first:

- **lone picture:** upload, then place it anchored at the active cell.
- **canvas clip:** picture only in v1, same reasoning as Notes.
- **sheet selection:** unchanged; Sheets' own clipboard handles cells.

### Size

Larger than Notes: model, reader and writer for the drawing part, overlay, structural shift,
collab message, paste. Probably two PRs: model + `.xlsx` + rendering first, then paste and collab.
Then an iOS Sheets PR when it models images.

---

## Open questions

1. **Sheets bytes:** real `xl/drawings` part with inlined bytes (recommended: Excel shows the
   images, at the cost of bigger autosaves), or a reference only in extras (cheap saves, invisible
   outside Neutrino)?
2. **Live embeds outside Docs and Slides:** should a pasted Drawing or Diagrams selection ever be
   live in a note or a sheet? This doc says picture only for v1. Live would need an embed spelling
   in each format (a Markdown link with a `neutrino-drawing:` scheme; a custom anchor in extras) and
   a renderer on iOS.
3. **Notes on iOS:** render `neutrino-drive:` images in the same release, or ship the web side first
   and let iOS show the Markdown source in the meantime?
4. **Charts:** move `ChartDef` to cell anchors as part of the Sheets work, or leave it separate?
