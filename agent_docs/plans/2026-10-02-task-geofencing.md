# Plan: Task geofencing — server, web and E2EE envelope

Issue #243. The iOS half is wcherry/neutrino_calendar_ios_mobile#23 (branch `feature/task-geofencing`,
already built against this contract). Full spec: the calendar repo's `agent_docs/task-geofencing.md`.

## Summary

Saved places, stored as ciphertext only (`task_places.encrypted_payload`, a v1 `PlaceEnvelope`
built from the Drive primitives), and an arrival geofence on tasks: a saved place
(`tasks.geo_place_id`) or a plaintext one-off point (`geo_lat`, `geo_lng`, `geo_radius_m`). The
server stores and validates; iOS fires the alerts. The web gets the TypeScript envelope, the place
picker in the task editor, saved-place management, and Smart Add `@place`.

## Affected Repos

- `neutrino` — migration, `calendar::task_places`, task geo fields, `e2e-crypto` `sealPlace` /
  `openPlace`, web UI, docs.
- Follow-ups, separate PRs on the same branch name (not in this change): `neutrino_shared_ios`
  (move `PlaceEnvelope` into `NeutrinoCrypto`), `neutrino_drive_mac_desktop` (fixture test that its
  primitives open `place_envelope_vectors.json`).

## Tasks

1. Migration `00140_calendar__2026-10-02-000001_task_geofencing`: `task_places`; four nullable task
   columns.
2. `schema.rs`, task model, task DTOs (`geoPlaceId`, `geoLat`, `geoLng`, `geoRadiusM`; patch
   semantics), geofence resolution and validation in the task service, copy onto `nextTask`.
3. `src/calendar/task_places/`: GET/POST/PATCH/DELETE, owner-scoped, 4 KB cap, payload never logged;
   delete clears the place from its tasks.
4. `e2e-crypto`: `sealPlace`, `openPlace`, `placeKeyVersion`, with the shared fixture.
5. Web: API client, `usePlaces` (decrypt with the keyring), place picker in `TaskDetailModal`
   (geocoder search, radius 100–2000 m, saved places, save as a place), saved places in Settings,
   Smart Add `@place` (match rule as iOS `PlacesService.match`; otherwise offer the top geocoder
   result to confirm).
6. Docs: `agent_docs/end-to-end-encryption.md` envelope section; VERIFY.md.

## Test Plan

- Unit (Rust): place CRUD, another user's place 404, oversize payload 400, delete clears tasks;
  geofence create/patch rules (ranges, lat+lng together, place xor point, an edit with no geo
  fields keeps it, foreign place 404), next occurrence keeps the geofence.
- Unit (web): envelope opens every fixture case and rejects the rejected ones, seal→open round trip;
  place match rule; picker and Smart Add confirmation.
- E2E: save a place, attach it to a task, the DB/API holds only ciphertext; Smart Add `@Home`.

## Open Questions

- Geocoder for the web search: the web has none today. See the PR for the choice made.
