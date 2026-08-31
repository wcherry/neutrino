# Neutrino

A self-hosted, end-to-end encrypted productivity suite. The server is a single Rust
binary that serves the API *and* the exported Next.js frontend; a second binary
(`worker`) runs background jobs. SQLite is the only datastore, and its migrations are
embedded in the binary, so a first run needs no database setup at all.

## Apps

| App | Description |
|-----|-------------|
| **Drive** | File storage — folders, tags, stars, shortcuts, trash, shared drives, share links, comments, activity trail, version history |
| **Docs** | Rich-text documents (`.docx`) with real-time co-editing, outline, version history, and PDF export |
| **Sheets** | Spreadsheets (`.xlsx`) with a formula engine, named ranges, conditional formatting and charts |
| **Slides** | Presentations (`.pptx`) with themes, master slides, speaker notes and presenter mode |
| **Notes** | Block-based quick notes that sync live across devices |
| **Photos** | Photo library with albums, favourites, archive, memories, and on-device face grouping |
| **Calendar** | Month/week/agenda views, recurring events, reminders, task lists, ICS import/export, Google and Outlook sync |
| **Diagrams** | Flowchart, UML, BPMN, ERD and cloud shape libraries, with real-time co-editing |
| **Drawing** | Freehand vector canvas with layers |

Notes, Docs, Sheets, Slides, Diagrams and Drawings are all **Drive files** — the editors
write into the same storage, quota and search index as anything else you upload. There
is no separate per-app content store in the backend.

## Document formats

Docs, Sheets and Slides store their documents as **OOXML** — a document is a real
`.docx`, a spreadsheet a real `.xlsx`, a deck a real `.pptx`. So Word, Excel,
PowerPoint, LibreOffice and Google's editors open a Neutrino document directly, and
"import" and "export" are a file copy rather than a conversion. Uploading an Office
file and creating a document here produce the same kind of thing, and open the same way.

**Docs is fully OOXML.** Page setup, headers and footers, footnotes, watermarks, field
codes, cross-references, tracked changes, lists, tables and document properties are all
written as the OOXML elements that mean them, and read back the same way
(`web/apps/web/src/lib/ooxml/docx/`). Word sees the document, not an approximation of it,
and a `.docx` from Word or Google Docs opens here with its layout intact. Three things
have no OOXML equivalent — they are live pointers at other Drive files: `neutrino-drive:`
image references, sheet and diagram embeds, and the theme preset name. Those ride in a
`customXml/` part, which Word preserves across an edit.

Sheets and Slides are not there yet. What those editors can *write* is narrower than what
they can hold — not because the format is narrow, but because their serializers do not
emit it: `buildXlsxWorksheet` writes cell values and nothing else, so column widths, cell
fills, charts and conditional formats have nowhere to go. Storing only the OOXML would
delete all of that on the first autosave.

So an `.xlsx` or `.pptx` also carries one extra part, `neutrino/model.json`, with the
editor's full-fidelity model, and those editors prefer it on open — nothing is lost saving
in Neutrino, and nothing is lost opening a file from elsewhere either, since a package
without that part is simply parsed as OOXML. A workbook round-tripped through Excel comes
back without it (Excel discards parts it does not recognise) and is read the same way. A
model that no longer matches the package around it is ignored rather than trusted;
`web/apps/web/src/lib/ooxmlContainer.ts` has the details.

That extra part is a stopgap, not the design — Docs has already left it behind, and a
`.docx` saved before it did is migrated by its next save. Every field the remaining
writers learn to emit improves what Excel and PowerPoint see, with no risk to what
Neutrino reads back, and the model can shrink as they catch up. Until then a Neutrino
spreadsheet opened elsewhere is correct values with no formatting —
**interoperability is bounded by the writers, not by the storage format.**

Documents written before this — `application/x-neutrino-doc` and friends — are still
read and written in that format. Nothing is migrated. Diagrams and Drawing have no
OOXML counterpart and keep their own JSON.

## Encryption

User content is encrypted in the browser before it is uploaded. The server stores
ciphertext and cannot read it.

- Every file gets its own AES-GCM data key (DEK), sealed to the account's public key.
- The identity keypair is held in a **wrapped key vault**. New keyrings are wrapped to
  the device, so there is no passphrase prompt on unlock; devices enrolled under an
  older passphrase or passkey unlock the old way once and are converted on the way out.
- **Key rotation** archives retired secret keys into a key file sealed to the *active*
  public key, so older files stay openable. Settings shows any versions the server is
  missing and offers a retry.
- A device is enrolled with a **PIN-protected QR key code** that the phone scans. The
  code expires after two minutes and on session lock. iOS holds one key at a time, so a
  rotated account's older files will not open there.
- There is **no plaintext write path to Drive**. The plaintext writers were deleted
  rather than guarded; `api-drive/src/encryptedWrites.ts` is the only way in, and it
  raises `MissingEncryptionKeyError` instead of degrading. `noPlaintextWrites.test.ts`
  scans the workspace and fails if a plaintext writer is referenced again.

Because content is encrypted, search runs **locally in the browser** against an
IndexedDB index (`packages/search`) that every app writes to, and is shared between
devices as an encrypted snapshot. Nothing is searched server-side.

## File storage and version history

Uploaded content lives on the filesystem under `STORAGE_PATH`, never in the database.
Each file gets **one directory holding every version of it**, the current content
included:

```
<STORAGE_PATH>/<user-id>/<file-id>/<version-id>
```

The version a file's row points at *is* its current content — not a copy of it — so
nothing is stored twice, and a new version is one more entry in the same directory.
Reported quota usage is the sum of those versions, which is what the volume actually
holds. Uploads, autosaves and named saves all write here; the editors' documents are
Drive files, so they version like anything else.

Two things follow from the current content being a version. The live version cannot be
deleted — its bytes are the file — and restoring an old version copies it forward as a
new one rather than pointing the file back at it, so a later autosave cannot overwrite
the history it was restored from.

**Version history is pruned by the worker**, hourly, against a policy an admin sets in
**/admin → Versions**:

| Setting | Default | Meaning |
|---------|---------|---------|
| Prune old versions | on | Off keeps every version of every file forever |
| Keep versions for | 30 days | How old a version may get before it is eligible for deletion |
| Always keep at least | 10 versions | The newest versions of each file, kept whatever their age |

The two numbers are one rule, not two: the newest *n* versions of a file are set aside
first, and age then decides among what is left. So a file edited all week keeps a week
of history, and a file untouched for two years still has its last *n* versions rather
than none. A file's current version and any version someone **named** are never pruned.

Deleting a file for good removes its whole directory and its history with it.

## Clients

| Client | Status |
|--------|--------|
| Web (installable PWA, works offline) | Shipped |
| macOS desktop — menu-bar app with a Finder File Provider extension | Shipped |
| iOS — Notes, Docs | Shipped |
| iOS — Drive | In development |
| iOS — Sheets | In development |
| Android, Windows, Linux | Planned |

## Stack

- **Backend** — Rust, Actix-web 4, Diesel + SQLite (bundled `libsqlite3`, WAL mode),
  Argon2 password hashing, JWT auth, TOTP 2FA, AES-GCM
- **Worker** — separate Rust binary, started alongside the server by the Docker image.
  Face detection (`rustface`) and other queued jobs over the shared SQLite jobs table,
  plus two hourly sweeps that derive their own work from the rows: erasing accounts past
  their deletion grace window, and pruning file version history to the retention policy
- **Frontend** — Next.js 15 (App Router, static export), pnpm workspaces, Turborepo
- **Collaboration** — Yjs over WebSockets, with server-side Y.Doc rooms for Docs and Diagrams
- **Storage** — local filesystem

## Project Layout

```
src/                  # Rust backend
  auth/               # Auth, sessions, TOTP 2FA, profiles, key vault
  calendar/           # Events, reminders, tasks, Google/Outlook connections
  diagrams/           # Diagram CRUD, collab rooms, private shape library
  docs/               # Document CRUD, collab rooms, permissions, templates
  drive/              # Files, folders, sharing, shared drives, permissions,
                      # encryption + key files, comments, tags, activity,
                      # notifications, admin, version retention policy,
                      # compliance, security, fonts
  jobs/               # Background job queue (consumed by worker/)
  links/              # Link previews / link management
  oauth/              # OAuth clients (native app sign-in)
  photos/             # Library, albums, faces, persons, suggestions, AI
  search/             # Search support endpoints (index itself is client-side)
  sheets/             # Named ranges, presence, AI
  slides/             # Presentations, presence, AI
  themes/             # Theme catalogue
  shared/             # DB pool, extractors, errors, presence rooms, file events
  config.rs           # All config loaded from the environment
  main.rs             # Server setup, routing, migration runner
worker/               # Background worker binary — face detection, job processing,
                      # account purge and version-retention sweeps
xtask/                # Dev tasks: cargo xtask dev | build-web | e2e | docker | ...
migrations/           # Diesel migrations (embedded; run automatically on startup)
web/                  # Frontend monorepo (see web/README.md)
  apps/web/           # Next.js app — all user-facing routes
  packages/           # api-*, ui, tokens, layout, hooks, auth, e2e-crypto,
                      # search, offline, collab-core, markdown, utils, …
e2e/                  # Playwright end-to-end suite (isolated Docker stack per run)
Dockerfile            # Single-image build (web → Rust binaries)
```

## Getting Started

### Local development

On a fresh clone, one task does every prerequisite step for the backend, the frontend
and the E2E suite:

```bash
cargo xtask setup
```

It generates the repo-root `.env` secrets, downloads the worker's face-detection model,
fetches the crates, runs the workspace `pnpm install` (which covers `web/` *and* `e2e/`),
installs the Playwright browser, and generates the `e2e/secrets/` files the test stack
mounts. Every step is idempotent — re-run it any time something looks half-installed. It
needs `pnpm`, `node`, `openssl`, `curl` and `docker` on the PATH, and says which are
missing rather than failing partway through.

Then start the backend, the worker and the frontend together:

```bash
cargo xtask dev
```

Other tasks: `cargo xtask build-web`, `cargo xtask e2e`, `cargo xtask docker`,
`cargo xtask storybook`, `cargo xtask fetch-model`.

To run the pieces by hand instead, create a `.env` in the repo root with at least:

```bash
JWT_SECRET=$(openssl rand -hex 32)
WORKER_SECRET=$(openssl rand -hex 32)
```

then:

```bash
cargo run                 # API server on http://localhost:8080
cargo run -p worker       # background worker (needs the face model — cargo xtask fetch-model)
pnpm install && pnpm dev   # Next.js dev server on port 3000 (run from the repo root)
```

In dev, point `NEXT_PUBLIC_API_URL` at the backend (`http://localhost:8080`).

### Docker

```bash
docker pull ghcr.io/wcherry/neutrino:latest
# or build it yourself: docker build -t neutrino .

docker run -d --name neutrino -p 8080:8080 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e WORKER_SECRET="$(openssl rand -hex 32)" \
  -e DATABASE_URL=/usr/local/data/neutrino.db \
  -e STORAGE_PATH=/usr/local/data/storage \
  -v neutrino-data:/usr/local/data \
  -v neutrino-logs:/usr/local/logs \
  ghcr.io/wcherry/neutrino:latest
```

The container serves the API and the frontend on port 8080, and its default command
(`/usr/local/bin/start-all`) runs the **background worker alongside them** — face
detection, background jobs, account purging and file-version retention all live there.
The worker starts once the server reports healthy, since the server is what runs the
database migrations. If either process exits the container exits with it, rather than
staying up while quietly doing none of the background work; give it a restart policy.

To split them across two containers instead, override the command on each
(`/usr/local/bin/service` and `/usr/local/bin/worker`) and give both the same
`DATABASE_URL`, `STORAGE_PATH`, `WORKER_SECRET` and volume.

With `LOG_PATH` set, each process writes its own daily file into that directory —
`service.<date>.log` and `worker.<date>.log` — so one shared volume does not interleave
the two. Both also log to stdout, which is what `docker logs` shows.

## Configuration

Everything is read from the environment (or a `.env` file in the working directory).
Secrets additionally accept a `<NAME>_PATH` variant that reads the value from a file,
which is how Docker/Kubernetes secrets are mounted — e.g. `JWT_SECRET_PATH=/run/secrets/jwt`.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port |
| `JWT_SECRET` | **required** | Signs JWT access and refresh tokens. Changing it signs everyone out |
| `WORKER_SECRET` | **required** | Shared secret the background worker authenticates with. Do not reuse `JWT_SECRET` |
| `DATABASE_URL` | `./data/neutrino.db` | SQLite database file path |
| `STORAGE_PATH` | `./storage` | Root directory for uploaded files |
| `WEB_DIR` | `web/apps/web/out` | Path to the built Next.js static export (preset in the Docker image) |
| `DRIVE_URL` | `http://localhost:<PORT>` | Public base URL of this server; used for share links and OAuth callbacks |
| `MAX_UPLOAD_BYTES` | `10737418240` | Largest single-file upload (default 10 GiB) |
| `JWT_ACCESS_EXPIRY_SECS` | `900` | Access token lifetime |
| `JWT_REFRESH_EXPIRY_SECS` | `604800` | Refresh token lifetime (7 days) |
| `JOBS_PER_WORKER` | `4` | Maximum concurrent background jobs per worker |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug`, `trace`. Read by both the server and the worker (`RUST_LOG` still overrides it for the worker) |
| `LOG_PATH` | *(stdout only)* | Directory for log files. Written as `service.<date>.log` and `worker.<date>.log`, rotated daily |
| `TEMP_SWEEP_INTERVAL_SECS` | `3600` | How often to sweep upload staging files that never committed (floor: 60) |
| `TEMP_MAX_AGE_SECS` | `21600` | How long a staging file must be untouched before a sweep removes it |
| `REPROCESS_INTERVAL_SECS` | `1800` | How often Photos reprocesses pending face-learning work |
| `STORAGE_ENCRYPTION_KEY` | *(optional)* | Base64 32 bytes; enables AES-GCM at-rest encryption for the server-side private store |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | *(optional)* | Google OAuth, for calendar sync |
| `GOOGLE_REDIRECT_URI` | `<origin>/calendar/settings/oauth/google/callback` | Google OAuth redirect URI. Derived from the address the browser reached the app on, so it normally needs no setting — register that URL in the Google console. Set it only to override |
| `OUTLOOK_CLIENT_ID` / `OUTLOOK_CLIENT_SECRET` | *(optional)* | Microsoft OAuth, for calendar sync |
| `OUTLOOK_REDIRECT_URI` | `<origin>/api/v1/calendar/connections/outlook/callback` | Microsoft OAuth redirect URI, derived the same way |
| `ANTHROPIC_API_KEY` | *(deprecated)* | No longer read. The AI features take their provider and API key from **Settings → AI Assistant**, per user — see [AI features](#ai-features) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | *(optional)* | Outbound email for notifications. All five must be set or email is disabled |
| `FACE_MODEL_PATH` | `models/seeta_fd_frontal_v1.0.bin` | Face-detection model, read by the worker (preset in the Docker image) |

### AI features

Nothing needs configuring on the server. Every AI feature — the Diagrams generator, the Sheets
Explore panel and conditional-formatting rule builder, the Slides authoring help, the Photos
vision tools, the Docs grammar fix — reads the provider and API key from **Settings → AI
Assistant**, where each person sets their own. The choices are Google Gemini, Anthropic Claude
and OpenAI; the key is kept in that browser and sent with the request, and the server proxies the
call to the provider without storing it.

A key set that way is used by everything, so it is the one place to change providers. Leave it
blank and the AI features say so instead of failing at the provider.

`ANTHROPIC_API_KEY` was the old, server-wide version of this and is no longer read anywhere.
Setting it does nothing; remove it from your deployment. It made a single account pay for every
user's requests and pinned the whole product to one provider.

## Database Migrations

Migrations in `migrations/` are embedded in the binary and run automatically on
startup. There is no manual migration step.

## Testing

```bash
cd web && pnpm test        # Vitest unit/component tests
cargo test                 # Rust tests
cargo xtask e2e            # Playwright E2E against an isolated Docker stack
```

See [e2e/README.md](e2e/README.md) for the E2E harness.

## API Documentation

Swagger UI is served at `/swagger-ui/` whenever the server is running — the assets are
baked into the binary, so it works from any working directory.

## Frontend Docs

See [web/README.md](web/README.md) for the frontend monorepo structure, scripts, and
Storybook setup.

## Self-hosting

The full guide — Docker Compose, systemd, TLS, backups, upgrades and troubleshooting —
is at [`/self-host`](web/apps/web/src/app/self-host/page.tsx) in the running app.

## Licence

The site and the docs describe Neutrino as MIT licensed, but **no `LICENSE` file is
committed yet** and GitHub reports no licence for the repository. Add one before
relying on that claim.
