---
description: Branch if needed, commit the work, run cargo e2e, push, and open a PR
argument-hint: "[optional title or short description of the change]"
allowed-tools: Bash(git status:*), Bash(git branch:*), Bash(git log:*)
---

## Current state

- Branch: !`git branch --show-current`
- Uncommitted changes: !`git status --short`
- Recent commits: !`git log --oneline -5`
- Ahead of main: !`git log --oneline origin/main..HEAD`

## Task

Ship the current work as a pull request. `$ARGUMENTS` is the user's description of the
change, if they gave one — use it for the branch name, commit subject and PR title
rather than inventing your own. Work through the steps in order and stop at the first
one that cannot be completed.

### 1. Be on a proper branch

Never commit to `main`. If the branch above is `main`, create
`feature/<short-kebab-description>` from the work being shipped and switch to it. If
it is already a feature branch, stay on it.

Branch names stay identical across every repo touched by one change — see the root
`CLAUDE.md`. If the change also touches a sibling repo under
`/Users/williamcherry/Playground/getneutrino.app/`, say so now: each repo needs its
own branch of the same name and its own PR, and this command only handles this one.

### 2. Commit everything

If the tree is dirty, commit it. If it is already clean and there are commits ahead of
`origin/main`, move on.

- Stage specific files by name. Never `git add .` or `git add -A`.
- Never `--no-verify`; if a pre-commit hook fails, fix the cause.
- Subject line in the repo's conventional style: `feat(sheets): …`, `fix(drive): …`,
  `test(docs): …`. Reference the issue number when there is one.
- The body says *why*, not just what — that is the house style in `git log`.
- End the message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

### 3. Run the e2e suite

```bash
cargo e2e
```

It builds `neutrino:test` from local source, brings its own Docker stack up through
Playwright's `global-setup`, and tears it down after — the stack does not need to be
running first, only the Docker daemon. It takes a long time, so run it in the
background and wait for the completion notification. Do not poll it with `sleep`.

Report the real outcome: how many specs passed, and the name of every one that failed.
Never describe a suite you did not run as blocked.

### 4. If the e2e suite fails

Do not push. Summarise the failures — spec name, the assertion, and whether they look
related to this change — then ask the user with `AskUserQuestion`, offering exactly:

- **Fix them** — diagnose and repair. Re-run the failing specs alone first
  (`cargo e2e tests/<area>/<spec>.spec.ts`), then the full suite once they pass, and
  come back to this step with the new result. Commit the fixes as in step 2.
- **Ignore and continue** — proceed to step 5, and record the failures verbatim in the
  PR body under a `## Known failing e2e` heading so the reviewer sees them.
- **Cancel** — stop here. The branch and commits stay as they are; report what was
  committed and what failed, and do not push or open a PR.

Take the answer literally: on cancel, nothing is pushed.

### 5. Push

```bash
git push -u origin <branch>
```

### 6. Open the PR

Use `gh pr create --repo wcherry/neutrino`. Title matches the commit subject. Body:

```markdown
Closes #<issue>.   ← only if there is a real issue

## Summary
<2-4 bullets: what changed and why, in the terms the code is written in>

## Test plan
- [x] <unit tests / type-check / lint, with the numbers>
- [x] <e2e result — or the Known failing e2e section if the user chose Ignore>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Skip sections that would be empty rather than padding them. Deviations from
`agent_docs/developer_workflow.md` (no feature flag, no plan doc, no `VERIFY.md`)
belong in the PR body or your reply, stated plainly with the reason.

Post the PR URL to the user when it is open.
