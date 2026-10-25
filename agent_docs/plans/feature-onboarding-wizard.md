# Plan: Onboarding phase 3 — the welcome wizard

Branch `feature/onboarding-wizard`, built on the phase 1, 2, 4 and 5 branches (#282, #285, #283,
#284) and `main`.

## Summary

A one-time, seven-step welcome dialog for new accounts, shown straight after the encryption-key
dialog: Encryption key (done before it opens), Look & theme, Your profile, AI assistant, Calendar,
Bring your files, Invite friends. Every step can be left alone; a step left with nothing done reads
"skipped". It is a 960×640 dialog over the dimmed Drive page. When it closes the user is in Drive
and the Drive tour starts by itself.

## Who sees it

`onboarding.welcome`, a synced user preference, `pending | done`, **default `done`**. The server
writes `pending` in `SignupService` on the three account-creation paths — self-serve, invite
sign-up and admin-created, the same ones the welcome email is sent from — and nowhere else. Finish
or close writes `done`. Because the default is `done`, an account the server never marked (every
account that exists today) cannot see it, with no migration or backfill; a bug in the client can at
worst fail to show it. Not a column: the preferences store already syncs, validates and lets the
client write the clearing value, and the tours' "seen" flag is read the same way.

## Tasks

1. Preference `onboarding.welcome` in the registry, the client types and `catalog.rs`; the server
   marks new accounts (`auth::signup`); Rust tests.
2. Wizard frame, step list rules (`steps.ts`), host hook, the six step bodies, CSS on tokens.
3. Shared pieces extracted rather than copied: the Apple Calendar connect dialog, the AI key pages,
   the named accent swatches; `aiApi.complete` takes credentials for "Test key"; the invite panel
   reports a used link.
4. Shell: open the wizard after the key gate; the Drive tour waits for it.
5. Vitest, Playwright `e2e/tests/onboarding/wizard.spec.ts`.

## Test plan

- `cargo test`: `auth::signup` (the mark on each creation path, and not on an existing user),
  `preferences::catalog`.
- Vitest: `__tests__/wizard/*` and the preference registry suite.
- Playwright: a new user sees it after the key dialog; the look restyles the app live and persists;
  walking and skipping; Finish lands in Drive with the tour starting; no reappearance on reload or a
  second sign-in; an existing user never sees it.

## Feature flag

None. The wizard is behind a server-written mark; revert the commit to remove it.
