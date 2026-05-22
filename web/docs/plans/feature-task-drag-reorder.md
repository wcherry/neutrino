# Plan: Task Drag-and-Drop Reorder

## Branch names
- neutrino-calendar: `feature/task-drag-reorder`
- neutrino-web: `feature/task-drag-reorder`

## What is changing and why

Users need to reorder tasks within a task list by dragging them. The reordered position must survive a page refresh, so it must be persisted to the backend.

The `tasks` table already has a `position INTEGER NOT NULL DEFAULT 0` column and the repository already orders by `(position ASC, created_at ASC)`. The missing piece is a **bulk reorder endpoint** that accepts an ordered list of task IDs and updates each task's position field in a single transaction.

On the frontend the `TaskListsSidebar` currently renders tasks as plain divs. We wrap the pending-tasks section with `@dnd-kit/core` + `@dnd-kit/sortable` to enable drag-and-drop. On drag-end we optimistically reorder the local task list and fire the bulk reorder API call.

## Layers affected

| Layer | Change |
|---|---|
| Backend (Rust) | New `POST /api/v1/tasks/reorder` endpoint + service method + repository method |
| Frontend types | New `ReorderTasksRequest` type in `@neutrino/api-calendar` |
| Frontend API client | New `reorderTasks` method in `calendarApi` |
| Frontend component | `TaskListsSidebar` wrapped with `@dnd-kit` sortable; drag handle rendered per task |
| Frontend page | New `reorderTasks` mutation in `page.tsx` passed down to sidebar |
| CSS | Drag handle and drag-overlay styles in `page.module.css` |
| Tests | Existing 12 tests must still pass; new tests for drag reorder |

## No migration needed

The `position` column already exists in the tasks table from the initial schema. No new migration is required.

## Feature flag

Name: `feature.calendar.task-drag-reorder`  
Env var: `NEXT_PUBLIC_FEATURE_TASK_DRAG_REORDER`  
Default: **off** (false)  
Location: `apps/web/src/lib/featureFlags.ts`

The drag-and-drop wrapper only mounts when the flag is on; otherwise `TaskListsSidebar` renders the same plain list it does today, keeping all 12 existing tests passing regardless of flag state.

## API contract

```
POST /api/v1/tasks/reorder
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "listId": "uuid",
  "taskIds": ["uuid1", "uuid2", "uuid3"]   // in desired order
}

200 OK  (no body)
400 Bad Request  (missing fields)
404 Not Found    (list not found, or task not in list)
```

The backend sets `position = index` for each task ID in the supplied order.

## Known risks and edge cases

- Concurrent reorders: last write wins (acceptable for MVP)
- Reorder of done tasks: only pending tasks are draggable; done tasks keep their positions and are sorted among themselves
- Empty list or single task: drag handles still render but have no effect
- Network failure on reorder: optimistic update is already applied; on error we invalidate the query so the list re-fetches true order

## Acceptance criteria

1. Pending tasks can be reordered by dragging within a single list
2. After dragging, the new order persists after a page refresh
3. Done tasks are not draggable
4. All 12 existing `TaskListsSidebar` tests still pass
5. The feature flag `NEXT_PUBLIC_FEATURE_TASK_DRAG_REORDER=true` enables DnD; when unset the component renders identically to today
