# How to Save Document Changes without Creating Versions

1. Continuous autosave (not snapshot-based)
	•	Every small batch of edits is sent to the server
	•	Stored as:
	•	operations (diffs) or
	•	incremental document state

👉 No “save file” event
👉 No full document rewrite every time

⸻

2. Version history is compressed over time

Instead of:

Save → Version → Save → Version → Save → Version

Do:

Many edits → grouped → ONE version

Typical grouping logic:
	•	Burst of typing → 1 version
	•	Pause → potential version boundary
	•	Long session → periodically checkpointed

⸻

3. Time-based + activity-based bucketing

Rough mental model:

User Behavior	What Happens
Typing continuously	No new version
Pause for ~30–120s	May mark a checkpoint
Keep editing for 10+ min	Auto-create version
Rename version	Locked as important


⸻


4. Diff-based storage (critical for scale)

Instead of storing full copies:

Version 1 (full snapshot)
+ diff
+ diff
+ diff
= reconstruct state

This allows:
	•	High-frequency autosave
	•	Minimal storage cost
	•	Smooth undo/history

⸻

🏗️ How to Implement This (Practical Design)

1. Data Model

documents
- id
- current_content
- updated_at

document_operations   -- (optional but ideal)
- id
- document_id
- op (json diff)
- created_at

document_versions
- id
- document_id
- snapshot (full or reference)
- created_at
- label (nullable)
- is_named (bool)


⸻

2. Autosave Flow

Client:

onChange →
  debounce(1–2s) →
    send patch/diff

Server:

apply patch →
update current_content →
store operation log

👉 No version created here

⸻

3. Version Creation Logic (THIS is the magic)

Run a background job or inline heuristic:

if (time_since_last_version > 10 min AND document_changed):
    create_version()

if (user_inactive_for > 2 min AND significant_changes):
    create_version()

if (change_size > threshold):
    create_version()


⸻

4. Version Coalescing (Google Docs style)

Instead of storing every checkpoint:
	•	Merge nearby versions
	•	Keep only meaningful ones

Example:

10:00 edit
10:01 edit
10:02 edit
→ ONE version at 10:02


⸻

5. Named Versions (must-have)

User clicks “Save Version”

→ force snapshot
→ mark is_named = true
→ never merge/delete


⸻

6. Optional: Operational Transform / CRDT (if multiplayer)

If you’re planning collaboration:
	•	Use:
	•	Operational Transform (OT) (Docs-style)
	•	OR CRDT (modern approach)

This enables:
	•	Real-time editing
	•	Conflict-free merging

⸻

⚡ Minimal Version (what you should actually build first)

Don’t overcomplicate this early.

Start with:

Autosave
	•	debounce: 2s
	•	overwrite document

Versioning
	•	create version:
	•	every 10 minutes IF changed
	•	OR manual “Save version”

Storage
	•	full snapshot per version (skip diffs for now)

⸻

🧩 UX Pattern (important)

Match Docs behavior:
	•	Show:
	•	“Saving…”
	•	“Saved”
	•	No “version created” spam
	•	Version history is:
	•	hidden
	•	clean
	•	time-grouped

⸻

🔥 Key Insight

The real trick isn’t autosave.

It’s this:

Versions represent “meaningful states,” not “points in time.”
