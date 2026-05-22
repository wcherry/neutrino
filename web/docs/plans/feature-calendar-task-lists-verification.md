# Manual Verification: Calendar Task Lists Sidebar

## Prerequisites

- [ ] Feature flag `calendarTaskLists` enabled: set `NEXT_PUBLIC_FEATURE_CALENDAR_TASK_LISTS=true` in your local `.env.local`
- [ ] At least one task list created via the API (or the tasks UI)
- [ ] Tasks added to at least one of those lists

## Steps to Verify

### Happy Path — flag enabled

1. Start the dev server with the flag set to `true`
2. Navigate to the Calendar page
3. Look at the right sidebar below the Reminders section
4. Confirm a "Task Lists" heading appears with a horizontal divider above it
5. Confirm each task list name is shown as a sub-heading
6. Confirm tasks appear under their respective list
7. Check a pending task's checkbox — confirm the task title becomes struck-through and moves to the completed section (lower opacity)
8. Uncheck a completed task — confirm it moves back to the pending section
9. If a task list has a non-null `color`, confirm a small colored dot appears beside the list name
10. Create a new task list with no tasks — confirm "No tasks in this list" appears under it

### Empty state

1. Delete all task lists
2. Confirm the sidebar shows "No task lists" below the divider

### Feature Flag Off

1. Remove `NEXT_PUBLIC_FEATURE_CALENDAR_TASK_LISTS=true` (or set it to `false`)
2. Restart the dev server
3. Navigate to the Calendar page
4. Confirm the sidebar shows only the Reminders section — no "Task Lists" heading, no task API calls in the network tab

### With Event Selected

1. Click a calendar event to open the EventDetail panel in the sidebar
2. Confirm that the Reminders section and (when flag is on) the Task Lists section both appear below the event detail panel

## Expected Results

- Task Lists section is visible only when `NEXT_PUBLIC_FEATURE_CALENDAR_TASK_LISTS=true`
- Each task list appears with its name and optional color dot
- Tasks are shown under their list; completed tasks are struck-through and dimmed
- Toggling a checkbox calls `PATCH /api/v1/tasks/:id` and the UI updates immediately via query invalidation
- No regressions to the existing Reminders section

## Rollback

Disable `NEXT_PUBLIC_FEATURE_CALENDAR_TASK_LISTS` (set to `false` or remove) — instant rollback, no deployment required.
