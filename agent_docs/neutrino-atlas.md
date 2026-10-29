# Neutrino Atlas — Feature Roadmap

**Date:** 2026-10-29
**Status:** Proposed
**Owner:** William Cherry

## What this is

Neutrino Atlas is a personal knowledge base on the Neutrino backend, in the space of Obsidian,
Notion, Logseq, Anytype and Roam. It is a **new, separate app**. It does not replace Neutrino
Notes. Notes stays the quick-capture scratchpad, and Atlas is where knowledge is structured,
linked and kept.

### Decisions already made

| Decision | Choice | Consequence |
|---|---|---|
| Name | **Neutrino Atlas** | Keychain/prefs prefix `natlas`; OAuth client ids `neutrino-atlas-mac`, `neutrino-atlas-ios`, later `neutrino-atlas-android`. The web client uses the existing web app's auth. |
| Relationship to Notes | Separate app | New file type, OAuth clients and prefix. Import from Notes is a feature, not a migration. |
| Encryption | **E2EE by default** | The server never sees titles, content, tags or properties. Search, link resolution, AI and the graph all run on the client. |
| Audience | Individual PKM first | Team features (shared vaults, permissions, real-time co-editing) come in Phase 2. |
| Platform order | **Desktop → iOS → Web → Android** | Desktop is the primary surface and must work offline. Every other client syncs against the same encrypted vault. |
| Desktop stack | **Native** (SwiftUI on macOS) | Matches `neutrino_drive_mac_desktop`; shares Swift code with iOS. |
| Editor | **Native editor** on each platform | macOS and iOS share one Swift editor (TextKit 2); web uses Tiptap; Android uses Compose. Three editors must agree on one Markdown dialect (see constraint 3). |
| Storage | **Markdown files live on the server** | Every page is an encrypted `.md` file in Drive. Devices keep only an encrypted cache for offline use, with no plaintext folder on disk. Markdown is the canonical format on every platform. |
| Monetisation | **No paid tier, no feature gating** | Every feature ships to every user; no feature-flag tiering to design. |
| Shared Swift code | **New `AtlasKit` package** on top of a macOS-enabled `NeutrinoShared` | Editor, parser, index and sync live outside `neutrino_shared_ios`, so editor changes don't rebuild the seven existing iOS apps. Auth, keychain and crypto come from `NeutrinoShared` on both Mac and iOS. Prerequisite: [neutrino_drive_mac_desktop#35](https://github.com/wcherry/neutrino_drive_mac_desktop/issues/35). |
| Web client | **Part of the existing web app** | Atlas is a new route area in `neutrino/web/apps/web`, alongside Notes, Docs and Sheets. |
| Windows | **Eventually, out of scope here** | A native Windows client is planned but not covered by this roadmap. |

### Positioning

The market splits on one trade-off. Atlas is built to resolve it.

- **Obsidian / Logseq**: local-first, private, plain files, fast. Sync, mobile and collaboration
  are add-ons or weak.
- **Notion / Coda**: structured databases, polished collaboration, web everywhere. Data sits on
  their servers in plaintext, it is slow offline, and lock-in is real.
- **Neutrino Atlas**: native speed, offline use and privacy *with* structured data and
  collaboration, E2EE across every device, and plain Markdown underneath so export is lossless.
  It also links to the Docs, Sheets, Slides, Drive, Photos and Calendar that the user already
  keeps on Neutrino. That last part is the differentiator no competitor can copy cheaply. And
  everything is free, with nothing behind a paywall.

---

## Architecture constraints (read before scoping any phase)

These come from the existing platform and the decisions above. They drive the shape of every phase.

1. **Pages are encrypted Markdown files in Drive.** Same pattern as the Notes redesign
   (`notes-redesign.md`): no Atlas-specific CRUD API. Content, versions, trash, sharing and
   quota come from Drive. A vault is a Drive folder tree; each page is one `.md` file, and
   attachments are ordinary Drive files beside it. Drive only ever stores the encrypted blob.
   Clients keep an **encrypted** local cache (SQLite or similar, keyed from the key vault) for
   offline reads and queued writes. There is never a plaintext copy on disk.
2. **The link graph stays on the client.** Titles are encrypted (`encrypted_metadata`,
   `end-to-end-encryption.md`), so the server can't resolve `[[Title]]`. Even id-to-id link rows
   would leak the graph's shape. Atlas therefore **does not use `src/links/` / `file_links`**.
   Links, backlinks and the graph are computed from the Markdown in each client's encrypted
   local index.
3. **One Markdown dialect, three editors.** Swift (macOS + iOS), Tiptap (web) and Compose
   (Android) all read and write the same `.md` files. Define a written **Atlas Markdown spec**
   in Phase 1, covering CommonMark + GFM plus extensions:
   - `[[links]]`, `[[Page|alias]]`, `[[Page#Heading]]`
   - `^block-id` anchors, `![[embeds]]`, `#nested/tags`
   - YAML frontmatter for properties
   - callouts, `$math$`, and later flashcard syntax

   Back it with a **shared conformance corpus** (input `.md` → expected AST → re-serialised
   `.md`) that every editor's CI runs. This works the same way the crypto crosscheck scripts
   keep five implementations in agreement. Round-tripping must be byte-stable, or three
   editors will keep reformatting each other's files and generating spurious versions and
   conflicts.
4. **Search is client-side.** This matches the design in `search.md`: a per-user local index,
   synced as an encrypted hidden file, with SSE to tell other devices to refresh. Atlas should be
   the first full implementation of that design, not a one-off.
5. **Live collaboration can't use the Docs collab server as-is.** `src/docs/collab/` keeps a live
   plaintext `yrs::Doc` per room. E2EE co-editing needs the server to *relay and persist encrypted
   CRDT updates* without reading them. Clients periodically compact those updates and write the
   result back as the encrypted `.md` file, which stays the source of truth. This is new
   backend work and the main Phase 2 risk. It also needs a CRDT that runs natively in Swift,
   Kotlin and TS, mapped onto the Markdown AST. Which CRDT is a research task, scheduled
   before Phase 2 (see [Research](#research-before-phase-2)).
6. **`AtlasKit` holds the shared Swift code.** A new SwiftPM package (`wcherry/neutrino_atlaskit`,
   checked out as the sibling `neutrino_atlaskit/`) contains the editor, Markdown parser,
   index and sync engine, and supports both macOS and iOS. It depends on `NeutrinoShared` for
   identity, OAuth, keys and crypto; `NeutrinoShared` must never depend on it. Consume it by
   local path like `NeutrinoShared`, which means rule 2 of the root `CLAUDE.md` applies: after
   changing it, build both Atlas apps, not just the package. Layer it like `NeutrinoShared`:
   - `AtlasCore`: Foundation-only. Markdown spec parser/serialiser, link and tag extraction,
     local index, sync. Share extensions, widgets and App Intents can link it.
   - `AtlasEditor`: TextKit 2 editor, with platform adapters for AppKit and UIKit.
   - `AtlasUI`: shared SwiftUI views (sidebar, backlinks, search, switcher).

   **Prerequisite (blocks Phase 1):**
   [wcherry/neutrino_drive_mac_desktop#35](https://github.com/wcherry/neutrino_drive_mac_desktop/issues/35).
   `NeutrinoShared` is iOS-only today (`platforms: [.iOS(.v16)]`). The macOS Drive app shares
   no code with it: `NeutrinoDriveCore` has its own copy of the auth, keychain and E2EE code.
   That ticket makes `NeutrinoCore`, `NeutrinoAuth` and `NeutrinoCrypto` build for macOS 13
   and moves the Drive app onto them, which drops the E2EE implementation count from five to
   four. Atlas then builds on the same, already-proven macOS foundation and adds no
   implementation of its own. Do not start AtlasKit's sync or crypto work until #35 lands.
7. **Cross-repo checklist for a new app** (root `CLAUDE.md`): OAuth client migrations, the
   `natlas` keychain/prefs prefix, an `NeutrinoAppConfig+Apps.swift` entry, and an
   `NeutrinoApps` entry on Android when that phase arrives. New repos are
   `neutrino_atlaskit`, `neutrino_atlas_mac_desktop`, `neutrino_atlas_ios_mobile` and later
   `neutrino_atlas_android_mobile`. Add each one to the root `CLAUDE.md` repo table as it is
   created.

---

## Phase 1 — MVP

**Goal:** One person can replace Obsidian with this for daily notes and linked thinking, on the
Mac, offline, encrypted, synced. iOS ships at the end of the phase (or straight after) as a
companion for capture and reading.

**Exit criteria:** A 5,000-page vault opens in under 1 s, searches in under 100 ms and syncs between two Macs and a
phone with no data loss and no plaintext reaching the server or the disk.

### Editor (native, Markdown-backed)
- Live-preview Markdown editor: headings, lists, to-dos, quotes, code blocks with syntax
  highlighting, tables, dividers, callouts, images, file attachments. Markdown syntax hides
  when the cursor leaves a line, as in Obsidian's Live Preview.
- Markdown shortcuts as you type, plus a `/` command menu.
- Source mode toggle; Markdown paste-in and copy-out that round-trip with no loss.
- Move blocks with a drag handle or keyboard; indent/outdent nested lists.
- Autosave with a save-state indicator. Drive versioning gives page history and restore.
- Atlas Markdown spec v1 and its conformance corpus (constraint 3) land with the editor.

### Linking (the core of a KB)
- `[[Wiki links]]` with fuzzy autocomplete across page titles; aliases (`[[Page|shown text]]`).
- Create a page by linking to one that doesn't exist yet.
- Renaming a page rewrites links to it across the vault. The client does this, since the
  server can't read the content, and it is one batched sync operation.
- **Backlinks panel** on every page, including **unlinked mentions** (the title appears in the text
  but isn't linked) with one-click "link it".
- Heading links (`[[Page#Heading]]`).
- Links to other Neutrino files (Docs, Sheets, Slides, Drive files, Photos) as rich chips.
  This is cheap to build because the platform already exists, and it hints at Phase 3 early.

### Organisation
- Vault = top-level container (one per user in the MVP; the model allows many).
- Folders and nested pages; sidebar tree with drag-and-drop.
- `#tags`, with nested tags (`#project/neutrino`); tag browser.
- Favourites / pinned pages; recently opened.
- **Daily notes**: today's page on launch, configurable template, calendar picker.
- Simple templates (daily note, meeting, blank) with `{{date}}`/`{{title}}` variables.

### Find
- Quick switcher (`⌘O`): fuzzy title search, opens or creates.
- Full-text search (`⌘⇧F`) on the encrypted local index: phrase and tag filters, results in
  context.
- Command palette (`⌘K`) for every action, so the app can be driven entirely from the keyboard.

### Sync, offline, security
- **Offline-first:** the vault is cached encrypted on device. Every action works offline;
  writes queue and sync in the background.
- E2EE for content, titles, tags and attachments using the existing key vault; key setup and
  recovery reuse the existing flows (QR key transfer, recovery key).
- Conflict handling: a line-level three-way merge of the Markdown where possible; otherwise
  keep both versions and show a conflict banner (needs the optimistic-concurrency save token
  from `search.md`).
- App lock (Touch ID/Face ID/passcode) on Mac and iOS.

### Import / export (trust and switching)
- Import an **Obsidian vault** (folder of Markdown + attachments, resolving `[[links]]`) and
  **Neutrino Notes**.
- Export the whole vault to plain Markdown + attachments, anytime. The files are already
  Markdown, so export is just decryption. No lock-in; say so loudly in marketing.

### iOS companion (end of Phase 1)
- The same Swift editor, so read, search and edit work fully; daily note; quick-capture widget
  and share extension ("send to inbox"); offline cache of recent and pinned pages.

### Explicitly *not* in the MVP
Databases/properties views, graph view, collaboration, publishing, plugins, AI, web, Windows and
Android clients.

---

## Phase 2 — Parity with established KB apps

**Goal:** Nobody switching from Obsidian or Notion should miss a feature they rely on. This
phase also delivers the web client (needed for sharing and collaboration) and then Android.

### Structured data (Notion parity)
- **Page properties** stored as YAML frontmatter, typed: text, number, date, select,
  multi-select, checkbox, URL, relation (to other pages), person.
- **Databases / collections:** a database is a folder of pages plus a schema file
  (`.atlas/database.yaml`) holding the property schema and saved views. Views: table, board
  (kanban), list, gallery, calendar, timeline. Each view has filter, sort and group-by.
- Inline database views embedded in any page.
- Rollups and formula properties.
- **Query blocks** (Obsidian Dataview / Logseq queries): a fenced ` ```query ` block holding a
  simple query language, with a visual builder. It shows a live list or table of pages
  matching tags, properties, links or dates. Queries run on the local index, so they work
  under E2EE.

### Knowledge-graph features (Obsidian/Logseq parity)
- **Graph view:** global and local (n-hop from the current page), with filters by tag/folder,
  colour groups and time-lapse playback.
- **Block references and transclusion:** `^block-id` anchors, `[[Page#^id]]` links and
  `![[Page]]` / `![[Page#^id]]` embeds that stay live-updated.
- Outliner mode (Logseq-style: every bullet is a block, zoom into a bullet).
- Canvas / whiteboard: infinite canvas of cards, pages, images and arrows, stored as an
  encrypted JSON file alongside the Markdown, as Obsidian does with `.canvas`. Reuse the
  diagramming work (`neutrion-diagramming-app.md`) where it fits.
- Tasks: to-dos with due dates and priority across the vault, a global task view, and **sync
  with Neutrino Calendar tasks** (`feature-tasks-api.md`).

### Editor depth
- LaTeX math (inline and block), Mermaid diagrams, footnotes, highlights, toggles/collapsible
  sections, embeds (YouTube, tweets, PDFs, audio). Each extension goes into the Markdown spec
  and the conformance corpus before any editor ships it.
- PDF viewer with highlights and annotations that become blocks linked back to the source.
- Web clipper (Safari/Chrome extension) that saves clean article Markdown and highlights into
  the vault.
- Richer templates with prompts and conditional sections; template gallery.
- Per-page outline/table of contents; word count; reading mode.
- Spell and grammar check (reuse `grammar_checker.md`).

### Collaboration (Notion parity)
- **Shared vaults and shared pages** with roles (owner/editor/commenter/viewer), using
  E2EE sharing (`shared end-to-end encryption.md`) and team keys.
- **Real-time co-editing over an encrypted CRDT relay** (see constraint 5), with presence,
  cursors and avatars.
- Comments, @mentions, notifications, and suggest/track changes. Comments are stored as
  encrypted sidecar data, not inline in the Markdown, to keep the files clean.
- Team Spaces integration: a team's wiki *is* a shared Atlas vault (`team-spaces.md`). Reconcile
  the two plans so wiki pages aren't built twice.
- Page history with diff view (a Markdown diff, which is easy to read) and named versions.

### Publishing
- **Publish to web:** a page or folder gets a public, read-only site with custom domain and
  theme. Publishing is an explicit decrypt-and-publish action: the published copy is plaintext
  by design, and the UI must make that unmistakable.
- Share by link with expiry and optional password.

### Platform and extensibility
- **Web client** as a new `atlas` route area in the existing `neutrino/web/apps/web`, with a
  Tiptap editor bound to the Atlas Markdown spec. Its parser, link extraction and query engine
  go in a new `web/packages/atlas` package, so they can be tested against the conformance
  corpus without the UI. This reuses the existing shell, auth, Drive client, e2e-crypto and
  theming. Atlas `[[links]]` are a different system from Notes' server-side links, so keep the
  two apart in code.
- **Android client** on `neutrino_shared_android` with a native Compose editor.
- Themes and CSS snippets (reuse `feature-custom-themes.md` and the custom-fonts work).
- Customisable hotkeys; multiple panes, tabs and split view; multiple windows (macOS).
- Import from Notion (export zip), Evernote (ENEX), Roam/Logseq (JSON/Markdown), Apple Notes,
  Google Keep.
- **Extensibility v1:** public API, Shortcuts/App Intents and AppleScript on Mac/iOS, and a
  sandboxed JS plugin runtime (JavaScriptCore on Apple platforms) with a permissions manifest,
  so a plugin can't exfiltrate decrypted content without the user consenting. Obsidian's
  ecosystem is its moat; even a modest plugin API matters for parity.

---

## Phase 3 — Killer features (what sets it apart)

These either can't exist in a single-purpose KB app or can't coexist with E2EE anywhere else.
Neutrino can do both.

### 1. The whole workspace is the knowledge graph
Every Neutrino object becomes a graph node: Docs, Sheets, Slides, Drive files, Photos,
Calendar events, Tasks, Diagrams. Backlinks work across all of them. A page about a client shows
the contract (Drive), the proposal deck (Slides), the budget (Sheets), last week's meeting (Calendar)
and photos from the site visit (Photos), and those files show the page back. Live embeds:
a Sheets range, a chart or a slide renders inside a page and stays current (`sheet-embed`
already exists). **No competitor owns the files *and* the notes.** The graph stays on the client
(constraint 2), so the other Neutrino apps need a shared client-side index of outgoing links
too.

### 2. Private AI over your own knowledge
- "Ask your vault": answers with citations to your own pages and files, plus summarise, rewrite,
  extract tasks, draft from notes, and turn a meeting transcript into a linked page.
- **Semantic search and "related pages"** from embeddings computed **on device** and stored in
  the encrypted index, so the server never sees content or vectors.
- **Auto-linking:** suggests `[[links]]` and tags as you write, found on-device from unlinked
  mentions and semantic similarity.
- Generation runs either on a local model (Apple Foundation Models / Core ML on Mac and iOS) or
  by an **explicit, per-request opt-in** that sends only the selected context to a hosted model
  (e.g. Claude) with zero retention. Being honest about this boundary is the selling point:
  *"the AI only sees what you hand it."*

### 3. Spaced repetition and active recall built in
Turn any block into a flashcard (`question :: answer`, cloze `{{c1::...}}`, defined in the
Markdown spec). FSRS scheduling, a daily review queue on the iOS widget and in the daily note,
and stats. It turns the KB from storage into learning. Today this needs a plugin in Obsidian
(Anki-style) and doesn't exist in Notion.

### 4. Capture from anywhere, processed into the graph
- Universal inbox: share sheet, email-in address, voice memo (transcribed on device), screenshot
  OCR (Vision framework), web clipper, photo of a whiteboard or handwriting. All captures land
  encrypted.
- Inbox triage view: AI suggests destination, tags and links; one keystroke files each item.
- Calendar-aware meeting notes: a page for each event, created automatically with attendees
  and linked to the event, previous meetings and related pages.

### 5. Living knowledge: time and provenance
- **Time travel:** scrub the whole vault (not just one page) to any past date; see how a
  topic's pages and links evolved. Drive versions of plain Markdown make this cheap to
  reconstruct.
- Source and provenance tracking: every clipped quote or AI-generated block remembers where it
  came from, with a "show source" hover.
- Stale-knowledge alerts: pages untouched for N months that are still heavily linked, or whose
  linked sources changed, get flagged for review.

### 6. Encrypted collaboration without compromise
Real-time co-editing, comments and shared databases, all E2EE. Notion can't offer it, and
Obsidian doesn't have the collaboration. It is a natural fit for journalists, lawyers,
health and finance teams, and anyone else who can't put client knowledge on someone else's
server. Pair it with **self-hosting** (the backend is already one Rust binary + one DB) for
organisations that need full control.

### 7. Structured knowledge that computes
Databases whose formulas can reference Sheets, and query blocks that can chart
results with the Sheets chart engine (`feature-sheets-phase*-charts.md`). Personal dashboards
(reading log, habit tracker, CRM, research matrix) built from pages, with no plugin hunting.

---

## Platform delivery order

| Release | macOS (native) | iOS (native) | Web | Android (native) |
|---|---|---|---|---|
| Phase 1 | Full MVP | Companion with the shared Swift editor | — | — |
| Phase 2 | Full parity | Near-parity (no canvas editing, no plugins) | Full parity; required for sharing/publishing | Companion, then near-parity |
| Phase 3 | All killer features; on-device AI | All, with on-device AI where the hardware allows | All, with cloud AI opt-in | All |

---

## Backend work this roadmap implies

All of it is additive; per `CLAUDE.md` coupling rule 1, no existing response shape changes.

- New MIME type(s) for Atlas pages, database schemas and canvases; Drive treats them as
  opaque encrypted blobs.
- OAuth client migrations for each new client id (next free numbers after `00147`).
- Optimistic-concurrency save token on Drive content writes (`search.md`), needed for
  conflict detection.
- A **batch write** endpoint (or transaction semantics) on Drive, so a rename that rewrites
  links in many pages syncs atomically.
- Encrypted search-index file sync + SSE change notification (`search.md`).
- **Encrypted CRDT update relay and snapshot store** for E2EE co-editing (Phase 2). This is
  new, separate from `src/docs/collab/`, and could later let Docs offer E2EE collaboration too.
- Publishing endpoint and static site serving for plaintext published copies (Phase 2).
- Email-in capture address that encrypts at ingest with the user's public key (Phase 3); note the
  server sees the email in transit, which must be disclosed.
- **Not needed:** `src/links/` changes (the graph is client-side), and no paid-tier or
  entitlement work.

---

## Research before Phase 2

- **CRDT choice for E2EE co-editing.** Candidates: Yjs (`yrs` with Swift/Kotlin bindings,
  `yjs` on web) and Automerge (Rust core with Swift/Kotlin/JS bindings). Questions to answer
  with prototypes:
  1. Can it map onto the Markdown AST and round-trip byte-stably against the conformance corpus?
  2. How large do the encrypted update logs grow, and how does client-side compaction work?
  3. Are the bindings mature on all three platforms?
  4. Does the relay server stay content-blind?

  Write up the result as its own `agent_docs/` research doc.

## Out of scope

- **Windows client.** Planned eventually; it gets its own roadmap. Nothing in Phases 1–3 should
  rule it out. In particular, keep `AtlasCore`'s Markdown spec and conformance corpus
  language-neutral so a fourth implementation can be checked against them.
