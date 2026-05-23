# Manual Verification: E2E Encryption — Permission Revocation Cleanup

## Prerequisites

- neutrino-drive deployed with this change
- A file shared between two users (user A = owner, user B = viewer)
- User B has a `file_key_refs` row for the file

## Steps to Verify

### Happy Path — revocation removes key ref

1. As user A, upload a file; note its `file_id`
2. Share the file with user B (grant viewer role)
3. Confirm user B can download and decrypt the file
4. As user A, revoke user B's permission: `DELETE /api/v1/drive/permissions/file/{file_id}/{user_b_id}`
5. Query `file_key_refs` in the database: `SELECT * FROM file_key_refs WHERE file_id = '{file_id}' AND user_id = '{user_b_id}'`

**Expected:** Row is absent — user B's key ref was deleted on revocation.

### Edge Case — revocation still succeeds if key ref is missing

1. Revoke a permission for a file that has no `file_key_refs` row for that user
2. Expect: 200 OK, no error

### Edge Case — non-file resource revocation is unaffected

1. Revoke a folder permission
2. Confirm no attempt to delete a `file_key_refs` row (tracing log should be quiet)

## Expected Results

- `file_key_refs` row deleted atomically with permission record on file revocation
- Revocation of folder/other resources is unchanged
- Revocation succeeds even if `delete_file_key` would fail (best-effort with warning log)

## Rollback

This change has no feature flag. To roll back, redeploy the previous version.
The `file_key_refs` rows for already-revoked users are already cleaned up and do
not need restoration (re-sharing would create a new row).
