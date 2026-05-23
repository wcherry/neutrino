# Manual Verification: Tasks API

## Prerequisites
- [ ] Service running locally (`cargo run` or `docker compose up neutrino-calendar`)
- [ ] Valid JWT token for a test user (obtain via normal auth flow)
- [ ] `BASE=http://localhost:<port>/api/v1` and `TOKEN=<jwt>` set in shell

## Steps to Verify

### Happy Path — Task Lists

1. Create a list:
   ```
   curl -s -X POST $BASE/tasks/lists \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"Shopping","color":"#ff0000"}' | jq .
   ```
   Expected: 201, body contains `id`, `name`, `color`, `createdAt`, `updatedAt`.

2. List all lists:
   ```
   curl -s $BASE/tasks/lists -H "Authorization: Bearer $TOKEN" | jq .
   ```
   Expected: 200, `taskLists` array contains the list created above.

3. Get by ID:
   ```
   curl -s $BASE/tasks/lists/<id> -H "Authorization: Bearer $TOKEN" | jq .
   ```
   Expected: 200, full list object.

4. Update name:
   ```
   curl -s -X PATCH $BASE/tasks/lists/<id> \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"Grocery"}' | jq .
   ```
   Expected: 200, `name` is now "Grocery".

### Happy Path — Tasks

5. Create a task:
   ```
   curl -s -X POST $BASE/tasks/lists/<list_id>/tasks \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"title":"Buy milk","notes":"2% please","dueDate":"2026-06-01T09:00:00Z"}' | jq .
   ```
   Expected: 201, body contains `id`, `listId`, `title`, `notes`, `done: false`, `dueDate`, `position`.

6. List tasks:
   ```
   curl -s $BASE/tasks/lists/<list_id>/tasks -H "Authorization: Bearer $TOKEN" | jq .
   ```
   Expected: 200, `tasks` array contains the task.

7. Mark task done:
   ```
   curl -s -X PATCH $BASE/tasks/lists/<list_id>/tasks/<task_id> \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"done":true}' | jq .
   ```
   Expected: 200, `done: true`.

8. Delete a task:
   ```
   curl -s -X DELETE $BASE/tasks/lists/<list_id>/tasks/<task_id> \
     -H "Authorization: Bearer $TOKEN"
   ```
   Expected: 204 No Content.

### Cascade Delete

9. Create a new list with 2 tasks, then delete the list:
   ```
   curl -s -X DELETE $BASE/tasks/lists/<list_id> -H "Authorization: Bearer $TOKEN"
   ```
   Expected: 204. Verify that `GET $BASE/tasks/lists/<list_id>/tasks` returns 404.

### Edge Cases

10. Get a non-existent list:
    ```
    curl -s $BASE/tasks/lists/does-not-exist -H "Authorization: Bearer $TOKEN"
    ```
    Expected: 404 with error body.

11. Cross-user isolation: using a different user's token, attempt to GET/PATCH/DELETE the list created in step 1.
    Expected: 404 (user-scoped query returns nothing).

12. Create task on a list that belongs to another user:
    Expected: 404 (list ownership check fails before insert).

### OpenAPI / Swagger

13. Navigate to `http://localhost:<port>/swagger-ui/` — verify the `tasks` tag appears with all 10 endpoints documented.

## Expected Results
- All CRUD operations return correct status codes and JSON shapes
- `updatedAt` timestamp advances on PATCH operations
- Tasks are ordered by `position` asc, then `createdAt` asc
- Lists are ordered by `name` asc

## Rollback
This is a net-new API. To roll back: revert the branch. No existing callers are affected.
Existing data is unaffected; the new tables are additive-only.
