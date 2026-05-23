# Developer Workflow

This document defines the standard process an agent must follow for every developer task in the Neutrino platform. Execute each step in order. Do not skip steps or combine them out of sequence.

---

## Step 1 — Create Branches

For every repo that requires changes, create a dedicated feature branch. The branch name must be consistent across all repos.

**Branch naming:** `feature/<short-kebab-description>`

```bash
git -C /Users/williamcherry/neutrino-repos/<repo> checkout -b feature/<name>
```

- Identify all affected repos before branching. Typical candidates: `neutrino-auth`, `neutrino-drive`, `neutrino-notes`, `neutrino-worker`, `neutrino-web`, `neutrino-shared`, `neutrino-e2e`.
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
Name: `FEATURE_<SCREAMING_SNAKE>` — describe what it gates and its default value.

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
cd /Users/williamcherry/neutrino-repos/neutrino-e2e && npx playwright test
```

---

## Step 4 — Add a Feature Flag

Every change must be gated behind a feature flag so it can be enabled or disabled without a redeploy.

### Implementation

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
1. Enable the feature flag (`FEATURE_<NAME>=true`) in the test environment.
2. Run the full e2e suite:
   ```bash
   cd /Users/williamcherry/neutrino-repos/neutrino-e2e && ./scripts/run-tests.sh
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
- FEATURE_<NAME>=true set in the environment

## Steps

### Happy Path
1. Open the browser at http://localhost:<port>
2. <Specific action>
3. <Expected result>

### Edge Cases
1. <Scenario>: <Steps> → <Expected result>

### Feature Disabled
1. Set FEATURE_<NAME>=false and restart the service.
2. Confirm <expected disabled behavior>.

## Cleanup
Delete VERIFY.md after the feature flag is removed.
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
git -C /Users/williamcherry/neutrino-repos/<repo> add <specific files>
git -C /Users/williamcherry/neutrino-repos/<repo> commit -m "<message>"
```

Confirm each commit succeeded before moving to the next repo.

---

## Step 8 — Push and Create PRs

Push each branch and open a PR. One PR per repo.

```bash
git -C /Users/williamcherry/neutrino-repos/<repo> push -u origin feature/<name>
gh pr create --repo wcherry/neutrino-<repo> \
  --title "<Feature name>" \
  --body "$(cat <<'EOF'
## Summary
<1-3 bullets describing the change>

## Feature Flag
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
