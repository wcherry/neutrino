# Overview

The fastest successful architecture is:

Local encrypted indexing
+
Encrypted syncable search metadata
+
Client-side querying

That gives you:

* fast search
* offline support
* multi-device consistency
* strong E2EE guarantees
* minimal backend changes

Below is the roadmap specifically optimized for retrofitting search into an existing E2EE application.

⸻

Phase 1 — Define Search Scope

Documents
Spreadsheets
Notes
Slides
Events
Reminders
Metadata
Comments

⸻

Decide Search Features

Start with:

MVP

* keyword search
* multi-word AND
* title weighting
* incremental indexing

Avoid initially:

* fuzzy search
* semantic/vector search
* typo correction
* regex
* phrase ranking

⸻

Phase 2 — Build Client Indexing Engine

This is the core feature.

Your server should ideally remain almost unchanged.

⸻

Architecture

Each client maintains:

Local Search DB
    +
Encrypted Synced Index State

The local DB is optimized for querying.

The synced state is optimized for consistency between devices.

These are NOT necessarily identical structures.

⸻

Phase 3 — Create Search Token Pipeline

This is the most important design decision.

⸻

Recommended Design

Step 1 — Normalize Text

"Project Budget.xlsx"
→ project
→ budget
→ xlsx

Use:

* lowercase
* unicode normalization
* punctuation stripping
* optional stemming

⸻

Step 2 — Deterministic Hashing

Use:

tokenHash =
HMAC-SHA256(searchKey, normalizedToken)

This creates stable encrypted tokens.

Example:

budget
→ 4f8a2...

All devices produce identical hashes.

Server never sees plaintext terms.

⸻

Phase 4 — Local Search Database

Implement a local inverted index.

⸻

Recommended Storage

Web

* IndexedDB


Mobile/Desktop

* SQLite

⸻

Recommended Schema

Token Table

token_hash TEXT
document_id TEXT
field TEXT
frequency INTEGER
positions BLOB

Indexed by:

* token_hash
* document_id

⸻

Query Flow

User types:
"budget planning"
↓
Normalize
↓
Hash tokens
↓
Lookup postings
↓
Intersect results
↓
Rank locally
↓
Decrypt/render matching docs

This is extremely fast locally.

⸻

Phase 5 — Incremental Index Updates

Critical for performance.

Never rebuild everything.

⸻

Index Triggers

Reindex when:

* document created
* document edited
* document deleted
* shared doc updated

⸻

Maintain Token Diffs

Track:

* added tokens
* removed tokens

Update only affected entries.

⸻

Phase 6 — Sync Search State Across Devices

This is where most complexity lives.

You already have sync infrastructure, so reuse it.

⸻

Recommended Strategy

DO NOT sync the entire search database.

Instead sync:

* encrypted indexing operations
    OR
* encrypted token manifests

⸻

Best Practical Design

Per-Document Token Manifest

Each document gets:

{
  "docId": "...",
  "tokenHashes": [
    "ab12...",
    "cd34..."
  ],
  "updatedAt": 123456
}

Encrypted before sync.

⸻

Why This Works

Each client:

1. downloads changed manifests
2. updates local inverted index
3. queries locally

Benefits:

* compact
* incremental
* resilient
* offline-friendly

⸻

Phase 7 — Shared Documents & Workspaces

If documents are shared between users:

Use Shared Search Keys

Per workspace:

workspaceSearchKey

All members derive identical token hashes.

⸻

Sharing Flow

tokenHash =
HMAC(workspaceSearchKey, token)

This ensures:

* all collaborators can search
* server still cannot read terms

⸻

Phase 8 — Search Ranking

Once correctness works.

⸻

Add Ranking

Recommended:

* BM25 lite
* title boosts
* recency boosts

All ranking computed locally.

⸻

Phase 9 — Background Indexing

Important for UX.

⸻

Web

Use:

* Web Workers

⸻

Mobile/Desktop

Use:

* background queues
* idle tasks

⸻

Strategy

When sync finishes:

* queue indexing
* avoid blocking UI

⸻

Phase 10 — Security Hardening

Once search works reliably.

⸻

Add

Integrity Validation

Prevent malicious sync tampering.

Use:

* signed manifests
* HMAC validation

⸻

Key Rotation

Support:

* workspace rekeying
* revoked users

⸻

Leakage Reduction

Optional later:

* pad manifests
* fake entries
* query obfuscation

Most apps stop before this phase.

⸻

Minimal Backend Changes

Ideally your backend only needs:

New Object Type

encrypted_search_manifest

That’s it.

No server-side search.

No plaintext indexing.

No special database engine.

⸻

Recommended MVP Architecture

Client
 ├── Existing Crypto
 ├── Existing Sync
 ├── Local Search DB
 ├── Index Builder
 └── Query Engine
Server
 ├── Existing Blob Store
 └── Existing Sync APIs

⸻

What To Avoid

Do NOT initially build:

* Elasticsearch integration
* server-side encrypted search
* vector search
* homomorphic encryption
* ORAM
* fully searchable encryption

These massively increase complexity and usually kill timelines.

⸻

Recommended Implementation Order

Week 1

* tokenization pipeline
* deterministic hashing
* local index schema

⸻

Week 2

* local search querying
* ranking
* UI integration

⸻

Week 3

* incremental updates
* index maintenance

⸻

Week 4

* encrypted manifest syncing
* multi-device consistency

⸻

Week 5

* shared workspace support
* key management

⸻

Week 6+

* optimization
* background indexing
* fuzzy search
* phrase search

⸻

Recommended MVP Feature Set

Build only:

✅ keyword search
✅ local inverted index
✅ deterministic token hashes
✅ incremental indexing
✅ encrypted synced manifests
✅ local ranking
✅ workspace/shared search

That is enough to create a very strong encrypted search experience across:

* web
* desktop
* mobile

without changing your core E2EE model.