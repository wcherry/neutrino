-- Index the photo listing so paging it does not re-sort the library per request.
--
-- `photos` had no index at all. That was survivable while the listing was one
-- unbounded request: SQLite scanned the user's rows and sorted them once, and
-- the client got everything. Paging changes the arithmetic rather than the
-- plan — the sort is now per *page*, so walking a 25,000-photo library at 200 a
-- time re-scans and re-sorts the same rows 125 times to return 200 of them
-- each. The work is quadratic in the size of the library for a walk that used
-- to be linear.
--
-- Two indexes because the listing now has two orders and an index serves
-- exactly the one it was built for. `created_at` is the default and what the
-- web client and every existing caller page along; the `COALESCE` expression is
-- what the iOS timeline pages along, because that client displays photos by
-- when they were taken and `LIMIT`/`OFFSET` cuts along whatever `ORDER BY`
-- sorted. Both carry `id` as the final column for the same reason the query
-- names it: it is the tie-break that makes the order total, and an index that
-- stopped short of it would leave SQLite sorting the ties it could not resolve.
--
-- `user_id` leads both: every listing filters on it, so it is what turns a scan
-- of the table into a scan of one account's slice of it. `deleted_at` is in the
-- filter too but deliberately not in either index — trashed rows are a small
-- minority, and carrying the column would widen every entry to save a residual
-- check on a few of them.

CREATE INDEX IF NOT EXISTS idx_photos_user_created_id
    ON photos (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_photos_user_capture_id
    ON photos (user_id, COALESCE(capture_date, created_at) DESC, id DESC);
