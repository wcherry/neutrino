-- Drop the table again, returning to the state 00124 left.
--
-- Rolling back past this point means rolling back Team Spaces too: with no
-- table, `/api/v1/feature-flags` has nothing to serve and every team route
-- reads its gate as absent. That is the intended shape of the rollback -- the
-- gates fail closed, so the application is the one that shipped before #185.
DROP TABLE IF EXISTS feature_flags;
