🧱 High-level architecture

Core principle
	•	All content is encrypted on the client
	•	Server stores opaque blobs
	•	Server never sees plaintext

⸻

🔑 Key hierarchy (this is the backbone)

Use a layered key system:

User Master Key (UMK)
 ├── File Keys (per document)
 ├── Folder Keys (optional)
 └── Sharing Keys (per recipient)

1. User Master Key (UMK)
	•	Generated on signup (client-side)
	•	Used to encrypt other keys (not data directly)
	•	Stored:
	•	Encrypted with user password (PBKDF2/Argon2)
	•	Backed by OS keystore if available

👉 This is your “root of trust”

⸻

2. File Keys (DEKs)

Each document/note/file gets:
	•	A random symmetric key (256-bit)

Used for:
	•	Encrypting document content
	•	Encrypting metadata (title, etc.)

👉 Enables:
	•	selective sharing
	•	efficient updates

⸻

3. Sharing model (this is where most systems fail)

When sharing a document:
	1.	Fetch recipient’s public key
	2.	Encrypt the file key with it
	3.	Store:

{
  file_id,
  encrypted_file_key_for_user_A,
  encrypted_file_key_for_user_B
}

👉 No re-encryption of the file itself

⸻

🔐 Crypto choices (don’t overthink this)

Use libsodium for almost everything.

Recommended primitives:
	•	Symmetric: XChaCha20-Poly1305
	•	Asymmetric: Curve25519
	•	Signatures: Ed25519
	•	KDF: Argon2id

👉 This avoids footguns and gives modern security

⸻

📦 Data model (Neutrino Drive style)

File record (server)

{
  id,
  owner_id,
  encrypted_blob,
  encrypted_metadata,
  key_refs: [
    { user_id, encrypted_file_key }
  ],
  version,
  created_at,
  updated_at
}

Important
	•	encrypted_blob = binary (chunked if large)
	•	encrypted_metadata = JSON (title, type, etc.)

⸻

⚡ Real-time editing (Google Docs–like)

This is the tricky part.

Approach:
	•	Use CRDT (like Yjs or Automerge)
	•	Encrypt updates, not just full document

Flow:
	1.	User edits doc
	2.	CRDT produces update
	3.	Update is encrypted with file key
	4.	Sent to server
	5.	Other clients decrypt + apply

👉 Server never sees document state

⸻

🔄 Sync + versioning

You already care about this (from earlier convos).

Strategy:
	•	Each change = encrypted operation
	•	Store append-only log
	•	Periodically snapshot full encrypted state

Benefits:
	•	version history
	•	conflict resolution
	•	offline support

⸻

🔐 Encryption at rest (still required)

Even though data is encrypted:

Server side:
	•	Disk encryption (cloud default)
	•	DB encryption (TDE)
	•	Object storage encryption

Why?

Defense in depth (stolen disks, backups, etc.)

⸻

🔑 Key management (practical version)

You don’t need to overbuild this early.

Start with:
	•	Password → Argon2 → KEK
	•	KEK decrypts UMK
	•	UMK decrypts file keys

Later (upgrade path):
	•	Add:
	•	device keys
	•	hardware-backed storage
	•	multi-device sync

⸻

📱 Multi-device support

Each device gets:
	•	its own keypair

When adding a device:
	•	existing device encrypts UMK for new device

👉 No password re-entry required if done right

⸻

🚪 Authentication vs Encryption (separate these)

Use:
	•	OAuth / sessions / JWT for auth

But:
	•	Auth ≠ access to data
	•	Encryption enforces access control

⸻

⚠️ Hard problems (don’t ignore these)

1. Search

Encrypted data is not searchable

Options:
	•	client-side search (simple)
	•	encrypted indexes (hard)
	•	hybrid (most practical)

⸻

2. Password recovery

True E2EE means:
	•	you cannot reset passwords without losing data

Options:
	•	recovery key
	•	social recovery
	•	escrow (less secure)

⸻

3. Metadata leakage

Even with E2EE, server sees:
	•	file sizes
	•	access patterns
	•	timestamps

Fixing this is expensive (probably not worth it yet)

⸻

🧭 What I would build (your case)

Given your stack + goals:

Phase 1 (fast + solid)
	•	libsodium
	•	per-file encryption
	•	encrypted metadata
	•	simple sharing (public keys)
	•	snapshot-based versioning

Phase 2
	•	CRDT + encrypted updates
	•	multi-device sync
	•	background re-encryption

Phase 3
	•	advanced sharing (groups, roles)
	•	encrypted search
	•	partial document loading

⸻

🧩 How this fits Neutrino

You already have:
	•	drive system
	•	document model
	•	syncing concerns

This plugs in as:

“encryption layer around your existing storage + sync engine”
