# Fix: Calendar Tasks N+1 API Call Reduction

## Branch
`fix/calendar-tasks-list-id` (both neutrino-calendar and neutrino-web)

## Problem
On every calendar page load, the frontend makes 5 sequential HTTP calls:
1. `GET /api/v1/tasks/lists` — returns 4 task lists
2. 4x `GET /api/v1/tasks?listId=<id>` — one per list, executed in Promise.all after the first resolves

This is a waterfall: the 4 per-list calls cannot start until the list-of-lists call completes.

## Root Cause
- The backend `GET /api/v1/tasks` (no filter) already returns all tasks for the user.
- But `TaskResponse` doesn't include `list_id`, so the frontend can't assign tasks to their list
  without making individual per-list calls.
- The frontend query for tasks is `enabled: taskLists.length > 0`, creating a deliberate sequential dependency.

## Fix
1. Add `list_id: Option<String>` to the backend `TaskResponse` DTO.
2. Add a new repo method `find_all_tasks_with_list_id_by_user` that joins `tasks` with
   `task_list_memberships` to return `Vec<(TaskRecord, Option<String>)>`.
3. Update the service `list_tasks` to use the join query when `list_id` is `None`,
   and populate `list_id` on each response.
4. Add `listId?: string` to the frontend `TaskResponse` type.
5. Add `listAllTasks()` to the frontend API client (calls `GET /api/v1/tasks` with no params,
   returns `TaskResponse[]` directly since the backend returns an array, not a wrapper).
6. Replace the sequential two-query pattern in `calendar/page.tsx` with two parallel queries.

## Layers Affected
- Backend (Rust): dto.rs, repository.rs, service.rs
- Frontend: packages/api-calendar/src/index.ts, apps/web/src/app/(apps)/calendar/page.tsx

## Feature Flag
This is a bug fix / performance improvement with no behavioural change from the user's perspective.
No feature flag is needed — both endpoints continue to work as before, and the new
`listAllTasks()` method is additive.

## Known Risks
- Tasks not in any list will have `list_id: null` in the response. The frontend must handle
  this gracefully (the `allTasks` array is already used for rendering; tasks without a list
  won't render in any list's panel but will not crash).
- The existing `listTasks(listId)` method is kept unchanged; it is still used by post-mutation
  cache invalidation.
- The frontend `ListTasksResponse` wrapper type (`{ tasks: TaskResponse[] }`) is kept because
  `listTasks` still uses it. The new `listAllTasks()` returns `TaskResponse[]` directly.

## Acceptance Criteria
- Page load generates exactly 2 parallel API calls: `GET /api/v1/tasks/lists` and `GET /api/v1/tasks`.
- Each task in the response has its correct `listId` populated.
- `cargo check` passes with zero errors.
- `pnpm type-check` passes with zero errors.
