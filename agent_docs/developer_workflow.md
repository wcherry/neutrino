# Developer Workflow

This document defines the standard process an agent must follow for every developer task in the Neutrino platform. Execute each step in order. A step marked opt-in may be skipped when it does not apply — say in the PR that you skipped it and why. Otherwise do not skip steps or combine them out of sequence.

---

## Step 1 — Create Branches

For every repo that requires changes, create a dedicated feature branch. The branch name must be consistent across all repos.

**Branch naming:** `feature/<short-kebab-description>`

```bash
git -C /Users/williamcherry/Playground/getneutrino.app/<repo> checkout -b feature/<name>
```

- Identify all affected repos before branching. Every repo is a sibling directory under
  `/Users/williamcherry/Playground/getneutrino.app/`. Candidates: `neutrino` (Rust backend + `web/`
  monorepo + `e2e/` + `worker/`), `neutrino_shared_ios`, `neutrino_docs_ios_mobile`,
  `neutrino_drive_ios_mobile`, `neutrino_notes_ios_mobile`, `neutrino_photos_ios_mobile`,
  `neutrino_sheets_ios_mobile`, `neutrino_slides_ios_mobile`, `neutrino_calendar_ios_mobile`,
  `neutrino_drive_mac_desktop`.
- Do NOT create branches in repos that require no changes.
- Confirm the branch was created in each repo before proceeding.

---

## Step 2 — Create and Save a Plan

Before writing any code, produce a written plan and save it.

**Save location:** `agent_docs/plans/<YYYY-MM-DD>-<short-description>.md`

The plan must include:

```markdown
# Plan: <Feature Name>

## Summary
One paragraph describing what this change does and why.

## Affected Repos
- repo-name — what changes and why

## Tasks
Numbered list of discrete implementation steps, each scoped to a single file or endpoint.

## Test Plan
- Unit: what to test per service
- E2E: which flows to cover in neutrino-e2e

## Open Questions
Any decisions that need user input before proceeding.
```

Save the file and confirm it exists before continuing.

---

## Step 3 — Write Tests First

Tests are written before implementation. This ensures tests are not shaped around the implementation.

### Unit Tests

Each Rust service uses its own inline test modules. Add tests in the same file as the code being tested, inside a `#[cfg(test)]` block.

- Test the happy path and at least one failure case for each new function or endpoint.
- For HTTP handlers, test with valid input, missing fields, and unauthorized access.

### E2E Tests

Add a spec file in `neutrino-e2e/tests/<feature-area>/`:

```
neutrino-e2e/tests/<feature-area>/<feature>.spec.ts
```

Follow the patterns in `neutrino-e2e/tests/drive/file-lifecycle.spec.ts`:
- Use `registerAndLogin` helpers or equivalent setup.
- Test the complete user-facing flow from the browser.
- Assert on both UI state and API responses where relevant.

Run the existing tests to confirm the baseline passes before making any changes:
```bash
cd e2e && pnpm exec playwright test
```

---

## Step 4 — No Feature Flags

**Neutrino is in beta, and nothing ships behind a feature flag.** Feature flags are for
after a stable public release. Until then every change ships unconditionally:

- Work that is not ready stays on its branch. It is not merged dark.
- A change that is risky to roll back is made safe some other way — additive, reversible,
  covered by tests — or rolled back by reverting the commit.
- Do not add a key to `src/drive/feature_flags/catalog.rs`, `FLAG_KEYS` in
  `web/apps/web/src/lib/featureFlags.ts` or the `feature_flags` table, and do not add a
  `FEATURE_*` environment variable. Tests in both suites assert the flag list is empty.

The flag mechanism itself (the table, `FeatureGate`, the endpoints and the admin console's
Feature Flags tab) is kept so it is ready after the release. If a change seems to need a kill
switch before then, say so and ask rather than adding one.

---

## Step 5 — Implement and Test

Implement the changes described in the plan, one task at a time.

- Complete one task, run its tests, confirm passing, then move to the next task.
- Do not accumulate multiple broken tasks at once.

**After each task:**
1. Run the unit tests for the affected service:
   ```bash
   cargo test -p <service-name>
   ```
2. Fix any failures before moving on.

**After all tasks are complete:**
1. Run the full e2e suite:
   ```bash
   cd /Users/williamcherry/Playground/getneutrino.app/neutrino/e2e && ./scripts/run-tests.sh
   ```
2. All tests must pass before proceeding. Fix failures before continuing.

---

## Step 6 — Write Manual Verification Steps

Write a `VERIFY.md` file at the root of the primary affected repo. This file documents how a human can manually confirm the feature works end-to-end.

**Format:**

```markdown
# Manual Verification: <Feature Name>

## Prerequisites
- Stack running locally via docker-compose-dev.yml

## Steps

### Happy Path
1. Open the browser at http://localhost:<port>
2. <Specific action>
3. <Expected result>

### Edge Cases
1. <Scenario>: <Steps> → <Expected result>

## Cleanup
Delete VERIFY.md once the feature is proven stable.
```

---

## Step 7 — Commit Changes

Commit each repo separately. Each commit must be scoped to only that repo's changes.

**Rules:**
- One commit per repo (or more if logically distinct changes require it).
- Commit message format: `<imperative verb> <what and why in one sentence>`
- Examples: `Add file-sharing endpoint with owner permission check`, `Encrypt note titles client-side before upload`
- Do NOT use `git add .` or `git add -A`. Stage specific files by name.
- Do NOT skip pre-commit hooks (`--no-verify` is not allowed).

```bash
git -C /Users/williamcherry/Playground/getneutrino.app/<repo> add <specific files>
git -C /Users/williamcherry/Playground/getneutrino.app/<repo> commit -m "<message>"
```

Confirm each commit succeeded before moving to the next repo.

---

## Step 8 — Push and Create PRs

Push each branch and open a PR. One PR per repo.

```bash
git -C /Users/williamcherry/Playground/getneutrino.app/<repo> push -u origin feature/<name>
gh pr create --repo wcherry/<repo> \
  --title "<Feature name>" \
  --body "$(cat <<'EOF'
## Summary
<1-3 bullets describing the change>

## Test Plan
- [ ] Unit tests pass (`cargo test`)
- [ ] E2E tests pass (`./scripts/run-tests.sh`)
- [ ] Manual verification steps in VERIFY.md completed

## Repos Included in This Feature
- [ ] neutrino-<repo-a> — link to PR
- [ ] neutrino-<repo-b> — link to PR

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Requirements:**
- All PRs for a single feature must reference each other in their descriptions.
- Do NOT merge any PR until all PRs in the feature set are open and reviewed.
- Post all PR URLs to the user before considering the task complete.
