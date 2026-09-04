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
  `neutrino_sheets_ios_mobile`, `neutrino_slides_ios_mobile`, `neutrino_drive_mac_desktop`.
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

## Feature Flag
Only if this change is being gated (see Step 4). Name: `FEATURE_<SCREAMING_SNAKE>` —
describe what it gates and its default value. Omit this section entirely when there
is no flag.

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

## Step 4 — Add a Feature Flag (opt-in)

**A feature flag is optional.** Most changes ship unflagged. Add one only when this
change specifically needs to be switched off without a redeploy — and when you do,
say so in the plan (Step 2) and in the PR.

Reach for a flag when:

- The change is risky to roll back — a migration-adjacent behaviour change, a new
  write path, something touching auth or encryption.
- It lands across repos that release on different schedules, so the server side has
  to sit dark until the clients catch up.
- It is genuinely incomplete and has to be merged anyway to unblock other work.
  Prefer a branch; a flag is the fallback when the branch would live too long.

Do not add one:

- To hide unfinished work that could just as easily stay on a branch.
- Around a self-contained change behind existing UI, where the way to disable it is
  to revert the commit.
- Out of habit, because the last change had one.

An unnecessary flag is not free: it is a second code path that has to be built,
tested in both states, and then removed.

### Implementation (when you are adding one)

Use an environment variable checked at runtime:

**In Rust services**, read the flag from the environment at startup or at the call site:
```rust
let feature_enabled = std::env::var("FEATURE_<NAME>").unwrap_or_default() == "true";
```

**In TypeScript (web/worker)**, read from the environment:
```typescript
const featureEnabled = process.env.FEATURE_<NAME> === 'true';
```

### Requirements
- Default value must be `false` (disabled) unless there is an explicit reason to default on.
- Document the flag name, description, and default in the plan (Step 2).
- Add the flag to `docker-compose-dev.yml` under the relevant service, set to `false`.
- Add the flag to `docker-compose-test.yml` in `neutrino-e2e/` so e2e tests can control it.
- The feature flag must be removable in one cleanup PR once the feature is proven stable.
  Name that follow-up when you add the flag; a flag with no removal plan is permanent.

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
1. If the change is flagged, enable it (`FEATURE_<NAME>=true`) in the test environment.
   An unflagged change needs nothing here.
2. Run the full e2e suite:
   ```bash
   cd /Users/williamcherry/Playground/getneutrino.app/neutrino/e2e && ./scripts/run-tests.sh
   ```
3. All tests must pass before proceeding. Fix failures before continuing.

---

## Step 6 — Write Manual Verification Steps

Write a `VERIFY.md` file at the root of the primary affected repo. This file documents how a human can manually confirm the feature works end-to-end.

**Format:**

```markdown
# Manual Verification: <Feature Name>

## Prerequisites
- Stack running locally via docker-compose-dev.yml
- (flagged changes only) FEATURE_<NAME>=true set in the environment

## Steps

### Happy Path
1. Open the browser at http://localhost:<port>
2. <Specific action>
3. <Expected result>

### Edge Cases
1. <Scenario>: <Steps> → <Expected result>

### Feature Disabled
Only for a flagged change; omit this section otherwise.
1. Set FEATURE_<NAME>=false and restart the service.
2. Confirm <expected disabled behavior>.

## Cleanup
Delete VERIFY.md once the feature is proven stable — for a flagged change, in the
same PR that removes the flag.
```

---

## Step 7 — Commit Changes

Commit each repo separately. Each commit must be scoped to only that repo's changes.

**Rules:**
- One commit per repo (or more if logically distinct changes require it).
- Commit message format: `<imperative verb> <what and why in one sentence>`
- Examples: `Add file-sharing endpoint with owner permission check`, `Gate note encryption behind FEATURE_ENCRYPTION flag`
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

## Feature Flag
Include this section only for a flagged change; drop it otherwise rather than
writing "none".
`FEATURE_<NAME>` — defaults to `false`. Set to `true` to enable.

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
