# Manual Verification: Friendly date on the large icon (issue #69)

Replaces the verification steps for issue #155, which has shipped (commit `4915570`).

## Prerequisites
- Stack running locally: `cargo dev` (or the `docker-compose-dev.yml` stack)
- A signed-in account with a few files in Drive and at least one document or note

## Steps

### Happy Path
1. Open http://localhost:3000/drive and stay in the **Large grid** view (the leftmost of the
   three view buttons).
2. Create or edit a file so it has just been touched. Its card's meta line reads
   `<size> · Just now`.
3. Wait a couple of minutes and reload. It reads `2 minutes ago`, then `An hour ago` and
   `N hours ago` as the day goes on.
4. Hover the meta line. The tooltip shows the exact date and time.
5. Switch to **Detailed list**. The Modified column still shows an absolute date
   (`Jan 5, 2026`) — the friendly wording is the card's, not the column's.

### Edge Cases
1. **Yesterday and the week**: a file last changed yesterday reads `Yesterday`; one from
   earlier this week reads by weekday (`Monday` … `Sunday`). To check without waiting, edit a
   file, then in `psql` run
   `UPDATE files SET updated_at = NOW() - INTERVAL '3 days' WHERE name = '<file>';` and reload.
   The same trick with `'10 days'` gives `A week ago`, `'20 days'` gives `2 weeks ago`,
   `'40 days'` gives `A month ago`, `'400 days'` gives `A year ago`.
2. **Late last night**: a file changed at 11pm shows `Yesterday` the next morning, not
   `10 hours ago` — the day buckets are calendar comparisons.
3. **Office suite and Notes**: open `/docs`, `/sheets`, `/slides`, `/drawing` and `/notes`.
   Each card shows the friendly date alone (the absolute date these used to show as a subtitle
   is gone; the icon already says what the item is).
4. **Trash**: `/drive/trash` cards read `Deleted · Yesterday` — the date is when the item was
   deleted, as the Modified column there already was.
5. **Search**: search from the topbar and open the Drive results view (`/drive?q=…`). Hits
   carry the same friendly date; a hit with no known date shows just its subtitle.
6. **Small grid**: unchanged — no date, there is no room for one.

## Cleanup
Delete VERIFY.md once the feature is proven stable.
