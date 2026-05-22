# Implementation Plan: Task Completion Checkbox

## Branch
- `neutrino-web`: `feature/task-creation`
- `neutrino-calendar`: `feature/task-completion-checkbox`

## What is Changing and Why

Users need to be able to mark tasks as done directly from the Tasks sidebar in the calendar app. The feature adds a checkbox to each task item in the `TaskListsSidebar` component. Clicking the checkbox calls `PATCH /api/v1/tasks/{id}` with `{ done: true/false }` to persist the state, and immediately reflects the change by invalidating the TanStack Query cache.

## Layers Affected

### Backend (neutrino-calendar)
- The `done: bool` field already exists on the `TaskRecord` and `TaskResponse` models.
- `UpdateTaskRequest` already accepts `done: Option<bool>`.
- `PATCH /api/v1/tasks/{id}` already delegates to `update_task` which applies the changeset.
- New migrations split `task_list_memberships` into a proper junction table (extracted from the earlier `create_tasks` migration), enabling future many-to-many list membership.
- `main.rs` adds `NormalizePath::Trim` middleware so trailing slashes no longer cause 404s.

### Frontend (neutrino-web)
- `packages/api-calendar/src/index.ts` — `TaskResponse` includes `done: boolean` and `listId: string`; `updateTask()` method already calls `PATCH /api/v1/tasks/{id}`.
- `apps/web/src/app/(apps)/calendar/page.tsx` — `toggleTask` mutation wraps `calendarApi.updateTask(id, { done })` and invalidates `['tasks']`.
- `apps/web/src/app/(apps)/calendar/TaskListsSidebar.tsx` — `TaskItem` renders `<input type="checkbox" checked={task.done} onChange={() => onToggle(task.id, !task.done)} />` with proper CSS class; done tasks appear with strikethrough at reduced opacity.
- `apps/web/src/app/(apps)/calendar/page.module.css` — `.taskCheckbox`, `.taskCheckbox:checked`, `.taskTitle`, `.taskDone` styles added.

### Tests
- `apps/web/src/__tests__/calendar/TaskListsSidebar.test.tsx` — 12 tests cover checkbox rendering, toggle callbacks for both pending and done tasks, empty states, and list creation.

## Feature Flag
No feature flag — this extends an already-shipped tasks UI. The tasks sidebar itself was shipped unconditionally in commit `a0ed69f3`.

## Known Risks and Edge Cases
- Optimistic update not implemented; the UI reflects the new state only after the query invalidation round-trip. Acceptable for now.
- If `PATCH` fails (network error), the checkbox reverts on the next cache read. No explicit error toast is shown.

## Acceptance Criteria
- [ ] Each task item in the Tasks sidebar shows a checkbox.
- [ ] Clicking an unchecked box marks the task as done (strikethrough title, reduced opacity).
- [ ] Clicking a checked box marks the task as not done.
- [ ] The state persists across page reloads (backend is the source of truth).
- [ ] All 12 unit tests pass.
