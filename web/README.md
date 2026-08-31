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

This package is a member of the pnpm workspace rooted at the **repo root**, so
dependencies are installed there once for both `web/` and `e2e/`:

```bash
pnpm install    # from the repo root — installs every workspace member
pnpm dev        # starts all apps in dev mode
```

## Scripts

`turbo.json` and the turbo tasks live at the repo root, so these run from there
rather than from `web/`:

| Command                    | Description                        |
|----------------------------|------------------------------------|
| `pnpm dev`                 | Start all apps in development mode |
| `pnpm build`               | Build all apps and packages        |
| `pnpm lint`                | Lint all packages                  |
| `pnpm type-check`          | Type-check all packages            |
| `pnpm test`                | Run the Vitest suite               |
| `pnpm e2e`                 | Run the Playwright suite in `e2e/` |

`pnpm test` is the one task that is not routed through turbo: `vitest.config.ts`
resolves its `@neutrino/*` aliases from the working directory, so the root script
runs it via `pnpm --filter neutrino-web test` to keep the cwd at `web/`.

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
