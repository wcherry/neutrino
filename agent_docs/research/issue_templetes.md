GitHub supports both traditional Markdown templates and structured **Issue Forms**; for Neutrino I’d strongly favor Issue Forms for bugs and feature requests because you can require structured information. 

## Recommended issue types

I'd create these **8 issue types/templates**:

| Template | Purpose | Who uses it |
|---|---|---|
| 🐛 Bug Report | Something isn't working correctly | Everyone |
| ✨ Feature Request | New functionality | Everyone |
| 🔧 Improvement | Improve existing functionality without being a major feature | Everyone |
| 🏗️ Epic / Initiative | Large multi-issue project | Maintainers |
| 📱 Platform / Compatibility | Browser, OS, mobile, Docker, etc. compatibility | Everyone |
| 🔒 Security Issue | Security vulnerabilities | Everyone |
| 📚 Documentation | Missing/incorrect documentation | Everyone |
| 🧹 Maintenance / Technical Debt | Refactoring, dependencies, cleanup, infrastructure | Maintainers |

I'd also have **Support / Question**, but I'd consider routing that to Discussions rather than creating an issue. GitHub's template configuration can provide contact links and disable blank issues for regular contributors. 

---

# 1. 🐛 Bug Report

This should be your most structured form.

### Fields

**What happened?**

> Describe the problem.

**Steps to reproduce**

1. ...
2. ...
3. ...

**Expected behavior**

> What should have happened?

**Actual behavior**

> What happened instead?

**Affected application**

Dropdown:

- Calendar
- Docs
- Drive
- Notes
- Photos
- Sheets
- Slides
- Authentication
- Search
- Sharing
- Encryption
- API
- Web UI
- Docker / Deployment
- Other

**Environment**

- Neutrino version
- Browser
- OS
- Installation method
- Docker image/version, if applicable

**Logs / error messages**

Upload/paste logs.

**Screenshots / recordings**

Optional upload.

**Can you reproduce this consistently?**

- Always
- Sometimes
- Once
- Unknown

This is a perfect candidate for an Issue Form because GitHub supports dropdowns, text fields, checkboxes and uploads. 

---

# 2. ✨ Feature Request

I'd make this less restrictive than the bug form.

### Fields

**What problem would this solve?**

This is more useful than simply asking "what feature do you want?"

**Proposed solution**

> Describe what you'd like Neutrino to do.

**Alternative solutions**

> How are you currently solving this?

**Affected application**

Same dropdown as the bug form.

**Who would benefit?**

- Individual users
- Families
- Teams
- Administrators
- Developers
- Self-hosters
- Other

**Priority / importance**

I'd actually make this optional. Don't ask users to determine your internal priority.

---

# 3. 🔧 Improvement

This is important for Neutrino because you'll have a lot of things that aren't really "features."

Examples:

- Improve photo browsing performance
- Make Drive search faster
- Improve spreadsheet keyboard navigation
- Improve mobile layout
- Simplify login flow
- Improve error messages
- Reduce memory usage

I'd distinguish it from Feature Request:

> **Feature:** Neutrino can't do X → add X  
> **Improvement:** Neutrino does X, but it could be substantially better.

Fields:

- Area
- Current behavior
- Proposed improvement
- Why it matters
- Screenshots/examples
- Related issue

---

# 4. 🏗️ Epic / Initiative

This is the one I'd make **maintainer-only**.

Neutrino has enough scope that you'll frequently have projects like:

> "Add Shared Team Spaces"

or

> "Implement Neutrino Photos"

that should be broken into dozens of smaller issues.

GitHub explicitly supports using issues for large initiatives and then linking smaller issues underneath them. 

### Template

```text
## Goal

What are we trying to accomplish?

## Background

Why are we doing this?

## Scope

What is included?

## Out of scope

What is explicitly NOT included?

## Proposed architecture

...

## Milestones

- [ ] Phase 1
- [ ] Phase 2
- [ ] Phase 3

## Child issues

- [ ] #123
- [ ] #124
- [ ] #125

## Dependencies

...

## Acceptance criteria

- [ ] ...
- [ ] ...
```

This could become the backbone of your Neutrino roadmap.

---

# 5. 📱 Platform / Compatibility

I'd have this because Neutrino is going to span quite a few environments.

Examples:

- Safari problem
- iOS problem
- Android problem
- macOS problem
- Windows problem
- Linux problem
- Docker problem
- ARM problem
- Mobile responsive issue

However, I **wouldn't create separate templates for each platform**.

Instead:

**Platform**

- Web
- iOS
- macOS
- Android
- Windows
- Linux
- Docker
- Server
- API
- Multiple

Then use labels.

---

# 6. 🔒 Security Issue

I'd make this a special case.

For a project containing:

- authentication
- JWTs
- TOTP
- E2E encryption
- file storage
- sharing
- OAuth
- potentially sensitive user data

you don't want people publicly posting vulnerabilities in a normal bug template.

I'd instead have a very small public template saying something like:

> **Please do not disclose security vulnerabilities publicly. See the project's security policy for private reporting instructions.**

And configure GitHub's security reporting mechanism if you intend to accept vulnerability reports there.

---

# 7. 📚 Documentation

Simple template:

**What documentation needs improvement?**

**Where is it located?**

**What's wrong/missing?**

**Suggested improvement**

This is particularly useful for:

- installation
- Docker deployment
- configuration
- API
- development setup
- contributing
- encryption
- backup/recovery

---

# 8. 🧹 Maintenance / Technical Debt

This is mostly for maintainers/contributors.

Examples:

- Upgrade Next.js
- Upgrade Rust
- Replace deprecated API
- Refactor authentication
- Improve test coverage
- Remove dead code
- Database migration cleanup
- CI optimization
- Docker optimization
- Dependency vulnerability

I'd include:

**Type**

- Refactoring
- Dependency update
- CI/CD
- Testing
- Performance
- Infrastructure
- Database
- Code cleanup
- Developer experience

**Why is this needed?**

**Proposed approach**

**Risks**

**Acceptance criteria**

---

# Labels

I would **not** use labels as your issue types if you can use GitHub's native issue types.

Instead, I'd make labels describe **attributes** of an issue.

For Neutrino I'd use roughly:

### Type

- `bug`
- `feature`
- `enhancement`
- `maintenance`
- `documentation`
- `security`

### Component

- `app:calendar`
- `app:docs`
- `app:drive`
- `app:notes`
- `app:photos`
- `app:sheets`
- `app:slides`
- `component:auth`
- `component:search`
- `component:encryption`
- `component:api`
- `component:storage`
- `component:ui`

### Platform

- `platform:web`
- `platform:ios`
- `platform:macos`
- `platform:android`
- `platform:windows`
- `platform:linux`
- `platform:docker`

### Priority

I'd keep this small:

- `priority:critical`
- `priority:high`
- `priority:medium`
- `priority:low`

### Status

I'd **avoid status labels** such as `in-progress`, `needs-review`, etc. Use GitHub Projects/status fields for those instead.

---

# One important change I'd make for Neutrino

Because your repo is a **single project repository containing many applications**, I would make **"Affected Application" mandatory on bugs and feature requests**.

Your current structure makes this particularly valuable:

```text
src/
  auth/
  calendar/
  docs/
  drive/
  notes/
  photos/
  sheets/
  slides/

web/
  apps/
  packages/
``` 


That means you can very quickly create filtered views such as:

> Photos bugs

> Sheets feature requests

> Authentication security issues

> All high-priority Drive issues

without creating a separate issue system for every application.

---

# Suggested template chooser

I'd make the new-issue screen look approximately like:

### 🐛 Report a Bug
Something isn't working correctly.

### ✨ Request a Feature
Suggest new functionality.

### 🔧 Improve Neutrino
Suggest an improvement to something that already exists.

### 📱 Platform / Compatibility
Report an OS, browser, mobile, Docker, or hardware-specific problem.

### 📚 Documentation
Something is missing, incorrect, or unclear.

### 🧹 Maintenance
Technical debt, refactoring, dependencies, CI/CD, etc.

### 🏗️ Epic / Initiative
**Maintainers:** Track a large project consisting of multiple issues.

### 🔒 Security Vulnerability
Privately report a security problem.

I'd disable the normal **Blank issue** option for outside contributors so that reports consistently come through the appropriate forms. GitHub supports exactly this configuration. 

---

## One more thing: don't over-template

For a project at Neutrino's stage, I think **8 is about the upper limit**.

I would **not** create separate templates for:

- Performance
- UI/UX
- API
- Database
- Docker
- Mobile
- Backend
- Frontend
- Authentication
- Photos
- Sheets
- etc.

Those are **components/attributes**, not issue types.

That distinction will keep the issue chooser manageable while still giving you excellent filtering.

### My recommended hierarchy

```text
ISSUE TYPE
├── Bug
├── Feature
├── Improvement
├── Maintenance
├── Documentation
├── Compatibility
├── Epic
└── Security

        ↓

COMPONENT
├── Calendar
├── Docs
├── Drive
├── Notes
├── Photos
├── Sheets
├── Slides
├── Auth
├── Encryption
├── Search
├── API
└── Infrastructure

        ↓

PLATFORM
├── Web
├── iOS
├── macOS
├── Android
├── Windows
├── Linux
└── Docker

        ↓

PRIORITY
├── Critical
├── High
├── Medium
└── Low
```

That's a structure I'd be comfortable using for Neutrino as it grows from a personal project into a genuine open-source project.

If you want to implement this, GitHub's templates live under `.github/ISSUE_TEMPLATE/`, and numbered filenames can control the chooser order. 