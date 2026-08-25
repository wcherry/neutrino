# Unused Backend APIs

Backend routes with no caller in the web app or any native client.

> **Method.** Routes come from the `#[get(...)]`/`#[post(...)]`-style macros in
> `src/**/api.rs`, combined with the scope each module is mounted under — *not*
> from the `#[utoipa::path(path = "...")]` annotations, which are wrong in
> places (the calendar ones omit the `/calendar` scope, and `docs::ai` carried a
> doubled `/docs`). Client usage was traced across **all** clients: `web/` and
> the six native repos — `neutrino_{docs,drive,notes,photos,sheets}_ios_mobile`
> and `neutrino_drive_mac_desktop`. Build output (`node_modules`, `.next`,
> `out/`, `storybook-static`, `dist`) is excluded.
>
> **Caveat.** Path matching cannot tell verbs apart: `GET /tasks/{id}` and
> `PATCH /tasks/{id}` look identical to a text search. Anything acted on below
> was additionally verified by reading the client method that builds the call.

Last verified: 2026-08-25, against 298 backend routes.

---

## Removed

40 routes deleted — see the commits on this branch. Five whole modules went with
them (`docs::ai`, `docs::docs`, `drive::ai`, `drive::priority`,
`drive::suggestions`); the rest lost routes while keeping the service behind
them, because something else still calls it.

| Area | Routes | Note |
|------|--------|------|
| `docs::ai` | 7 | Whole module. Took the OpenAI/Claude/Gemini provider clients with it — nothing else imported them. |
| `docs::docs` | 3 | Whole module, and the `docs` table with it. Page setup moved into the document body's `_meta` block, which retired `GET`/`PUT /docs/{id}/page-setup` — the only two routes here that ever had a caller. `GET /docs/{id}/export/text` had none, and this audit missed it: path matching found `exportText` in `packages/api-docs` and counted the route as called, but nothing in the app calls that wrapper — only four Vitest mocks name it. It was also already broken, parsing an encrypted body as Tiptap JSON and reporting every document as empty. |
| `drive::shared_drives` | 9 | Only `GET /shared-drives` survives. Create, update, delete, the whole member sub-resource, and analytics had no caller. |
| `calendar::tasks` | 7 | Task-list read/update/delete, `POST /tasks/bulk`, `GET`/`DELETE /tasks/{id}`, and `DELETE /tasks/{id}/lists/{list_id}`. |
| `drive::suggestions` | 4 | Whole module. Distinct from access requests, which are used. |
| `drive::priority` | 3 | Whole module — `quick-access`, `suggested-collaborators`, `suggested-actions`. |
| `drive::workspace` | 2 | Routes only. `WorkspaceService` stays: sharing, permissions and links all call it. |
| `photos::learning` | 2 | Routes only. `LearningService` stays: a background task calls `process_all_pending`. |
| `drive::activity` | 1 | Read route only. The service stays — `comments` writes the log through it. |
| `drive::ai` | 1 | Whole module (`catch-me-up`). |
| `drive::filesystem` | 1 | `GET /bulk/download`. |

Tables behind the deleted modules (`doc_suggestions`, and the priority/AI ones)
are left in place, as the IRM removal did with `irm_policies`. `docs` is the
exception — it held page setup and nothing else, so it is dropped in migration
00114 rather than left behind empty.

---

## Still unused, kept deliberately

### Enterprise scaffolding — 22 routes

No caller, no way to reach the feature from any client, but this reads as
roadmap work rather than abandoned code. Kept pending an explicit call.

| Area | Routes | Endpoints |
|------|--------|-----------|
| Compliance | 11 | `/admin/compliance/holds*`, `/admin/compliance/retention*` |
| Security | 7 | `/admin/security/{siem*,ransomware*,cmek}` |
| Two-factor auth | 4 | `/auth/2fa/{status,enroll,confirm,disable}` |

The 2FA response field `totpEnabled` *is* consumed — `AuthService.swift` in the
photos app decodes it — but nothing calls the four endpoints that would change
it.

### Not client-facing by design — 12 routes

These have no client caller because a client is not what calls them. Counting
them as dead would be a category error.

| Area | Routes | Why it stays |
|------|--------|--------------|
| Jobs | 6 | Worker API — `/jobs/pending`, `/jobs/workers`, thumbnail upload. Consumed by an out-of-repo job runner. |
| Photos internal | 3 | `/internal/users-with-faces`, `/internal/users/{id}/face-embeddings`, `/internal/persons/clusters` — service-to-service face clustering. |
| Service registry | 1 | `POST /internal/services/register` is the **write** side of the admin Services tab. `GET /api/v1/admin/services` reads the registry this populates; deleting it would leave that tab permanently empty. |
| OAuth | 1 | `POST /oauth/revoke` is part of the OAuth surface third-party clients rely on. |
| Calendar | 1 | `GET /calendar/connections/outlook/callback` is a provider redirect target. |

### New, not yet wired — 1 route

`GET /api/v1/drive/key-versions` ships with the key-file work and has no client
caller yet. It is the check the rotation UI is meant to make before a key is
dropped.

---

## Known false negatives

Flagged by path matching, but genuinely used — recorded so the next sweep does
not re-raise them.

| Route | Reality |
|-------|---------|
| `/auth/admin/users*` (5) | Registered *outside* the `/auth` scope, so they serve `/api/v1/admin/users*`, which `@neutrino/api-admin` calls. |
| `GET /fonts/{id}/file` | Never written by a client. The server hands out `file_url` in the font list and the web loads it through `@font-face`. |

---

## Summary

| | Routes |
|---|---|
| Backend routes | 298 |
| With a client caller | 263 |
| Unused — enterprise scaffolding | 22 |
| Unused — not client-facing by design | 12 |
| Unused — new, not yet wired | 1 |
