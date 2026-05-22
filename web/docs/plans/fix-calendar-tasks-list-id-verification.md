# Manual Verification: Calendar Tasks N+1 Fix

## Prerequisites
- Both `neutrino-calendar` and `neutrino-web` are running locally.
- Browser DevTools open on the Network tab, filtered to XHR/Fetch.
- At least one task list with tasks exists for the logged-in user.

## Steps to Verify

### Happy Path — API call count reduced
1. Navigate to the Calendar page.
2. Observe the Network tab on page load.
3. Confirm exactly 2 task-related requests fire in parallel:
   - `GET /api/v1/tasks/lists`
   - `GET /api/v1/tasks`
4. Confirm neither request depends on the response of the other (they should initiate at the same time, not sequentially).
5. Confirm the task sidebar renders the correct tasks under each list heading.

### Happy Path — listId present in response
1. Open the `GET /api/v1/tasks` response in the Network tab.
2. Confirm each task object includes a `listId` field containing the UUID of the task's list.
3. For tasks not in any list, confirm `listId` is `null` (not missing entirely).

### Regression — existing listId filter still works
1. In the Network tab, trigger a task creation or edit mutation.
2. Confirm the mutation's cache invalidation fires `GET /api/v1/tasks?listId=<id>` (the per-list fetch for the specific list).
3. Confirm the task appears in the correct list in the sidebar.

### Feature Flag Off (N/A)
This change has no feature flag — it is a transparent performance improvement to an always-on feature.

## Expected Results
- Page load generates exactly 2 parallel task API calls, down from 5 sequential calls.
- All tasks appear under the correct list heading in the sidebar.
- Task creation/editing mutations still work correctly.

## Rollback
No feature flag is used. To rollback, revert the `fix/calendar-tasks-list-id` branch in both repos and redeploy.
