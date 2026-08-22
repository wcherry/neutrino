# Client-only keys, QR device transfer, and key rotation

Status: **web, server and iOS Notes done.** Phase 0 (sharing key verification), Phase 1a
(server, additive), Phase 2 (web) and Phase 3 for the Notes app have shipped. Phase 1b
(dropping the vault tables), Phase 3 for the Docs app and Phase 4 (macOS) remain — see §5.

Supersedes the server-side key vault introduced in migration 105 (`user_key_vaults` /
`user_key_unlocks`) and the PIN-only QR export that used to live in
`web/packages/e2e-crypto/src/crypto.ts`.

This document records three decisions and the plan to rebuild the server, web, iOS
(Notes and Docs) and macOS (Drive) clients around them.

---

## 1. The decisions

### D1 — The encryption key is created and stored on the client only

No key material, in any form, encrypted or otherwise, is transmitted to or stored by the
server. That includes wrapped forms: the `user_key_vaults.encrypted_identity` and
`user_key_unlocks.encrypted_master_key` blobs are deleted, and the endpoints that serve
them are removed.

**What this buys.** It removes offline grinding as an attack. Today a database dump or a
stolen backup yields every user's wrapped master key plus its Argon2 parameters, after
which the attacker races the user's password entropy offline — and a human-chosen password
is roughly 30–40 bits against an Argon2id speed bump that cannot close that gap. With no
blob there is no race.

**What it costs, accepted explicitly.** A user who loses every enrolled device *and* their
printed recovery kit cannot recover their data. There is no server-side fallback, by
design, and no support process that can undo it. This is the Signal / Apple Advanced Data
Protection posture and it must be stated plainly in the enrolment UI, not buried.

### D2 — Device enrolment is an offline two-QR handshake with a spoken confirmation code

A second device receives the keyring by scanning, not by fetching. The exchange never
touches the server.

### D3 — Keys are versioned; reads use the version the file records, writes use the newest

The identity keypair becomes a *keyring* of versioned entries. A file's key reference
records which version its DEK is sealed to. Reading resolves that version out of the local
keyring. Any write re-seals to the active version.

---

## 2. Why the current design cannot simply be hardened

Worth stating so the rebuild is not mistaken for churn.

The existing vault is well built — MK is never stored or transmitted, `openVault` verifies
`scalarmult_base(sk) == pk` so a swapped blob fails closed, recovery codes carry 120 bits,
and sessions refuse to touch disk. The problem is not the construction. It is that the
construction's whole purpose is to put a grindable artefact on the server so that a new
device can bootstrap from nothing. D1 removes the requirement that made the vault
necessary, so the vault goes with it.

Three defects in the current system are *not* addressed by D1–D3 and are tracked
separately, because they leak content regardless of how well keys are protected:

- **Sharing trusts a server-supplied public key.** `ShareDialog.tsx:124` seals the DEK to
  whatever `getUserPublicKey` returns, with no verification; `set_public_key` accepts any
  non-empty string. A hostile server substitutes its own key and reads every newly shared
  file. Fixed by the key-pinning work, which is scheduled ahead of this document's plan.
- **Docs and Diagrams persist plaintext server-side.** The collab room holds a server-side
  Y.Doc and writes it to `doc_yjs_state` when the last session leaves
  (`src/docs/collab/api.rs:113`, `:231`).
- **`cover_thumbnail` is an unencrypted preview** of files whose bytes are ciphertext.

---

## 3. Target architecture

### 3.1 The keyring

```
Keyring (client-only, never transmitted)
  ├── { v: 1, x25519 keypair, createdAt, status: retired }
  ├── { v: 2, x25519 keypair, createdAt, status: retired }
  └── { v: 3, x25519 keypair, createdAt, status: active }   ← seals new work

Per file
  DEK  — random 32 bytes, encrypts content + metadata (XChaCha20-Poly1305, unchanged)
  ref  — { file_id, user_id, key_version: N, encrypted_file_key: seal(DEK, pub_vN) }
```

Each version is an **independently random** keypair, not derived from a root seed. A
seed-derived keyring would give a recovery kit that stays valid forever, which is
attractive — but it also means seed compromise is total compromise across every past and
future version, so rotation would defend against nothing. Independent keys keep rotation
meaningful at the cost of the kit needing re-export after each rotation. That trade is
taken deliberately; see §3.5.

### 3.2 Read and write paths

**Read.** Fetch the key ref → read `key_version` → look up that version's secret key in the
local keyring → `crypto_box_seal_open` → decrypt content with the DEK. A version missing
from the local keyring is a hard, legible error ("this file needs key v2, which this device
does not have — import your keyring"), never a silent decrypt failure.

**Write.** Re-seal the existing DEK to the **active** version's public key and store the new
`key_version` alongside the content update. The DEK itself does not change and the content
is not re-encrypted.

**The honest limit of this.** Re-sealing bounds *future* exposure, not past. An attacker who
already captured the old sealed DEK and later compromises the retired private key still
recovers that DEK, and the content it opens is unchanged. Rotation here defends against a
key that becomes exposed *from now on* — a stolen device's keychain, a retired laptop —
not against an adversary who has been logging ciphertext. Genuine forward secrecy requires
re-encrypting content under a fresh DEK, which is a background re-key job and is explicitly
out of scope (§7).

### 3.3 Where the keyring lives on each platform

| Platform | At rest | Wrapping key |
|---|---|---|
| Web | IndexedDB, ciphertext only | WebAuthn PRF (device-bound, non-extractable); Argon2id over a local passphrase where PRF is unavailable |
| iOS | Keychain, `WhenUnlockedThisDeviceOnly`, `SecAccessControl` with biometry, **not** synchronizable | OS |
| macOS | Keychain, same attributes | OS |

The web keyring must persist locally — with no server copy, an in-memory-only keyring would
be destroyed by a page reload and unrecoverable. This is a change from today's deliberate
"nothing touches disk" stance in `session.ts`, and it is forced by D1. The mitigation is
that what reaches disk is ciphertext under a key held by the authenticator, not the plain
key that the pre-vault build used to leave in localStorage.

iOS currently stores the raw private key with no `kSecAttrAccessible` set at all
(`KeychainService.swift:11`), so it defaults to `WhenUnlocked` and lands in encrypted device
backups. That is fixed as part of this work.

### 3.4 Device enrolment — the two-QR handshake

Today's flow encrypts the keypair under PBKDF2 over a short PIN and puts the result in a QR
(`crypto.ts:189` → `KeyQRDecryptService.swift`). Photographing that QR reduces the entire
identity to PIN entropy, which is seconds on a GPU. Because D1 makes device transfer the
*only* way to enrol a device, this path moves from a weak side door to the front door and
must be replaced rather than re-tuned.

The replacement inverts the direction — the **receiver** shows the first QR:

1. **Receiver** generates an ephemeral X25519 keypair and displays **QR-A**: its ephemeral
   *public* key plus a random session nonce.
2. **Sender** scans QR-A, seals the keyring to that ephemeral public key, and displays
   **QR-B**: the sealed keyring.
3. **Receiver** scans QR-B and opens it with the ephemeral secret key, which never left the
   receiving device.
4. Both devices display a **6-digit confirmation code** derived from the handshake
   transcript. The user compares them and confirms. This is the short-authentication-string
   defence against a relay sitting between the two screens.

Photographing QR-B yields nothing without the ephemeral secret half. Nothing is uploaded —
a keyring of five versions is roughly 250 base64 characters against a QR capacity of ~2,900
alphanumeric, so the payload fits directly and no server relay is needed. The "PIN" of the
original requirement survives as the confirmation code in step 4, where it does useful work,
rather than as the sole protection on a photographable blob.

### 3.5 Recovery kit

The kit is an export of the **whole keyring**, Crockford base32 (the alphabet already used
by `recovery.ts:16` — no I, L, O or U, so it survives being read aloud or copied off paper).

Because versions are independently random (§3.1), rotating invalidates the previous kit for
anything sealed to the new version. Rotation therefore **must** prompt for a fresh export
and must not complete silently. A user holding only a pre-rotation kit can still read
everything sealed before the rotation, which makes a stale kit degraded rather than useless.

---

## 4. Server changes

The server's role shrinks to storing opaque ciphertext and a directory of *public* keys.

### 4.1 Removed

- Tables `user_key_vaults`, `user_key_unlocks` (migration 105).
- `GET/PUT /api/v1/auth/keyvault`, `POST /api/v1/auth/keyvault/unlocks`,
  `DELETE /api/v1/auth/keyvault/unlocks/{id}`, and the mark-used endpoint.
- `src/auth/keyvault/` in its entirety.

Dropping the mark-used endpoint also closes the unlock-success oracle noted in the review:
it currently fires only on a successful unlock, which lets a hostile server confirm a
guessed password one round-trip at a time.

### 4.2 Added — `user_public_keys` (migration 00112)

`users.public_key` becomes a versioned set, because collaborators need the *active* key to
seal to and retained old keys to verify against.

```sql
CREATE TABLE user_public_keys (
    user_id     TEXT NOT NULL,
    version     INTEGER NOT NULL,
    public_key  TEXT NOT NULL,           -- base64url Curve25519
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    retired_at  TIMESTAMP,               -- NULL = active
    PRIMARY KEY (user_id, version),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE UNIQUE INDEX idx_user_public_keys_active
    ON user_public_keys(user_id) WHERE retired_at IS NULL;
```

The partial unique index enforces exactly one active version per user in the database rather
than in application code.

### 4.3 Added — `file_key_refs.key_version` (migration 00112)

```sql
ALTER TABLE file_key_refs ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1;
```

No backfill: the database is wiped as part of this work (§6), so there is no back catalogue
of rows sealed to a pre-rotation identity. The `DEFAULT 1` exists only so the column is
non-null for rows written by code paths that predate full version threading during
development.

### 4.4 Endpoint surface

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/auth/users/{id}/public-keys` | Full versioned set. Replaces the single-key endpoint. |
| `POST` | `/api/v1/auth/keys` | Publishes a new version, marks the previous retired. Rejects a version that already exists — rotation is append-only, never an overwrite. |

`set_public_key`'s current behaviour of accepting any non-empty string and overwriting in
place is what makes the substitution attack cheap. Append-only versioning plus the pinning
work removes that.

---

## 5. Rebuild plan

Ordered by dependency. Each phase is independently shippable and leaves the system working.

### Phase 0 — Sharing key verification *(prerequisite, already scoped)*

TOFU pinning and out-of-band fingerprints in `ShareDialog`. Independent of D1–D3 but
scheduled first: it is the cheapest live exploit and the pin store it introduces is what
later verifies rotated keys. D3 strengthens it — under a client-only keyring, a peer's key
changing is a deliberate, rare rotation rather than the ambiguous event it is today, so a
mismatch can be treated as hostile by default.

### Phase 1a — Server, additive **(done)**

1. Migration 00112: `user_public_keys`, plus `file_key_refs.key_version`.
2. Append-only public-key handlers in `src/auth/api.rs` — `POST /auth/keys` publishes a new
   version, `GET /auth/users/{id}/public-key` returns the active one, and a new
   `GET /auth/users/{id}/public-keys` returns the whole keyring.
3. `key_version` threaded through the file-key DTOs, service and repository.

Non-breaking on purpose. The version fields carry `#[serde(default)]` of 1, so a client that
knows nothing about rotation keeps working, and `users.public_key` is still written in step
with the active version for the paths that read it directly.

### Phase 1b — Server, destructive **(deferred until after Phase 2)**

1. Migration: `DROP TABLE user_key_vaults`, `DROP TABLE user_key_unlocks`.
2. Delete `src/auth/keyvault/`; remove its routes and OpenAPI entries.

Split out from 1a and moved after the web work. §6 is right that no *data* ordering
constraint survives the wipe, but the *code* coupling does: `E2EEUnlockGate`,
`provisionVault`, `getVaultState` and the settings panel all call the vault endpoints today,
so deleting them before Phase 2 leaves the tree in a state where encryption is simply broken.
Nothing is gained by that window — the wipe means the vault rows hold nothing worth removing
urgently — so the drop waits until nothing calls it.

### Phase 2 — Web **(done)**

1. `packages/e2e-crypto/src/keyring.ts` — versioned keyring, active-version resolution,
   version lookup on read, re-seal on write.
2. `packages/e2e-crypto/src/keystore-local.ts` — IndexedDB persistence wrapped under the
   WebAuthn PRF key. Reuses `prf.ts` as-is; that module is already correct and needs no
   change.
3. `packages/e2e-crypto/src/pairing.ts` — the two-QR handshake and confirmation code.
4. Deleted: `vault.ts`, `kdf.ts`, `recovery.ts`, the `encryptKeysWithPin` /
   `decryptKeysWithPin` pair, the whole vault lifecycle in `packages/auth/src/e2e-keys.ts`,
   the legacy-localStorage migration path, `UnlockMethodsPanel`, and the vault endpoints on
   the auth API client. `replaceIdentity` became `rotateIdentity`.
5. Rotation UI in settings, with the mandatory kit re-export of §3.5.
6. Update the ~12 `loadKeyPair` call sites across Drive, Docs, Notes, Photos and search to
   resolve by version. Their signatures stay synchronous — the keyring is in memory once
   unlocked, exactly as the keypair is today.

### Phase 3 — iOS: **Notes done, Docs blocked**

The two apps carry near-identical copies of the key services and views. Notes has shipped;
Docs has not, for a reason that is nothing to do with this work — see below.

**Notes (done).**

1. `KeychainService.save` now sets `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, and sets it
   on *update* as well as insert — rewriting only the value would leave an item written by an
   older build at `WhenUnlocked` forever. Items are therefore out of device backups.
2. `KeyVaultService`, `KeyVaultCrypto` and `KeyQRDecryptService` are deleted. In their place:
   `Keyring.swift` (versioned model, wire-compatible with `keyring.ts`), `RecoveryKit.swift`
   (the Crockford base32 frame), `Pairing.swift` (receiver half of the handshake) and
   `KeyringStore.swift` (one Keychain item holding the serialised keyring).
3. `VaultUnlockView` → `KeyRestoreView`: recovery kit or pairing, and deliberately **no**
   "create a key" path, since this account's files are sealed to an identity that exists.
   `KeyQRImportView` → `DevicePairingView`, the receiver half — show QR-A, scan QR-B, compare
   the six-digit code.
4. The vestigial key version is gone. `KeyVaultService` used to set it from `vault.version`,
   the *envelope format* version — a different quantity that happened to share the name.
   `KeyringStore.purgeLegacyItems`, run once at launch, deletes the three pre-keyring Keychain
   entries rather than migrating them.
5. `key_version` threaded through `NoteContentService`, `OfflineStore` (the cache index records
   it per note) and `SharingService` (open with *our* version, re-seal to the *recipient's*).

`AuthService.currentUserID()` was added: the keyring is bound to an account, and a kit or a
paired keyring carries the id it belongs to, so installing one needs to know whose session it
is entering.

**One distinction worth keeping.** `KeyringStore` separates "this device holds no keyring"
(`KeyringError.noKeyring`, surfaced as the existing `noEncryptionKey`) from "the keyring lacks
that version" (`missingVersion`, which names the key). They send the user to different places —
restore, versus find the device that has v2 — and a test pins it.

**Testing note.** The Keychain does not work under `CODE_SIGNING_ALLOWED=NO`: an unsigned test
host has no keychain-access-group entitlement, `SecItemAdd` fails, and every key test fails
with it. This predates this work. Run the suite **signed**:
`xcodebuild -scheme NeutrinoNotes -destination '...' test` with no signing override.

**Docs (not started).** The app does not compile on the current working tree: it is mid-refactor
and `DocumentEditorController`, referenced by `DocumentTextEditor.swift`, does not exist yet.
Three of the files this phase must change — `DocContentService.swift`,
`DocContentServiceTests.swift`, `OfflineStoreTests.swift` — also carry uncommitted changes.
Making unverifiable crypto changes on top of a broken mid-refactor, in files with in-flight
edits, is how a bad merge happens, so it was left alone. The Notes work is the template: the
same seven files, the same order.

### Phase 4 — macOS (Drive)

1. Same keyring and keychain work as Phase 3 in `NeutrinoDriveCore/Services/`.
2. Adopt the data-protection keychain (`kSecUseDataProtectionKeychain`), the question
   already documented at length in `KeychainService.swift`. The keyring must be reachable
   from the sandboxed File Provider extension, which is exactly the case that note says
   data-protection would fix. Of the two blockers it lists, one evaporates with the wipe —
   "switching would strand the app's EXISTING legacy items and needs a read-from-legacy
   migration" no longer applies, since those items should be deleted rather than migrated.
   The other is still real: unsigned SPM test binaries lack an application-identifier
   entitlement and every data-protection query returns `errSecMissingEntitlement` (-34018).
   The `KeychainStoring` protocol already in that file exists for this, so tests take the
   in-memory substitute and never reach the real keychain.
3. `SyncEngine` resolves the key version per file on download and re-seals on upload.
4. The desktop app is a plausible *sender* for the handshake (large screen, camera on most
   Macs); build the sender half here and the receiver half only if a headless Mac needs
   enrolling.

---

## 6. Cutover: none — the data is wiped

The app is not in production. There are no users to strand and no files worth preserving, so
there is no migration, no phased rollout, no minimum-version gate and no compatibility
window. Existing encrypted files are abandoned along with the keys that opened them.

```bash
rm -f data/neutrino.db data/neutrino.db-shm data/neutrino.db-wal
rm -rf data/storage/*
diesel migration run     # replays 00001..00112 onto an empty database
```

Clients are reset alongside it: clear the browser's IndexedDB and localStorage for the
origin, and delete the `nn.encryption.*` / `com.neutrino.drive` keychain items on iOS and
macOS (Phase 3.1 and 4.2 do this on first launch anyway).

This is what lets Phase 1b simply `DROP TABLE user_key_vaults` and
`DROP TABLE user_key_unlocks` rather than carrying a read-only deprecation period. Note the
distinction it does *not* buy: the wipe removes the **data** ordering constraint, not the
**code** one — see Phase 1b for why the drop still waits on the clients. Write the down
migrations anyway — they cost nothing and the repo's convention is that every migration has
one — but nothing depends on them being correct against real data.

**The one thing to get right.** This freedom expires the moment anyone other than the
developers stores a file. After that the strict client-first ordering comes back, because
the drop is a one-way door with no server-side copy behind it. If this work is still in
flight when the app takes real users, revisit this section before shipping Phase 1.

---

## 7. Explicitly out of scope

- **Content re-keying.** Rotation re-seals DEKs; it does not re-encrypt file content under
  fresh DEKs. See §3.2 for why that limits what rotation achieves.
- **Automatic rotation.** Rotation is user-initiated. Scheduled or policy-driven rotation
  needs the re-key job above to be worth anything.
- **Sender authenticity on shared DEKs.** `crypto_box_seal` is anonymous, so a recipient has
  no cryptographic evidence of who shared a file. Moving `file_key_refs` to authenticated
  `crypto_box` would fix it and would compose well with Phase 0's fingerprints, but it
  changes the sealed-DEK format and is deferred.
- **The plaintext-on-server defects** of §2 — the Docs/Diagrams Y.Doc and `cover_thumbnail`.
  Tracked separately. They will still be there when this work lands.
