-- Drop the feature flags table.
--
-- Every gate that read these keys is gone: each one has been collapsed to the
-- branch it took when the flag was enabled, so the features they guarded are
-- now unconditional. With no reader left, the rows are state nothing consults
-- and an admin toggling one would change nothing -- worse than useless, since
-- the panel would imply otherwise. The admin panel's Feature Flags tab, the
-- `/api/v1/feature-flags` endpoint and its admin counterpart go with it.
--
-- The four keys the type declared but the table never held -- docsPresence,
-- docsTrackChanges, docsCompare, docsMobileEditor -- were read as `undefined`
-- and so were permanently off; they were collapsed the same way as the rest.

DROP TABLE IF EXISTS feature_flags;
