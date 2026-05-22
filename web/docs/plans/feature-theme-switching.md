# Plan: Light/Dark Mode Theme Switching

## Branch
`feature/theme-switching`

## What is changing and why

The app already has a complete `[data-theme="dark"]` block in `packages/tokens/src/colors.css` and theme-selection UI on both the profile and settings pages, but nothing actually applies `data-theme` to the DOM. This work wires the full pipeline: storage → context → DOM attribute → anti-FOUC script.

## Layers affected

| Layer | Change |
|---|---|
| Frontend (new file) | `apps/web/src/providers/ThemeProvider.tsx` — context, hook, localStorage, media-query listener |
| Frontend (modify) | `apps/web/src/app/layout.tsx` — anti-FOUC inline script + wrap tree in `<ThemeProvider>` |
| Frontend (modify) | `apps/web/src/app/(apps)/profile/page.tsx` — wire theme buttons to `useTheme` hook |
| Tests | Unit tests for `ThemeProvider` hook |

Note: `apps/web/src/app/(apps)/settings/page.tsx` does **not** exist on main (it lives only on `feature/settings-page`). It will not be touched here.

## Feature flag

This change has no progressive rollout risk — it is purely additive wiring of already-present CSS. No feature flag is required. The `[data-theme="dark"]` CSS already ships in production; we are only adding the JS that sets the attribute.

## Acceptance criteria

1. On first load with no localStorage key, the app respects the OS preference (light or dark).
2. Choosing "Light" on the profile page immediately switches the UI to light, persists across refresh.
3. Choosing "Dark" on the profile page immediately switches the UI to dark, persists across refresh.
4. Choosing "System" reverts to OS preference; changes when OS preference changes.
5. No flash of wrong theme on hard reload (anti-FOUC script fires before paint).
6. The profile form save button still saves all other fields; theme is synced to server silently via `useEffect`.
7. TypeScript compiles with zero errors.

## Known risks / edge cases

- SSR: `ThemeProvider` is a client component; `document` is only available on the client. The provider must guard with `typeof window !== 'undefined'` or `useEffect` before touching localStorage/matchMedia.
- Next.js inline script: must use `dangerouslySetInnerHTML` and be a `<script>` element, not JSX text. Must be placed before stylesheet `<link>` tags.
- `suppressHydrationWarning` may be needed on `<html>` since the anti-FOUC script mutates `data-theme` before React hydrates.
