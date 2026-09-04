# Plan: Friendly last-modified date on the large icon card

## Summary
The Large grid card in `FileGrid` shows a name and a subtitle (a file size, "Folder", or — for
the office-suite and notes libraries — an absolute date like "Jan 1, 2026"). Issue #69 asks for
the last update time to read as a friendly, relative date instead: "Just now", "An hour ago",
"Yesterday", "Monday", "A week ago", "A month ago". This adds one `formatFriendlyDate` helper to
`@neutrino/utils`, an `updatedAt` field to `GridItem`, and a second muted line on the large card
that renders it. The Detailed list keeps its absolute `Modified` column — a column you sort and
compare on wants a real date — so the change is confined to the large card.

## Affected Repos
- `neutrino` (web only) — `packages/utils`, `packages/ui`, and the four places that build
  `GridItem`s. No backend, no other client: `updatedAt` is already in every listing response.

## Tasks
1. `web/packages/utils/src/index.ts` — add `formatFriendlyDate(value, now?)`, covering the
   buckets in the issue plus weeks/months/years, and falling back to an absolute date for a
   timestamp meaningfully in the future.
2. `web/packages/utils/src/__tests__/index.test.ts` — unit tests for every bucket boundary.
3. `web/packages/ui/package.json` — depend on `@neutrino/utils` (pure, no API deps, so the
   layering rule for `@neutrino/ui` still holds).
4. `web/packages/ui/src/components/display/FileGrid.tsx` — add `updatedAt?: string` to
   `GridItem`; render `formatFriendlyDate(item.updatedAt)` as a muted line in the large card
   body, with a `title` carrying the absolute date.
5. `web/packages/ui/src/components/display/FileGrid.module.css` — style the new line.
6. `web/apps/web/src/app/(apps)/drive/gridItems.ts` — set `updatedAt` on file and folder items;
   Trash items pass `deletedAt` and lose the now-duplicated date from their subtitle.
7. `web/apps/web/src/app/(apps)/DocumentLibrary.tsx` and `notes/page.tsx` — drop the absolute
   date subtitle (the card now carries the date itself) and pass `updatedAt`.
8. `web/apps/web/src/app/(apps)/drive/page.tsx` — search hits carry `updatedAt` as epoch ms;
   convert to ISO.
9. `web/packages/ui/src/stories/FileGrid.stories.tsx` — sample items get `updatedAt`.

## Test Plan
- Unit: `formatFriendlyDate` against a frozen `now` for each bucket and its boundaries;
  `FileGrid` renders the friendly date on the large card and not in place of the list view's
  Modified column.
- E2E: covered by the existing Drive and office-suite specs, which assert on file names rather
  than on the subtitle; no new spec — the change is presentational.

## Open Questions
None.
