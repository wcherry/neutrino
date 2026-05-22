# neutrino-web

Frontend monorepo for the Neutrino suite, built with Next.js, pnpm workspaces, and Turborepo.

## Structure

```
apps/
  web/          # Next.js app — all user-facing routes
packages/
  api-*         # API client packages (calendar, core, docs, drive, notes, photos, sheets, slides)
  auth/         # Authentication utilities
  e2e-crypto/   # End-to-end encryption helpers
  hooks/        # Shared React hooks
  layout/       # Shared layout components
  tokens/       # Design tokens
  ui/           # Shared UI components
  utils/        # Shared utilities
```

## Apps

The main app (`apps/web`) includes:

- **Calendar** — event scheduling
- **Docs** — document editing
- **Drive** — file storage and management
- **Notes** — quick notes (Keep-style)
- **Photos** — photo library
- **Sheets** — spreadsheet editor
- **Slides** — presentation editor

## Getting Started

```bash
pnpm install
pnpm dev        # starts all apps in dev mode
```

## Scripts

| Command                    | Description                        |
|----------------------------|------------------------------------|
| `pnpm dev`                 | Start all apps in development mode |
| `pnpm build`               | Build all apps and packages        |
| `pnpm lint`                | Lint all packages                  |
| `pnpm type-check`          | Type-check all packages            |
| `pnpm test`                | Run tests                          |

## Storybook

The `@neutrino/ui` component library includes a Storybook for browsing and developing components in isolation.

```bash
# Start the Storybook dev server (port 6006)
pnpm --filter @neutrino/ui storybook

# Build a static Storybook
pnpm --filter @neutrino/ui build-storybook
```

Stories live in [`packages/ui/src/stories/`](packages/ui/src/stories/) and cover all component categories: primitives, inputs, feedback, containers, and navigation.

## Docker

A `Dockerfile` is included for production builds. See the root `docker-compose-dev.yml` and `docker-compose-prod.yml` for the full stack setup.
