# Plan: Neutrino Diagramming App (Phases 1-3)

## Summary

This plan implements a professional collaborative diagramming application (Phases 1-3) inside the existing Neutrino monorepo. Phase 1 delivers a fully functional infinite-canvas diagram editor with shapes, connectors, multi-page support, grid/snap, and undo/redo. Phase 2 adds professional shape libraries (Flowchart, UML, BPMN, ERD, Network, Cloud) and diagram templates. Phase 3 adds real-time multi-user collaboration via the same y-websocket pattern used by Docs, plus threaded comments, change tracking, and permission sharing. Everything is gated behind `FEATURE_DIAGRAMS_APP`.

## Affected Repos

- `neutrino` (monorepo) — all changes are in this single repo:
  - `src/diagrams/` — new Rust module (API handlers, service, repository, models, collab WebSocket)
  - `src/main.rs` — register diagrams module, services, routes, OpenAPI
  - `src/schema.rs` — add Diesel table macros for diagrams tables
  - `migrations/` — 4 new migration files (diagrams, diagram_versions, diagram_collaborators, diagram_comments + yjs_state)
  - `web/packages/api-drawing/` — new TypeScript API client package
  - `web/apps/web/src/app/(apps)/diagrams/` — new Next.js app (canvas editor, list page, collab)
  - `web/apps/web/src/app/(apps)/layout.tsx` — add Diagrams nav item
  - `web/apps/web/src/app/(apps)/NewItemFAB.tsx` — add Diagram FAB action
  - `web/apps/web/src/lib/featureFlags.ts` — add `diagramsApp: boolean`
  - `web/apps/web/src/lib/api.ts` — re-export `@neutrino/api-drawing`

## Tasks

### Backend

1. Write migration `00091_diagrams__2026-06-08-000000_create_diagrams` — creates `diagrams`, `diagram_versions`, `diagram_collaborators`, `diagram_comments`, `diagram_yjs_state` tables.
2. Add Diesel table macros to `src/schema.rs`.
3. Create `src/diagrams/mod.rs` — top-level module declaration.
4. Create `src/diagrams/diagrams/mod.rs`, `model.rs`, `dto.rs`, `repository.rs`, `service.rs`, `api.rs` — full CRUD for diagrams.
5. Create `src/diagrams/collab/mod.rs`, `state.rs`, `repository.rs`, `api.rs` — WebSocket collab using yrs (mirrors docs collab).
6. Register diagrams module in `src/main.rs` — service wiring, app_data, route configuration, OpenAPI merge.
7. Write inline `#[cfg(test)]` unit tests in `service.rs` for create/get/save logic.

### Frontend

8. Create `web/packages/api-drawing/package.json` and `src/index.ts` — typed API client mirroring api-slides pattern.
9. Add `diagramsApp: boolean` to `web/apps/web/src/lib/featureFlags.ts`.
10. Re-export from `web/apps/web/src/lib/api.ts`.
11. Create diagram list page: `web/apps/web/src/app/(apps)/diagrams/page.tsx`.
12. Create canvas editor: `web/apps/web/src/app/(apps)/diagrams/editor/page.tsx` and `DiagramEditor.tsx` using react-konva.
13. Implement shape library components (Phase 1 shapes + Phase 2 libraries) in `diagrams/editor/shapes/`.
14. Implement connector rendering and auto-routing in `diagrams/editor/connectors/`.
15. Implement toolbar, properties panel, page panel in `diagrams/editor/`.
16. Implement collab presence, cursor tracking, comments panel (Phase 3) in `diagrams/editor/collab/`.
17. Add Diagrams nav item to `layout.tsx`.
18. Add Diagram FAB action to `NewItemFAB.tsx`.
19. Write Vitest unit tests for editor hooks and API client.

## Test Plan

- **Unit (Rust):** `#[cfg(test)]` blocks in `service.rs` covering:
  - `create_diagram` — title validation, MIME type, empty content
  - `get_diagram` — not found, deleted check
  - `save_diagram` — permission check (owner/editor only)
  - `content_urls` — correct path generation
  - `mime_type` constant assertion

- **Unit (TypeScript):** Vitest tests in `web/apps/web/src/__tests__/diagrams/`:
  - `diagramsApi` — mock fetch, test createDiagram, getDiagram, saveDiagram
  - `useUndoRedo` hook — push/undo/redo state transitions
  - `useDiagramEditor` hook — shape add/move/delete
  - `shapeUtils` — getBoundingBox, snapToGrid

## Feature Flag

Name: `FEATURE_DIAGRAMS_APP`
Description: Gates all diagram routes (backend) and the entire diagrams UI (frontend).
Default: `false` (disabled).

Backend: `std::env::var("FEATURE_DIAGRAMS_APP").unwrap_or_default() == "true"` checked in the route configure function.
Frontend: `useFeatureFlags().diagramsApp` checked in the list page and editor page.

## Open Questions

None — requirements fully specified.
