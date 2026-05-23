# Plan: Tasks API

## Branch
`feature/tasks-api`

## What Is Changing and Why
Add a Tasks domain to the calendar backend service. Users need to manage to-do lists
(e.g., "Shopping", "Work") and the individual tasks within them. This requires two new
database tables, two new module trees following the existing patterns, and full CRUD
HTTP endpoints for both resources.

## Layers Affected
- **Database**: two new migrations (`task_lists`, `tasks`)
- **Diesel schema**: `schema.rs` updated with two new `table!` macros
- **Backend (Rust)**: new `src/tasks/` module mirroring `src/reminders/` structure
  - `mod.rs`, `model.rs`, `dto.rs`, `repository.rs`, `service.rs`, `api.rs`
- **main.rs**: wire up state, service, repository, configure routes, register OpenAPI paths

## Feature Flag
This is a net-new API surface with no existing callers, so no feature flag is required.
The endpoints are simply added; removing them later is a no-op delete.

## Data Model

### `task_lists` table
| column | type | notes |
|---|---|---|
| id | TEXT PK | UUID v4 |
| user_id | TEXT NOT NULL | scoped per user |
| name | TEXT NOT NULL | e.g. "Shopping" |
| color | TEXT | optional hex color |
| created_at | TIMESTAMP NOT NULL | |
| updated_at | TIMESTAMP NOT NULL | |

Index: `(user_id)`

### `tasks` table
| column | type | notes |
|---|---|---|
| id | TEXT PK | UUID v4 |
| list_id | TEXT NOT NULL FK → task_lists(id) | owning list |
| user_id | TEXT NOT NULL | denormalized for fast user-scoped queries |
| title | TEXT NOT NULL | |
| notes | TEXT | optional body |
| done | BOOLEAN NOT NULL DEFAULT 0 | |
| due_date | TIMESTAMP | optional |
| position | INTEGER NOT NULL DEFAULT 0 | ordering within list |
| created_at | TIMESTAMP NOT NULL | |
| updated_at | TIMESTAMP NOT NULL | |

Index: `(user_id, list_id)`, `(list_id, position)`

## API Endpoints

### Lists
| Method | Path | Description |
|---|---|---|
| GET | /api/v1/tasks/lists | List all lists for authenticated user |
| POST | /api/v1/tasks/lists | Create a list |
| GET | /api/v1/tasks/lists/{id} | Get a single list |
| PATCH | /api/v1/tasks/lists/{id} | Update name/color |
| DELETE | /api/v1/tasks/lists/{id} | Delete list (cascades tasks in app layer) |

### Tasks
| Method | Path | Description |
|---|---|---|
| GET | /api/v1/tasks/lists/{list_id}/tasks | List tasks in a list |
| POST | /api/v1/tasks/lists/{list_id}/tasks | Create a task |
| GET | /api/v1/tasks/lists/{list_id}/tasks/{id} | Get a single task |
| PATCH | /api/v1/tasks/lists/{list_id}/tasks/{id} | Update task fields |
| DELETE | /api/v1/tasks/lists/{list_id}/tasks/{id} | Delete a task |

## Specialist Agents
- `rust-developer`: all implementation (migrations, schema, model, dto, repository, service, api, main.rs wiring)
- `test-writer`: unit and integration tests

## Known Risks / Edge Cases
- Deleting a list must also delete its tasks (handled in service layer before repo.delete)
- `user_id` on `tasks` is denormalized to avoid joins on every query; must be kept consistent on insert
- `position` field is included for future reordering; defaults to 0 and is not required in create request
- SQLite does not enforce FK constraints by default; cascade is implemented in service code

## Acceptance Criteria
- All 10 CRUD endpoints respond correctly
- User A cannot read/modify User B's lists or tasks (user_id filter on all queries)
- Deleting a list deletes its tasks
- Tests pass via `cargo test`
- OpenAPI spec updated in swagger-ui
