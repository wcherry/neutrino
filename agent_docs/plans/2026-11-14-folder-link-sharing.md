# Plan: Folder link sharing — anyone with the link can read/write, optional password (#321)

## Summary

Let a Drive owner share a folder by link so that anyone holding the link (and the password, when
one is set) can browse it, download, upload, create folders, rename, move within it and trash, with
no account. Drive is end-to-end encrypted, so the link carries a key in the URL fragment: the owner's
browser generates an X25519 **link key pair**, the server stores only the public half, and every
file's DEK in the shared subtree is sealed to it as a `file_key_refs` row for the link's subject.

Three things in today's code shape the work:

1. **Folder browsing is owner-scoped.** `find_folder`, `list_subfolders` and `list_files_in_folder`
   filter on the caller's `user_id`; uploads land in the caller's storage and quota. A guest sent to
   `/drive` sees an empty Drive. Guests therefore get **link-scoped endpoints** that act inside the
   owner's account, after the server has checked that every target, and every destination, is in
   the shared subtree.
2. **Guest grants outlive the link.** `create_guest_session` upserts a `guest:{token}` permission
   row nobody deletes. Disabling a link did not revoke an editor guest. Fixed by deriving a guest's
   role from the live `share_links` row on every request and writing no permission rows at all.
3. **Folder shares hand over no file keys.** Only single-file shares seal a DEK to the recipient.
   The link is the first folder-wide key distribution, so the server tells clients which files
   still need sealing (`unkeyed-files`) and who a new upload must be sealed to (`key-recipients`).

## Identity

- A link's **key subject** is `guest:{share_link_id}`. `file_key_refs.user_id` uses it.
- A guest **session subject** (JWT `sub`) is `guest:{share_link_id}:{session_epoch}`. The epoch is
  bumped whenever the password is set, changed or removed, which kills every session issued before.
- `PermissionsService::get_effective_role` answers a `guest:` caller from the link alone: the link
  must exist, be active and unexpired, the epoch (when present) must match, and the resource must be
  the linked resource or inside it. Otherwise `None`. A guest never gets `owner`, so every
  owner-only endpoint (share links, permissions) refuses them.
- `EncryptionService` maps a session subject to its key subject for `get`/`set`/`share`.
- The `guest:` prefix is kept so `/auth/me` and friends keep recognising guests. Old
  `guest:{token}` subjects resolve to no link and get nothing.

## Affected Repos

- `neutrino` — migration, backend (sharing, permissions, encryption, storage upload refactor, new
  link-folder API), web (Share dialog, `/share` guest folder browser, uploads sealing to link keys),
  e2e.
- Later (separate PRs, same branch name): `neutrino_shared_ios`, `neutrino_shared_android`,
  `neutrino_drive_windows_desktop`, `neutrino_drive_mac_desktop` — seal new uploads into a
  link-shared folder to `key-recipients`. Until then, files they add are invisible through the link
  until the owner's browser tops up via `unkeyed-files` (the Share dialog does this on open).

## Tasks

### Backend
1. Migration `00155_drive__2026-11-14-000000_share_link_passwords_and_keys`:
   `share_links.password_hash`, `share_links.session_epoch`, `share_links.public_key`,
   `share_links.sealed_seed` + `sealed_seed_key_version` (the link seed sealed to the owner, so the
   owner's browser can rebuild the full URL to copy it again — the server never sees a fragment);
   delete stale `permissions` rows whose `user_id LIKE 'guest:%'`; seed flag `folderLinkEditing`.
   Update `schema.rs`, `ShareLinkRecord`, `NewShareLinkRecord`, `UpdateShareLinkRecord`.
2. Flag `folderLinkEditing` in `feature_flags/catalog.rs` and `web/apps/web/src/lib/featureFlags.ts`.
3. `sharing/dto.rs`: `password` + `publicKey` on upsert/patch; `hasPassword`, `publicKey`,
   `keySubject` on `ShareLinkResponse`; `passwordRequired` on resolve (details withheld while
   locked); `CreateGuestSessionRequest { password }`; richer `GuestSessionResponse`.
4. `sharing/service.rs`: Argon2id hashing; epoch bump on password change; drop key refs on
   replace/delete; password check + in-memory attempt limiter on `create_guest_session`; guest
   token with a real 1 h TTL; no permission writes; `guest_link()` for the link-folder API;
   `key_recipients()`; `unkeyed_files()`.
5. `permissions/service.rs`: guest branch in `get_effective_role`.
6. `encryption/service.rs`: key-subject mapping.
7. `storage/api.rs`: pull the multipart body of `upload_file` into `receive_upload(state, owner,
   payload, authorize_folder)` so the guest upload reuses it unchanged.
8. New `drive/link_folders/` (guest JWT, flag-gated): contents, create folder, upload, rename/move
   file and folder, trash file and folder — all as the folder owner, all subtree-checked.
9. `share/{token}/download|preview`: when a password is set, require a guest session for the link.

### Web
10. Share dialog (folders): generate link key pair, store public key, copy link with `#k=`,
    password set/change/remove, top up `unkeyed-files`.
11. Upload path: seal new DEKs to `key-recipients` for the destination folder.
12. `/share` guest folder browser: password prompt, scoped listing, download/preview with
    decryption, upload/new folder/rename/move/trash for editors, "incomplete link" error.

## Test Plan

- Unit (Rust, inline):
  - sharing service: password set/verify/wrong → 401, limiter → 429, epoch bump invalidates
    sessions, resolve withholds details while locked, delete/replace removes key refs.
  - permissions: guest role inside subtree, none outside, none when disabled/expired/epoch stale,
    never `owner`.
  - encryption: guest session subject reads and writes the link's key ref.
  - link_folders: listing, upload into subtree, refusal outside subtree, cannot rename/trash root,
    move destination outside subtree refused, viewer cannot write, flag off → 404.
- E2E (`e2e/tests/drive/folder-link-sharing.spec.ts`): owner creates editor link with password →
  fresh context opens link → password → uploads a file → owner sees it decrypted; disable link →
  guest's next request is refused.

## Feature Flag

`folderLinkEditing` (DB flag, default **off**). Gates the guest link-folder API (task 8) and, on the
web, the folder link UI that mints a link key. Rationale: a new anonymous write path into a user's
Drive and a new key-distribution path; the native clients that must seal to link keys ship on
different schedules. The security fixes (no stale guest grants, password support, 1 h guest TTL)
are **not** gated. Removal: once folder links have run enabled for a release cycle with every
client sealing to `key-recipients`.

## Open Questions

- Password-bound link key (wrap the fragment secret with an Argon2id key from the password) — left
  for a follow-up; v1 checks the password server-side only.
- Attempt limiting is per process and per token; a multi-instance deployment needs a shared store.
- Pre-existing, not fixed here: `POST /drive/files/upload` accepts any `folder_id` without checking
  the caller may write to it.
