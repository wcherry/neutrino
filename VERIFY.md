# Manual Verification: Retry a failed import (issue #155)

Replaces the verification steps for issue #60, which has shipped (commit `64e9446`).

## Prerequisites
- Stack running locally: `cargo dev` (or the `docker-compose-dev.yml` stack)
- A signed-in account with end-to-end encryption set up and unlocked
- A Google Takeout `.zip` with at least a few notes, documents or photos in it

Failures are the point of this feature and they do not happen on demand, so the reliable way to
induce one is in the browser: open DevTools → Network and add a **request blocking** rule, or use
the Network conditions panel to go offline for a moment mid-run. Blocking
`*/api/v1/drive/files/*/content*` fails items at the upload step while leaving the rest of the
run working.

## Steps

### Happy Path — retry one file, then the rest

1. Open http://localhost:9880/import and drop the archive in.
2. Choose the products to bring across and press **Import**.
3. While the progress bar is going, block the request pattern above (or toggle offline briefly)
   so a handful of items fail, then unblock it and let the run finish.
4. The result screen reads `N imported · M skipped · K failed` and the **Failed** list shows the
   failures, each with the reason (`HTTP 500: …`, `Failed to fetch`, …).
5. Confirm the list's bar now has **Retry all K failed**, and every row has its own **Retry**.
6. Press **Retry** on one row. The progress bar comes back reading **Importing 1 of 1**, and when
   it finishes:
   - that row is gone from the Failed list,
   - the counts have moved by one — `N+1 imported · … · K−1 failed`, still counting the whole
     import and not just the retry,
   - every other failed row is still listed, with its own reason.
7. Press **Retry all**. The bar counts the remaining failures only. When it finishes the Failed
   list is gone, the counts add up to the whole archive, and no Retry button remains.
8. Open the destination app (Notes, Docs, Photos, …) and confirm the retried items are actually
   there, once each.

### Edge Cases

1. **It fails again**: keep the blocking rule on and press Retry. The row stays on the list with
   the *new* reason, the counts do not move, and Retry is still offered.
2. **Retry across products**: induce failures in two products (e.g. notes and photos) and press
   Retry all — both products run again, each over its own failed files only, and the console log
   reads `[takeout:page] retrying { steps: [ 'Notes (1)', 'Photos (2)' ] }`.
3. **The run survives a route change**: with failures on screen, switch to Drive and back to
   `/import`. The result screen and its Retry buttons are still there, and a retry from it still
   works — the archive is held open for exactly this.
4. **A clean run releases the archive**: run an import with no failures. There is no Failed list
   and no Retry, and the console reads `[takeout:archive] reader closed for …` as the run ends —
   the zip reader is not held open when there is nothing to retry.
5. **Locked vault**: lock the keys (Settings → Security) after a run with failures, then press
   Retry all. Nothing runs and the encryption warning toast appears — the same answer pressing
   Import gives.
6. **Dismiss releases it**: with failures on screen press **Import another archive**. The page
   goes back to the file picker and the console reports the reader closing.
7. **Stopped run**: press **Stop** mid-import, then retry one of the items that failed before the
   stop. The retry runs, and the screen still says **Import stopped** — the items the run never
   reached are still unimported.

## Cleanup
Delete VERIFY.md once the change is proven stable.
