# neutrino-e2e

End-to-end tests for the Neutrino platform using [Playwright](https://playwright.dev/).

Each test run spins up a fully isolated Docker stack, captures all observable state, and tears everything down when done.

## Prerequisites

- Docker
- Node.js 20+
- `pnpm` 10+ — the only package manager used in this repo (`corepack enable`
  will pick up the pinned version from `packageManager`)
- `openssl` (used to generate run IDs and the stack secrets)

## Setup

### 1. Install dependencies — from the repo root

`e2e/` and `web/` are members of one pnpm workspace rooted at the repo root, so
a single install at the root covers both:

```bash
cd ..           # the repo root, not e2e/
pnpm install
```

Installing from inside `e2e/` alone is not enough. The E2EE fixtures import
`@neutrino/e2e-crypto` straight out of `web/packages/` and resolve its runtime
dependencies (`libsodium-wrappers`, `hash-wasm`) from that package — a root
install is what puts them there. Skipping it is what produces
`Error: Cannot find module 'libsodium-wrappers'` on a fresh clone.

### 2. Install the Playwright browsers

```bash
pnpm exec playwright install chromium
```

### 3. Create the stack secrets

`docker-compose-test.yml` mounts two Docker secrets from `secrets/`. That
directory is gitignored and is never generated for you, so the stack fails to
start until the files exist:

```bash
mkdir -p secrets
openssl rand -hex 32 > secrets/jwt_secret.txt
openssl rand -hex 32 > secrets/worker_secret.txt
```

Any non-empty value works — the tests only need the services to agree on it.

### 4. Optional: override the defaults

```bash
cp .env.example .env
```

## Running tests

### Full run (build images + test)

```bash
./scripts/run-tests.sh
```

This will:
1. Build each service from its local repo with `--no-cache`, or pull the latest image from GHCR if the repo isn't present
2. Start the full Docker stack on port `9880`
3. Run all Playwright tests
4. Save all artifacts and tear down the stack

### Build a single service image

To rebuild only one service without touching the others:

```bash
docker build --no-cache -t neutrino-<svc>:test ../neutrino-<svc>
```

For example, to rebuild just the `auth` service:

```bash
docker build --no-cache -t neutrino-auth:test ../neutrino-auth
```

Then use `--skip-build` when running tests so the rest of the images are reused as-is:

```bash
./scripts/run-tests.sh --skip-build
```

### Skip image rebuild

Reuse existing `:test` images when iterating on tests:

```bash
./scripts/run-tests.sh --skip-build
```

### Run a specific test file

```bash
./scripts/run-tests.sh --skip-build tests/auth/login.spec.ts
```

### Run Playwright directly

If the stack is already running (e.g. started manually):

```bash
export RUN_DIR=/tmp/neutrino-e2e/manual
pnpm exec playwright test
```

## Viewing results

After a run the script prints the artifact directory:

```
Run artifacts saved to: /tmp/neutrino-e2e/20260328_120000_abc123de
```

Open the HTML report:

```bash
pnpm exec playwright show-report /tmp/neutrino-e2e/<run-id>/playwright-report
```

## Artifact layout

Every run produces a self-contained directory under `/tmp/neutrino-e2e/<run-id>/`:

```
<run-id>/
├── .run_meta.json          # Run ID, start time
├── data/                   # SQLite databases (live, written by services)
│   ├── auth/
│   ├── drive/
│   └── ...
├── databases/              # Database snapshots copied at teardown
│   ├── auth_auth.db
│   └── ...
├── service-logs/           # Per-service runtime logs
│   ├── auth/               # Written live by the service
│   ├── auth.log            # Docker stdout/stderr captured at teardown
│   └── ...
├── browser-logs/           # Console messages + network log per test (JSON)
├── playwright-artifacts/   # Traces, screenshots, videos (outputDir)
└── playwright-report/      # HTML report (open with show-report)
```

## Image strategy

| Situation | What happens |
|---|---|
| Local repo exists (`../neutrino-<svc>`) | `docker build --no-cache` from source |
| Local repo missing | `docker pull ghcr.io/$GHCR_OWNER/neutrino-<svc>:latest` |

Set `GHCR_OWNER` in `.env` or as an environment variable (default: `williamcherry`).

All images are tagged `neutrino-<svc>:test` and the stack uses a dedicated `neutrino-test` network and port `9880`, so it never conflicts with a running dev environment on port `8880`.

## Port mapping

| Port | Service |
|---|---|
| `9880` | Web (nginx → all backends) |

All backend services are internal to the `neutrino-test` Docker network.

## Adding tests

1. Create a new spec file under `tests/`
2. Import `test` and `expect` from `../../fixtures/base` (not directly from `@playwright/test`) to get automatic console and network capture
3. Use `http://localhost:9880` as the base URL (configured in `playwright.config.ts`)
