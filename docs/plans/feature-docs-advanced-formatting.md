# Implementation Plan: Advanced Formatting & Styles (Feature Gap #2)

## Branch
`feature/docs-advanced-formatting`

## Feature flag
`NEXT_PUBLIC_FEATURE_DOCS_ADVANCED_FORMATTING` (default: off)

---

## What is changing and why

Feature gap #2 adds Microsoft Word / Google Docs-level formatting controls to Neutrino Docs.
The existing TipTap editor already has bold/italic/underline, text color, font family/size,
headings, lists, tables, and images. This gap adds the "next tier" of formatting that power
users expect.

---

## Scope

### 1. Superscript / Subscript
- Add `@tiptap/extension-subscript` and `@tiptap/extension-superscript` (available in the
  TipTap core extension set; no new package needed — use the built-in `Subscript` and
  `Superscript` nodes that ship with StarterKit extra deps).
- NOTE: StarterKit 2.x does NOT include sub/superscript by default. We implement these
  as custom TextStyle marks that wrap `<sub>` / `<sup>` tags, avoiding extra package
  installs.

### 2. Text-case controls
- Transform selected text to: UPPERCASE, lowercase, Title Case, Sentence case.
- Implemented as pure JS transforms on the current selection (no new TipTap extension
  needed — just `.insertContent()` with transformed text).

### 3. Indent / Outdent
- Paragraph indent via `margin-left` attribute on `LineParagraph`.
- List level increase/decrease via `sinkListItem` / `liftListItem` TipTap commands.
- Toolbar buttons and keyboard shortcut (Tab/Shift+Tab for lists, dedicated indent
  buttons for paragraphs).

### 4. Richer list formatting (list style types)
- Extend the existing `bulletList` node to support `listStyleType` attribute
  (disc, circle, square, none).
- Extend the existing `orderedList` node to support `listStyleType` attribute
  (decimal, lower-alpha, upper-alpha, lower-roman, upper-roman).
- A small dropdown in the toolbar when a list is active.

### 5. Named paragraph styles
- A "Styles" modal / palette that applies predefined named styles:
  Normal, Title, Subtitle, Heading 1–6, Quote, Code Block, Caption.
- Styles set font-size, font-weight, color, and node type simultaneously.
- Uses existing `LineParagraph` attributes + heading levels.

### 6. Advanced table formatting
- Cell background color (via extended `TableCell` attrs).
- Cell border controls: border width + color per cell.
- Column width enforcement.
- New "Table properties" modal shown when cursor is in a table.

### 7. Better image support
- Local file upload (reads file as base64 data URL; stored inline — no backend upload).
- Image attributes modal: width, height, alignment (left/center/right/float-left/
  float-right), alt text, caption.
- Image caption is an additional paragraph node rendered below the image.
- Custom `ImageExtension` that extends TipTap's built-in Image node with extra attrs.

---

## Layers affected

| Layer | What changes |
|---|---|
| Extensions | `SubSuperExtension.ts`, `IndentExtension.ts`, `ListStyleExtension.ts`, `AdvancedTableCellExtension.ts`, `AdvancedImageExtension.ts` |
| Toolbar | `Toolbar.tsx` — new buttons gated by flag |
| MenuBar | `MenuBar.tsx` — Format submenu additions |
| CSS | `page.module.css` — styles for sub/sup, indent, list bullets, image float/caption |
| Feature flags | `featureFlags.ts` — new `docsAdvancedFormatting` flag |
| Tests | Unit tests for all extensions + modal rendering |

---

## Acceptance criteria

- [ ] Superscript and subscript buttons appear in toolbar (flag on), apply/remove correctly
- [ ] Text-case dropdown transforms selected text correctly (all 4 modes)
- [ ] Indent/outdent buttons in toolbar; Tab/Shift+Tab in lists
- [ ] Bullet list style dropdown: disc/circle/square
- [ ] Ordered list style dropdown: 1/a/A/i/I
- [ ] Paragraph styles palette modal (Styles button in toolbar)
- [ ] Table cell background color picker in table toolbar
- [ ] Image: local upload button replaces URL prompt; alignment controls; alt text; caption
- [ ] All features are inert when `NEXT_PUBLIC_FEATURE_DOCS_ADVANCED_FORMATTING=false`
- [ ] Existing documents load without error whether flag is on or off

---

## Known risks / edge cases

- Base64 images can bloat document JSON significantly for large photos. Left as TODO
  for a backend upload solution.
- Table cell border controls require extending `TableCell` — may interact with the
  existing `resizable: true` table setting.
- Text-case transforms operate on the plain text of the selection; marks (bold, color,
  etc.) are preserved by inserting content node-by-node.
- Subscript/superscript clash: applying superscript when subscript is active should
  remove subscript first (handled by extension logic).
