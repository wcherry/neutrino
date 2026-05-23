# Neutrino

A self-hosted productivity suite. Single binary: a Rust API server that also serves the Next.js frontend as static files.

## Apps

| App | Description |
|-----|-------------|
| **Calendar** | Event scheduling with recurring events, reminders, ICS import/export, and Google/Outlook calendar sync |
| **Docs** | Collaborative document editing (real-time via Yjs) |
| **Drive** | File storage and management |
| **Notes** | Quick notes (Keep-style) |
| **Photos** | Photo library |
| **Sheets** | Spreadsheet editor |
| **Slides** | Presentation editor |

## Stack

- **Backend** — Rust, Actix-web 4, SQLite (Diesel + WAL mode), Argon2 password hashing, JWT auth, TOTP 2FA, AES-GCM end-to-end encryption
- **Frontend** — Next.js 15 (App Router), pnpm workspaces, Turborepo
- **Database** — SQLite (single file, bundled `libsqlite3`)
- **Storage** — Local filesystem

## Project Layout

```
src/                  # Rust backend
  auth/               # Auth, sessions, 2FA, user profiles
  calendar/           # Events, reminders, task lists, external connections
  docs/               # Document CRUD and real-time collaboration
  drive/              # File upload, download, folders
  notes/              # Notes CRUD
  photos/             # Photo library
  sheets/             # Spreadsheet data
  slides/             # Presentation data
  shared/             # DB pool, extractors, error types
  config.rs           # All config loaded from environment
  main.rs             # Server setup, routing, migration runner
migrations/           # Diesel migrations (run automatically on startup)
web/                  # Frontend monorepo (see web/README.md)
  apps/web/           # Next.js app — all user-facing routes
  packages/           # Shared packages (ui, tokens, hooks, api-*, auth, etc.)
Dockerfile            # Single-container build (web → Rust binary)
```

## Getting Started

### Local development

**Backend**

```bash
cp .env.example .env   # fill in required values (see Configuration below)
cargo run
```

The server starts on `http://localhost:8080` by default.

**Frontend**

```bash
cd web
pnpm install
pnpm dev        # starts the Next.js dev server (port 3000)
```

In dev mode, point `NEXT_PUBLIC_API_URL` at the running backend (`http://localhost:8080`).

### Docker

```bash
# Or pull the pre-built image from GitHub Container Registry:
# docker pull ghcr.io/wcherry/neutrino:latest

docker build -t neutrino .
docker run -p 8080:8080 \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  neutrino
```

The container serves everything (API + frontend) on port 8080.

## Configuration

All settings are read from environment variables (or a `.env` file in the working directory).

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port |
| `LOG_LEVEL` | `info` | Tracing log level (`error`, `warn`, `info`, `debug`, `trace`) |
| `LOG_PATH` | *(stdout only)* | Directory for log files |
| `JWT_SECRET` | **required** | Secret used to sign JWT access and refresh tokens |
| `JWT_ACCESS_EXPIRY_SECS` | `900` | Access token lifetime (seconds) |
| `JWT_REFRESH_EXPIRY_SECS` | `604800` | Refresh token lifetime (seconds, default 7 days) |
| `WORKER_SECRET` | **required** | Internal secret for background worker authentication |
| `JOBS_PER_WORKER` | `4` | Maximum concurrent background jobs per worker |
| `DATABASE_URL` | `./data/neutrino.db` | SQLite database file path |
| `STORAGE_PATH` | `./data/storage` | Root directory for uploaded files |
| `MAX_UPLOAD_BYTES` | `10737418240` | Maximum single-file upload size (default 10 GiB) |
| `DRIVE_URL` | `http://localhost:<PORT>` | Public URL of the Drive service |
| `SELF_URL` | `http://localhost:<PORT>` | Public base URL of this server |
| `APP_BASE_URL` | `http://localhost:<PORT>` | Base URL used in links sent to users |
| `WEB_DIR` | `web/apps/web/out` | Path to the built Next.js static export |
| `GOOGLE_CLIENT_ID` | *(optional)* | Google OAuth client ID (calendar sync) |
| `GOOGLE_CLIENT_SECRET` | *(optional)* | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | `<DRIVE_URL>/api/v1/connections/google/callback` | Google OAuth redirect URI |
| `OUTLOOK_CLIENT_ID` | *(optional)* | Microsoft OAuth client ID (calendar sync) |
| `OUTLOOK_CLIENT_SECRET` | *(optional)* | Microsoft OAuth client secret |
| `ANTHROPIC_API_KEY` | *(optional)* | Anthropic API key for AI features |

## Database Migrations

Migrations in `migrations/` are embedded in the binary and run automatically on startup. No manual migration step is needed.

## API Documentation

Swagger UI is available at `/swagger-ui/` when the server is running.

## Frontend Docs

See [web/README.md](web/README.md) for the frontend monorepo structure, scripts, and Storybook setup.
