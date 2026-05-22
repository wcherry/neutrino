# Plan: Calendar Task Lists Sidebar

## Branch
`feature/calendar-task-lists` (neutrino-web only — backend tasks API already complete)

## What Is Changing and Why

The calendar sidebar currently shows reminders. Users also have task lists managed by the
tasks API (`/api/v1/tasks/lists`, `/api/v1/tasks`). This feature surfaces those task lists
directly on the calendar page, displayed below the reminders section, so users can see and
check off tasks without leaving the calendar.

## Layers Affected

| Layer | What changes |
|---|---|
| `@neutrino/api-calendar` | Add task list + task TypeScript types and API methods |
| Feature flags | New `calendarTaskLists` flag gating the feature |
| Frontend component | New `TaskListsSidebar.tsx` component |
| Calendar page | Fetch task lists + tasks; render `TaskListsSidebar` below `RemindersSidebar` |
| CSS | CSS Module classes for task list items in `page.module.css` |
| Tests | Unit tests for `TaskListsSidebar` |

## Feature Flag

- **Name:** `calendarTaskLists`
- **Env var:** `NEXT_PUBLIC_FEATURE_CALENDAR_TASK_LISTS`
- **Default:** `false` (off in all environments)
- Gate applied in `page.tsx` — the task lists section is only fetched and rendered when the flag is on

## Backend API (already implemented, no changes needed)

- `GET /api/v1/tasks/lists` → `{ taskLists: TaskListResponse[] }`
- `GET /api/v1/tasks?listId=<id>` → `{ tasks: TaskResponse[] }`
- `PATCH /api/v1/tasks/:id` → update task (used to mark done)

## Implementation Steps

1. Add types `TaskListResponse`, `TaskResponse`, `ListTaskListsResponse`, `ListTasksResponse` and API methods `listTaskLists`, `listTasks`, `updateTask` to `packages/api-calendar/src/index.ts`
2. Add `calendarTaskLists` flag to `apps/web/src/lib/featureFlags.ts`
3. Add CSS classes for task items to `page.module.css`
4. Create `TaskListsSidebar.tsx` — shows each task list as a collapsible section with checkable task items
5. Update `page.tsx`:
   - Import `featureFlags`
   - Add `listTaskLists` query (enabled only when flag is on)
   - Add `updateTask` mutation (to toggle done)
   - Render `<TaskListsSidebar>` below `<RemindersSidebar>` in both sidebar branches, wrapped in the feature flag guard

## Acceptance Criteria

- [ ] With flag off: sidebar is unchanged, no extra API calls
- [ ] With flag on: task lists appear below reminders heading with their tasks listed
- [ ] Tasks can be toggled done (checkbox); optimistic update via TanStack Query invalidation
- [ ] Empty task lists still show the list name with an empty-state message
- [ ] No tasks lists: a "No task lists" empty state is shown
- [ ] Task list with a `color` property uses that color as an accent on the list header
- [ ] All tests pass
