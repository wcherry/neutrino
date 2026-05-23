# Plan: E2E Encryption — Permission Revocation Cleanup

## What is changing and why

When a user's permission on a file is revoked, they should immediately lose the
ability to decrypt that file. Previously, `revoke_permission` deleted the ACL
row but left the `file_key_refs` row intact, meaning the revoked user still held
an encrypted copy of the DEK.

This change wires `EncryptionRepository` into `PermissionsService` so that
revocation atomically removes the `file_key_ref`.

## Layers affected

- **Backend (Rust):** `src/permissions/service.rs`, `src/main.rs`

## Changes

### `src/permissions/service.rs`
- Add `encryption: Arc<EncryptionRepository>` field
- Import `crate::encryption::repository::EncryptionRepository`
- Update `PermissionsService::new` to accept the new field
- After `self.repo.delete_permission(...)` in `revoke_permission`, call
  `self.encryption.delete_file_key(resource_id, target_user_id)` when
  `resource_type == "file"`. Failure is a warning, not an error (best-effort)

### `src/main.rs`
- Pass `encryption_repo.clone()` to `PermissionsService::new`
- Note: `encryption_repo` is created later in the file than `permissions_service`;
  the order must be rewritten so `encryption_repo` is created before
  `permissions_service`

## Feature flag

No feature flag required — this is a security cleanup that must always be active
once deployed. The encryption module itself is already live.

## Known risks / edge cases

- `delete_file_key` is best-effort (warn on failure) to avoid breaking
  permission revocation if the encryption table has an issue
- The `encryption_repo` Arc is shared between `EncryptionService` and
  `PermissionsService`; both are read-only consumers of the repo so sharing is
  safe

## Acceptance criteria

- `cargo build` succeeds
- Revoking a file permission calls `delete_file_key` on `EncryptionRepository`
- `revoke_permission` still returns Ok even if `delete_file_key` fails
