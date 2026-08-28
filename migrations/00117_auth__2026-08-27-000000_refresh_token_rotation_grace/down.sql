-- Drop the rotation grace column.
--
-- Any row still carrying a `rotated_at` is a spent token that the grace window
-- would have refused anyway, so they go with the column: without it the code
-- cannot tell a spent token from a live one, and keeping them would leave
-- every one of them valid until it expired.

DELETE FROM refresh_tokens WHERE rotated_at IS NOT NULL;

ALTER TABLE refresh_tokens DROP COLUMN rotated_at;
