# Plan: Docs Layout & Structure (Feature Gap #1)

## Branch
`feature/docs-layout-structure`

## What is changing and why

Neutrino Docs lacks Word/Google Docs-level document layout primitives. This plan implements
the five sub-features listed under Feature Gap #1:

1. **Headers, footers, and page numbering** — persistent header/footer zones rendered above and
   below each page-break line; page-number placeholder `{{page}}` is substituted when printing
   or exporting.
2. **Footnotes/endnotes and cross-references** — inline footnote markers with numbered
   footnote list rendered at the bottom of the page.  Cross-references link to any heading by
   `data-anchor` attribute.
3. **Table of contents generation** — TipTap extension that scans the document for headings
   and renders a live, auto-updating TOC block.
4. **Section breaks and multi-column layouts** — a TipTap block node that acts as a page/
   section break, plus a two- or three-column layout node wrapping arbitrary content.
5. **Page backgrounds, document themes, and watermarks** — CSS-driven background color/image
   and a semi-transparent watermark text overlay on the page.

## Layers affected

- **Frontend only** (no new backend routes required).
  - New TipTap extension files under `apps/web/src/lib/`.
  - Updates to `DocEditor.tsx` (state, new Insert menu actions, feature-flag guard).
  - Updates to `MenuBar.tsx` (Insert sub-menu entries).
  - Updates to `Toolbar.tsx` (optional: Insert group additions).
  - New CSS in `page.module.css` for header/footer zones, watermark, column layout.
  - New modal components for watermark/background settings and header/footer edit.
  - `featureFlags.ts` — new flag `docsLayoutStructure`.

## Specialist agents used

- `frontend-developer` — TipTap extensions, DocEditor state changes, new modal components,
  MenuBar/Toolbar integration.
- `ui-designer` — CSS for header/footer zones, column layout, watermark, TOC styling.
- `test-writer` — unit tests for the TOC builder, footnote numbering, column extension, and
  header/footer state.

## Feature flag

- **Name:** `feature.docs.layout-structure`
- **Env var:** `NEXT_PUBLIC_FEATURE_DOCS_LAYOUT_STRUCTURE`
- **Default:** off in all environments.
- **Guard location:** DocEditor.tsx and new modal components.

## Feasibility notes

| Sub-feature | Approach | Fidelity |
|---|---|---|
| Headers/footers | React overlay divs inside page; state persisted in doc JSON under a `_meta` key | Full for screen + print CSS |
| Page numbering | `{{page}}` token replaced at print-time by JS counter | Print only; live preview shows token |
| Footnotes | Custom TipTap inline node; renders footnote list at end of page div | Full |
| Cross-references | Custom `crossRef` mark linking to `data-anchor` heading IDs | Full |
| TOC | Custom TipTap node with `ReactNodeViewRenderer`; reads heading nodes on each render | Full (auto-updates) |
| Section/page breaks | Custom TipTap block node renders a visible divider line | Full |
| Multi-column | Custom TipTap block node wrapping child content; CSS columns | Full for 2-col and 3-col |
| Page background color | CSS variable override on `.page` element; stored in doc `_meta` | Full |
| Watermark text | `::before` overlay on `.page` with rotation and opacity | Full |
| Document themes | CSS variable overrides; 4 built-in themes | Full |

## Known risks / edge cases

- TOC updates on every editor transaction — throttled with `useDeferredValue` to avoid jank.
- Footnote numbering resets on every render pass; relies on stable `pos` ordering.
- Multi-column layouts don't print reliably in all browsers — CSS `column-count` is used.
- Header/footer content is stored outside ProseMirror (in React state) and serialised into
  the doc JSON `_meta` blob; not part of the collaborative Yjs document model.
- `{{page}}` substitution happens client-side in `printDoc`; PDF export via browser print
  dialog inherits the substitution but real page-aware numbering is not possible without
  a headless renderer.

## Acceptance criteria

- [ ] User can enable/disable the feature via `NEXT_PUBLIC_FEATURE_DOCS_LAYOUT_STRUCTURE=true`.
- [ ] Header and footer text can be typed and persists across saves/reloads.
- [ ] Page number placeholder `{{page}}` appears as `1`, `2`, … when printing.
- [ ] A footnote can be inserted at cursor; appears numbered at bottom of page.
- [ ] Cross-reference can be inserted; clicking it scrolls to the heading.
- [ ] TOC block can be inserted from Insert menu; auto-updates when headings change.
- [ ] Section break inserts a visible page-break marker.
- [ ] Two-column and three-column layout blocks can be inserted and typed in.
- [ ] Document theme can be changed from a modal (4 themes).
- [ ] Watermark text can be set; renders as faded diagonal text.
- [ ] Background colour can be set on the page.
- [ ] All tests pass.
