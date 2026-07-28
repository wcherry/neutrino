# Plan: Add native app kinds to `DriveFileType`

Branch: `feature/drive-file-type-native-apps`

## What is changing and why

`DriveFileType` (`src/drive/filesystem/dto.rs:106-132`) filters Drive's flat
file listing (`GET /api/v1/drive?type=...`) by MIME type via
`mime_patterns()`, consumed by `FilesystemService::get_typed_contents`
(`src/drive/filesystem/service.rs:343-351`). It has 4 variants today —
`Photo`, `Video`, `Audio`, `Document` — none of which match this monorepo's
own native app file types, each of which uses a custom
`application/x-neutrino-*` MIME type assigned in its own `service.rs` at
`create_file` time:

| App | MIME value |
|---|---|
| Docs | `application/x-neutrino-doc` |
| Sheets | `application/x-neutrino-sheet` |
| Slides | `application/x-neutrino-slide` |
| Diagrams | `application/x-neutrino-diagram` |
| Drawing | `application/x-neutrino-drawing` |
| Notes | `application/x-neutrino-note` |

`Document`'s `application/vnd.%` wildcard does not catch these because the
namespace is `application/x-neutrino-*`, not `application/vnd.*`. This means
the typed-listing filter is unusable for any native document type today.

Per existing frontend convention (`routeForFile.ts`, `file-icons.ts`,
`DocumentPreviewModal`'s `DocumentKind`), each native app is already treated
as its own first-class kind elsewhere in the codebase — so we add 6 new
`DriveFileType` variants (`Doc`, `Sheet`, `Slide`, `Diagram`, `Drawing`,
`Note`) rather than folding them into `Document`.

## Layers affected

- **Backend (Rust)**: `src/drive/filesystem/dto.rs` (enum + `mime_patterns`),
  `src/drive/filesystem/api.rs` (OpenAPI doc comment on the `type` query
  param). `service.rs`'s `get_typed_contents` needs no change — it's already
  generic over `DriveFileType`.
- **Frontend (type mirror only)**: `web/packages/api-drive/src/types.ts:25` —
  add the 6 new string literals to the `DriveFileType` union. Confirmed via
  prior research: no UI call site anywhere sets `type:` on a list query today,
  so this is a type-only mirror change. No filter UI is being built — out of
  scope.
- **Tests**: extend existing Rust unit tests.
  - `src/drive/filesystem/dto.rs`'s `mod tests` — extend `mime_patterns()`
    coverage to all 10 variants (currently only spot-checks `Document`).
  - `src/drive/filesystem/repository.rs`'s `mod tests` — this module already
    exercises `list_files_by_mime`/`DriveFileType` end-to-end against an
    in-memory SQLite repo (`test_repo()`, `seed()`). Extend `seed()` with one
    native-app-mimed file (e.g. a Doc) and add a test asserting `type=doc`
    returns it while `type=sheet` does not. No dedicated `get_typed_contents`
    service-level or HTTP-level test exists today, so no new test harness is
    needed beyond this repository-level one.

## Specialists needed

- `rust-developer`: enum variants, `mime_patterns` match arms, OpenAPI doc
  comment update.
- `test-writer`: extend the two Rust unit test modules above.
- Frontend TS type mirror is a single trivial line in a shared types file
  with no logic — will delegate to `frontend-developer` for consistency
  with the "specialists write all code" policy, run in parallel with the
  Rust work since the two are independent.
- No `ui-designer` work — no visual/UI change.

## Note: not doing TDD red-phase blocking here

This is an additive, mechanical change (new enum variants + match arms, no
behavior change to existing variants). Per the task, `test-writer` will
extend the *existing* test modules in the same pass as the variant additions
rather than a strict separate red/green phase — there's no meaningful "write
failing tests first" step when the variants themselves don't exist yet to
reference (the enum wouldn't compile with tests referencing `DriveFileType::Doc`
before the variant is added). Rust and test changes will be delegated
together to `rust-developer`, who will also update the existing test files
so they compile and pass with the extended enum, then reviewed by me before
handing to `test-writer` to add the *new* coverage on top. Both the enum
change and its tests land as part of the same backend delegation for
compile-ordering reasons; test-writer will still independently review/extend
coverage afterward.

## Known risks / edge cases

- Serde `rename_all = "camelCase"` on single lowercase words (`doc`, `sheet`,
  etc.) — confirmed these serialize identically to hardcoding the string, so
  letting serde handle it is fine and consistent with the existing variants.
- Must not touch each app's separate `OFFICE_MIME_TYPE`/`XLSX_MIME`/etc.
  constants (transient promotion-of-raw-upload types) — those already match
  `application/vnd.%` under `Document` and are a different concept.
- Must not touch `feature/custom-themes` branch/working tree (another agent
  is mid-verification there) — working in an isolated worktree branched from
  `main` only.
- Out of scope, flagged only: `application/x-neutrino-note` is missing from
  `routeForFile.ts`/`file-icons.ts`'s per-app maps, so Notes files opened from
  the Drive grid fall through to a generic preview. Pre-existing, unrelated
  to `DriveFileType` — not fixing here.

## Acceptance criteria

- [ ] `DriveFileType` has 10 variants: `Photo`, `Video`, `Audio`, `Document`,
      `Doc`, `Sheet`, `Slide`, `Diagram`, `Drawing`, `Note`.
- [ ] Each new variant's `mime_patterns()` returns exactly its own MIME
      string (no wildcard).
- [ ] `api.rs`'s `type` query param doc comment lists all 10 values.
- [ ] `web/packages/api-drive/src/types.ts`'s `DriveFileType` union mirrors
      all 10 values.
- [ ] `cargo test` passes, including new/extended unit tests covering all 10
      variants' `mime_patterns()` and a repository-level test proving a
      native-app-mimed file is returned for its own type and excluded for a
      different native-app type.
- [ ] `cargo build` succeeds.
- [ ] `pnpm type-check` (frontend) succeeds.
- [ ] No changes to `feature/custom-themes` or any file outside this task's
      scope.
