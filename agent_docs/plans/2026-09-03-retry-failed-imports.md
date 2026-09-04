# Plan: Retry a failed Takeout import item

## Summary

A Takeout import writes thousands of files one at a time, over an E2EE path that can fail per
item — an expired session, a 413, a file the browser could not decode. Today the result screen
lists what failed and stops there: the only recovery is re-running the whole archive, which for a
photo library means re-uploading tens of thousands of files to recover three. This adds **Retry**
on each failed row and **Retry all** above the list (issue #155), re-running just those items
through the same steps and merging the outcome back into the result screen, so the counts stay
those of the whole import rather than of the last attempt.

## Affected Repos

- `neutrino` — web only (`web/apps/web/src/components/ImportRun/`, `src/app/(apps)/import/`).
  No backend change: a retry is the same client-side write path the first attempt used, so no
  handler, DTO or migration is touched, and the six iOS apps and the macOS client are unaffected.

## Design

Three things have to be true for a retry to be possible, and each is one change.

1. **The archive has to still be open.** The provider closes the zip reader when the run ends,
   which is right for a clean run and fatal for a retry — the bytes to re-upload are in that zip.
   So the close becomes conditional: a run that finished with **no** failed items closes the
   archive exactly as it does now, and a run that has something to retry keeps it open, until the
   run is dismissed (the page's "Import another archive"/reset) or another run starts. The reader
   is held open only in the case where the user can still act on it.

2. **A step has to be runnable over a subset.** `ImportStep.run` gains an optional
   `only?: ReadonlySet<string>` of file paths. The page's step closures do the filtering, because
   they are what hold the source lists; every runner already reports `file` as `entry.path`, so
   that is the key on both sides. The runners themselves are untouched.

3. **The results have to merge, not replace.** A retry of 3 items out of 5,000 must not leave the
   screen reading "3 imported". The provider merges each retried product's summary into the one it
   already had: items are replaced by `file`, the counts are recomputed from the merged item list,
   and `total` stays the original total.

`retry(targets)` lives on the provider next to `start`, for the same reason the run does: the
result screen is reachable after a route change, so the plan and its archive cannot live on the
page. The provider stays product-ignorant — it groups the targets by product label and re-runs the
steps it already holds.

The page keeps the one thing it already owns: the "can this device encrypt?" check runs before a
retry as it does before a first import, so a retry with a locked vault declines up front instead
of failing every item a second time.

## Tasks

1. `components/ImportRun/ImportRunProvider.tsx` — add `only` to `ImportStep.run`; extract the run
   loop into a `launch(plan, legs, previous)` helper shared by `start` and `retry`; make the
   archive close conditional on there being nothing to retry, and close it on `dismiss`/`start`;
   add `retryable` to the `done` state and `retry()` to the context.
2. `components/ImportRun/mergeResults.ts` — the summary merge, as a pure function with its own
   tests.
3. `app/(apps)/import/page.tsx` — thread `only` through the five step closures; add Retry per
   failed row and Retry all above the list, both behind the encryption check.
4. `app/(apps)/import/page.module.css` — styles for the two new controls.
5. `web/CLAUDE.md` — the archive-lifetime rule changes; update the paragraph that states it.

## Test Plan

- Unit (`web/apps/web/src/__tests__/takeout/`):
  - `mergeResults.test.ts` — a retried item replaces its old row; untouched rows survive; counts
    and `total` are recomputed from the merged list; `cancelled`/`unencrypted` stay sticky.
  - `importRetry.test.tsx` (provider) — retry re-runs only the products named, with only the files
    named; progress totals count the retried items; the archive stays open while something is
    retryable and closes when nothing is; a retry while a run is going is ignored.
  - `ImportPage.test.tsx` — the failed list offers Retry and Retry all; a retry passes the failed
    file through to the runner; a locked vault declines it; a successful retry clears the row and
    updates the counts.
- E2E: none. The Takeout suite has no e2e coverage at all and cannot easily gain it here — the flow
  needs a real multi-part Takeout zip and an unlocked key vault in the browser, and the failure
  being retried has to be induced mid-run. The full suite is run unchanged as a regression check.

## Feature Flag

None. `web/CLAUDE.md` records that the web app has no flag system by design, and this is a
self-contained change behind existing UI — the way to disable it is to revert it.

## Open Questions

None blocking. Noted for the PR: a retry re-runs the item from the start, so an item that failed
half-way (a note created, its body not written) can leave the first attempt's empty file behind.
Each product's "Skip … whose title already exists" option is what covers this today, and cleaning
up a partial write is a separate change to the runners.
