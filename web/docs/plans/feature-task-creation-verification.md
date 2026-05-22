# Manual Verification: Task Completion Checkbox

## Prerequisites
- Calendar app running locally (`pnpm dev` in `neutrino-web`, `cargo run` in `neutrino-calendar`)
- At least one task list with tasks already created (or create them during verification)

## Steps to Verify

### Happy Path — Mark a Task as Done
1. Open the calendar app and locate the Tasks sidebar on the right.
2. Select a task list from the dropdown (auto-selects the first one on load).
3. Verify that each task item shows a checkbox to its left.
4. Click the checkbox on a pending (unchecked) task.
5. Expected: the checkbox becomes checked, the task title gains a strikethrough, and the task moves to the "done" group at the bottom of the list (rendered at 55% opacity).
6. Reload the page.
7. Expected: the task is still shown as done (backend persisted the state).

### Happy Path — Unmark a Done Task
1. Click the checkbox on a completed (checked) task.
2. Expected: the checkbox unchecks, the strikethrough disappears, and the task returns to the pending group.
3. Reload the page.
4. Expected: the task is shown as pending.

### Edge Cases

#### Empty List
1. Create a new task list with no tasks.
2. Expected: "No tasks — click + to add one" is shown; no checkboxes are visible.

#### Single Task Toggled Rapidly
1. Click a task checkbox several times quickly.
2. Expected: the final state matches the last click; no duplicate PATCH requests corrupt the task state.

#### Tasks Belonging to Another List
1. Switch between task lists using the dropdown.
2. Expected: only tasks belonging to the selected list are shown; checkboxes in list A do not affect tasks in list B.

## Expected Results
- Each task row contains a visible checkbox aligned to the start of the row.
- Unchecked tasks show a grey border; checked tasks show a blue filled checkbox (`--color-primary`).
- Done task titles are struck through and grey (`--color-text-secondary`).
- Done tasks are visually separated below pending tasks at reduced opacity.
- The state persists across page reloads.

## Rollback
No feature flag is in use — the tasks sidebar is unconditionally rendered. To disable, revert the PR in `neutrino-web` (frontend only; no backend deployment change is required for a rollback of the checkbox UI).
