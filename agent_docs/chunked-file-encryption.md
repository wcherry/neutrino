# Chunked File Encryption Format (NEB1)

**Date:** 2026-08-13
**Status:** Proposed
**Owner:** William Cherry
**Affects:** `neutrino` (web + server), `neutrino_drive_mac_desktop`, `neutrino_notes_ios_mobile`, `neutrino_docs_ios_mobile`

---

## 1. Why

Every encrypted file in Neutrino is produced by one call that takes the whole plaintext and
returns the whole ciphertext:

```ts
// packages/e2e-crypto/src/crypto.ts:85
export function encryptFile(plaintext: Uint8Array, dek: Uint8Array): Uint8Array {
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(dek);
  const ciphertext = sodium.crypto_secretstream_xchacha20poly1305_push(
    state, plaintext, null, TAG_FINAL,
  );
  // → [24-byte header][single FINAL-tagged message]
}
```

That was the right call when every encrypted file was a note, a document or a sheet — tens of
kilobytes. It stopped being the right call when Photos landed, because a photo library contains
videos, and the upload path now costs roughly **four to five times the file size in live memory**:

| Step | Cost |
|---|---|
| `entry.blob()` (zip.js inflate) | 1× plaintext |
| `new Uint8Array(await file.arrayBuffer())` (`uploadEncryptedFile`) | 1× plaintext |
| libsodium copies the message into the WASM heap | 1× plaintext |
| `crypto_secretstream_..._push` output in the WASM heap | 1× ciphertext |
| copy out, then `out.set(header) / out.set(ciphertext)` | 1× ciphertext |

A 12 MP photo is 5 MB and none of this matters. A two-minute 4K video is ~500 MB and this is
1.5–2 GB of churn, a plausible tab crash, and — above roughly 2 GB of plaintext — an outright
impossibility, because a single libsodium message has to fit in the wasm32 heap. The same
ceiling applies on the way back out: `decryptFile` slices the blob and pulls it in one shot, so a
large encrypted video cannot be *read* either, whatever produced it.

The archive reader has no such problem. `openTakeout` seeks into the zip with `Blob.slice` and
inflates one entry at a time (`web/apps/web/src/lib/takeout/archive.ts`), so peak memory is the
largest single file rather than the archive. **The encryption format is now the binding
constraint on file size, and it is the only one.**

This document specifies the format that removes it.

### 1.1 What this is not fixing

Two things get conflated with this and should not be. **Upload transport** is already fine: the
progress-bearing path is XHR with a `Blob` body (`packages/api-core/src/client.ts:161`), and the
browser streams that from the blob without a JS-heap copy. **The server** is already fine: it
stores opaque bytes, no Rust code parses the framing (the only mentions of XChaCha20 in `src/`
are doc comments on the metadata columns), and downloads go through `actix_files::NamedFile`
(`src/drive/storage/api.rs:497`), which serves HTTP Range requests.

**No server change is required by this spec.** That property is worth protecting through
implementation.

---

## 2. Scope

### In scope

- A new on-the-wire format for **file bodies** encrypted with a per-file DEK.
- Detection of, and continued support for, the existing format — forever, not transitionally.
- Constant-memory encrypt and decrypt on every client.
- The rollout order that keeps a file written by one client readable by all the others.

### Non-goals

- **The key hierarchy.** DEK generation, sealing (`crypto_box_seal`), rotation and sharing are
  untouched. See `end-to-end-encryption.md` and `key-rotation.md`.
- **`encryptedMetadata`.** The name/mimeType blob is a fixed ~100-byte JSON stored base64url in a
  DB column; 44 bytes of framing is ~30% overhead for nothing. It stays on the legacy format
  (§3.5). This is a deliberate exception, not an oversight.
- **Random access / seeking within a file.** v1 is sequential by design; §7 explains what that
  costs and what a seekable mode would take.
- **Streaming HTTP upload** (`fetch` with `duplex: 'half'`). Out of scope: it would trade XHR
  progress events for a benefit this format does not need, since a disk-backed `Blob` already
  keeps the JS heap flat.
- **Compression, deduplication, resumable upload.**

---

## 3. The format

### 3.1 Layout

```
┌────────────────────────────── 44-byte header ───────────────────────────────┐
│ 0        4        5        6        8           12                  20      │
│ ┌────────┬────────┬────────┬────────┬───────────┬───────────────────┬──────┐│
│ │ magic  │version │  alg   │reserved│ chunkSize │  plaintextLength  │  ss  ││
│ │ 4 B    │  1 B   │  1 B   │  2 B   │   4 B     │       8 B         │ 24 B ││
│ └────────┴────────┴────────┴────────┴───────────┴───────────────────┴──────┘│
└─────────────────────────────────────────────────────────────────────────────┘
┌──── chunk 0 ────┬──── chunk 1 ────┬ ... ┬──── chunk n-1 (FINAL) ────┐
│ chunkSize + 17  │ chunkSize + 17  │     │   ≤ chunkSize + 17        │
└─────────────────┴─────────────────┴─────┴───────────────────────────┘
```

All multi-byte integers are **big-endian**. All offsets are in bytes.

### 3.2 Header fields

| Offset | Size | Field | Value |
|---:|---:|---|---|
| 0 | 4 | `magic` | ASCII `NEB1` = `0x4E 0x45 0x42 0x31` |
| 4 | 1 | `version` | `0x01` |
| 5 | 1 | `alg` | `0x01` = XChaCha20-Poly1305 secretstream, sequential |
| 6 | 2 | `reserved` | `0x0000` |
| 8 | 4 | `chunkSize` | plaintext bytes per chunk, uint32 |
| 12 | 8 | `plaintextLength` | total plaintext bytes, uint64 |
| 20 | 24 | `ssHeader` | `crypto_secretstream_xchacha20poly1305_init_push` header |

**`magic`** — "Neutrino Encrypted Blob, format 1". The legacy format has no magic (it opens with
24 bytes of random header), so this is what distinguishes them. §3.5 covers the collision case.

**`alg`** — reserved for a future seekable mode (§7) so that adding one needs no new magic and no
second detection path. Readers MUST reject an `alg` they do not implement, with an error that
names the value.

**`reserved`** — MUST be written as zero and MUST be rejected if non-zero. Strict now so that a
later version can define these bits and know exactly which writers could have produced them.

**`chunkSize`** — plaintext bytes per chunk, identical for every chunk in the blob except the
last. Writers SHOULD use **1 MiB (1048576)**; see §6.2. Readers MUST accept any value in
**[4096, 16777216]** and MUST reject anything outside it — an attacker-supplied 4 GiB `chunkSize`
would otherwise be an allocation attack, and a 1-byte one a denial of service by tag overhead.

**`plaintextLength`** — the exact decrypted size. It leaks nothing: the ciphertext length already
determines it. It is here because readers, progress bars and buffer allocation all want it
without inference, and because it gives decryption a cheap consistency check (§4.2 step 8).

**`ssHeader`** — 24 bytes, `crypto_secretstream_xchacha20poly1305_HEADERBYTES`.

### 3.3 Chunks

Let `P = plaintextLength`, `C = chunkSize`, `A = 17`
(`crypto_secretstream_xchacha20poly1305_ABYTES`).

- Chunk count `n = max(1, ceil(P / C))`. **An empty plaintext is one empty FINAL chunk**, not
  zero chunks — a blob must always carry a FINAL tag or truncation is undetectable.
- Chunk `i` for `i < n-1` carries exactly `C` plaintext bytes and is pushed with `TAG_MESSAGE`.
- Chunk `n-1` carries `P - (n-1)·C` plaintext bytes (which may be `0` only when `P = 0`) and is
  pushed with `TAG_FINAL`.
- Every chunk is `plaintext_len + A` bytes on the wire. Chunk boundaries are therefore computable
  from the header alone, with no per-chunk length prefix:

  ```
  offsetOf(i) = 44 + i · (C + A)
  ```

- **Every chunk is pushed with the first 20 bytes of the header as additional data (AD)** — that
  is, `magic || version || alg || reserved || chunkSize || plaintextLength`, everything before
  `ssHeader`. This is what authenticates the header: tampering with `chunkSize` or
  `plaintextLength` makes the very first tag fail to verify, rather than being caught later by
  luck or not at all.

  > **Verify before implementing:** swift-sodium's `SecretStream` push/pull must expose an
  > `additionalData:` parameter on the target version in all three Swift codebases. If any
  > binding lacks it, do **not** silently drop the AD on that platform — that would produce blobs
  > other clients reject. Raise it as a blocking issue; the fallback is §12 Q3.

### 3.4 Size

```
ciphertextLength = 44 + P + 17·n     where n = max(1, ceil(P / C))
```

With `C = 1 MiB`, overhead is 44 bytes plus 0.0016% — 477 chunks and 8.1 KB of tags on a 500 MB
video. The legacy format costs 41 bytes flat, so nothing here is a meaningful size regression.

### 3.5 Version detection, and the legacy format

The existing format — call it **v0** — is `[24-byte ssHeader][one FINAL-tagged message]`, with no
version marker of any kind. It is implemented identically in four codebases:

- `web/packages/e2e-crypto/src/crypto.ts:85` (`encryptFile`) and `:104` (`decryptFile`)
- `neutrino_drive_mac_desktop/Sources/NeutrinoDriveCore/Services/EncryptionService.swift:40-68`
- `neutrino_notes_ios_mobile/NeutrinoNotes/Services/NoteContentService.swift`
- `neutrino_docs_ios_mobile/NeutrinoDocs/Services/DocContentService.swift`

Every reader MUST implement this dispatch:

```
if length ≥ 44 and bytes[0..4] == "NEB1":
    try: return decryptV1(bytes)
    catch InvalidHeader: fall through to v0     # see below
    catch AuthenticationFailure: raise          # do NOT fall through
return decryptV0(bytes)
```

A v0 blob whose random 24-byte header happens to begin with the four bytes `NEB1` occurs with
probability 2⁻³², and this is why the fall-through exists: such a blob is misrouted to
`decryptV1`, fails its *structural* checks (bad `version`/`alg`/`reserved`/`chunkSize`, or a
length inconsistent with the chunk arithmetic), and is then correctly decrypted as v0. The
distinction between the two catch clauses is load-bearing: **a structural rejection may fall
back, an authentication failure must not.** Falling back on an auth failure would turn every
tampered v1 blob into a v0 decryption attempt, and the error the user sees would name the wrong
problem.

v0 is **not deprecated and will not be removed.** Existing blobs are re-encryptable only by a
client that downloads, decrypts, re-encrypts and re-uploads them, and there is no reason to spend
a user's bandwidth on that. Editor content migrates for free — every save rewrites the whole body
— and everything else stays v0 until it is next written. Both formats are permanent.

---

## 4. Algorithms

Normative. Pseudocode; language-idiomatic implementations are expected to differ in shape but not
in bytes produced or checks performed.

### 4.1 Encrypt

```
encryptV1(source, dek, chunkSize = 1 MiB) -> sink:
     1  assert 4096 ≤ chunkSize ≤ 16777216
     2  P ← length(source)
     3  (state, ssHeader) ← crypto_secretstream_xchacha20poly1305_init_push(dek)
     4  prefix ← "NEB1" ‖ 0x01 ‖ 0x01 ‖ 0x0000 ‖ be32(chunkSize) ‖ be64(P)   # 20 bytes
     5  write(sink, prefix ‖ ssHeader)                                        # 44 bytes
     6  n ← max(1, ceil(P / chunkSize))
     7  for i in 0 .. n-1:
     8      plain ← read(source, i · chunkSize, min(chunkSize, P - i · chunkSize))
     9      tag   ← (i == n-1) ? TAG_FINAL : TAG_MESSAGE
    10      write(sink, crypto_secretstream_xchacha20poly1305_push(state, plain, prefix, tag))
    11      release(plain)                       # nothing but the current chunk stays live
```

A conforming writer holds at most one plaintext chunk and one ciphertext chunk at a time
(line 11 is the whole point of the exercise; an implementation that accumulates `plain` into an
array has implemented nothing).

### 4.2 Decrypt

```
decryptV1(source, dek) -> sink:
     1  hdr ← read(source, 0, 44);  if length(source) < 44: raise InvalidHeader
     2  assert hdr[0..4] == "NEB1"                             else InvalidHeader
     3  assert hdr[4] == 0x01                                  else InvalidHeader("version")
     4  assert hdr[5] == 0x01                                  else InvalidHeader("alg")
     5  assert hdr[6..8] == 0x0000                             else InvalidHeader("reserved")
     6  C ← be32(hdr[8..12]);  assert 4096 ≤ C ≤ 16777216      else InvalidHeader("chunkSize")
     7  P ← be64(hdr[12..20])
     8  n ← max(1, ceil(P / C))
        assert length(source) == 44 + P + 17·n                 else InvalidHeader("length")
     9  prefix ← hdr[0..20]
    10  state ← crypto_secretstream_xchacha20poly1305_init_pull(hdr[20..44], dek)
    11  for i in 0 .. n-1:
    12      want   ← min(C, P - i·C)
    13      cipher ← read(source, 44 + i·(C+17), want + 17)
    14      (plain, tag) ← crypto_secretstream_xchacha20poly1305_pull(state, cipher, prefix)
    15      if pull failed: raise AuthenticationFailure
    16      assert length(plain) == want                       else AuthenticationFailure
    17      assert tag == (i == n-1 ? TAG_FINAL : TAG_MESSAGE) else AuthenticationFailure
    18      write(sink, plain);  release(plain)
```

Step 8 is what makes a truncated or extended blob fail before a single byte is decrypted.
Step 17 is what makes a *re-framed* blob fail — an attacker who deletes trailing chunks and
rewrites `plaintextLength` gets past step 8, and is caught here by the missing FINAL, or by the
AD mismatch at step 14 because `plaintextLength` is authenticated.

### 4.3 Choosing the writer

```
writeEncrypted(bytes, dek):
    if isFileBody and chunkedWritesEnabled:  return encryptV1(bytes, dek)
    else:                                    return encryptV0(bytes, dek)   # metadata, or pre-rollout
```

`chunkedWritesEnabled` is the rollout gate; see §10.

---

## 5. Security properties

What v1 gives, and what each rests on:

| Property | Mechanism |
|---|---|
| Confidentiality | XChaCha20-Poly1305, per-file 256-bit DEK — unchanged from v0 |
| Per-chunk integrity | Poly1305 tag per chunk (17 bytes) |
| **Reordering resistance** | secretstream's chained state — chunk `i` cannot verify in position `j` |
| **Truncation resistance** | `TAG_FINAL` on the last chunk (step 17) *and* the length check (step 8) |
| **Extension resistance** | length check (step 8) — appended chunks make the arithmetic fail |
| **Header integrity** | the 20-byte prefix as AD on every chunk (§3.3) |
| Cross-file splicing resistance | distinct DEK and distinct random `ssHeader` per file |

Unchanged from v0, and still true: the server sees ciphertext length and nothing else. Chunking
does not change what is leaked — `ciphertextLength` determined plaintext length before, and still
does.

**Not provided, deliberately:** the DEK is not bound to the file id, so a server that can move
blobs between file records could serve file A's ciphertext as file B, and it would decrypt
cleanly for anyone holding A's DEK. This is a pre-existing property of v0, not something v1
introduces — but the AD field is where a fix would go (bind the file id into the prefix), and
whoever implements v1 is the person best placed to decide whether to take that on. It is out of
scope here because it needs a decision about version-history blobs, which share a DEK across
revisions of the same file id.

---

## 6. Choices considered

### 6.1 secretstream chunks vs. an independent-nonce STREAM construction

The alternative to chunking secretstream is the STREAM construction used by `age` and Tink: each
chunk is an independent AEAD message under a nonce of `random_prefix ‖ counter ‖ last_flag`. It
gives everything above **plus random access** — chunk `k` is decryptable without touching chunks
`0..k-1`.

Rejected for v1:

- **It is new cryptographic construction work in four codebases.** Nonce derivation, counter
  overflow, and the final-flag rule are exactly the details that are easy to get subtly wrong and
  impossible to notice when you do — a wrong implementation still round-trips against itself.
  secretstream is libsodium's own answer to "encrypt a large file in chunks" and gets the chaining,
  the tags and the state right by construction.
- **The motivating problem is memory, not seeking.** Chunked secretstream solves memory
  completely.
- **It costs nothing to defer.** The `alg` byte exists precisely so that a seekable mode is
  `alg = 0x02` with the same magic, the same header and the same dispatch — an additive change,
  not a second migration.

### 6.2 Chunk size: 1 MiB

| Size | Overhead | Live memory per chunk | Chunks in a 500 MB video |
|---|---|---|---|
| 64 KiB | 0.026% | ~128 KB | 7,630 |
| **1 MiB** | **0.0016%** | **~2 MB** | **477** |
| 4 MiB | 0.0004% | ~8 MB | 120 |

1 MiB keeps per-chunk memory irrelevant on a phone while keeping the chunk count low enough that
per-call overhead (a WASM boundary crossing per chunk in the browser) stays invisible. 64 KiB —
`age`'s choice — is tuned for a different constraint (streaming over a pipe) and costs 16× the
calls for overhead nobody can measure either way.

Writers MAY use a different size within the accepted range; the format carries it, so a client
that wants 4 MiB for its own uploads interoperates with no coordination.

### 6.3 A magic prefix rather than a sidecar version field

The alternative is storing the format version next to the file in the DB. Rejected: the ciphertext
and its version must travel together. Version history, offline stores, the search-index snapshot
and any future export all move blobs around without carrying the DB row alongside, and a blob that
cannot say what it is will eventually be decrypted by something that guessed wrong.

---

## 7. Random access, and what v2 would take

v1 is **sequential**: secretstream's state chains from chunk to chunk, so decrypting chunk `k`
means pulling chunks `0..k`. Practical consequences:

- **Whole-file read** (every current use: open a document, view a photo, restore a version) —
  unaffected, constant memory.
- **Seek to the middle of a 500 MB video** — requires decrypting ~250 MB first. Constant memory,
  but seconds of CPU. Acceptable for "play from the start"; not acceptable for scrubbing.
- **HTTP Range** resumes an interrupted *download* as it always did — the bytes are just bytes.
  It does not let decryption resume: secretstream state cannot be reconstructed from the middle
  of a stream, so a resumed download still decrypts from chunk 0. Constant memory throughout,
  but the CPU is spent again.

If scrubbing becomes a requirement, `alg = 0x02` is a per-chunk-independent AEAD (§6.1) with the
same 44-byte header. Chunk `k` is then addressable directly by HTTP Range at
`44 + k·(C+17)`, which is what makes a `MediaSource`-backed player possible. Everything in this
spec other than §4.1 line 10 and §4.2 lines 10–17 stays as written.

---

## 8. Implementation notes

### 8.1 Web: keeping the JS heap flat

The format is only half of it. A v1 writer that reads the whole source into an `ArrayBuffer` has
changed the wire bytes and nothing else.

**Source → chunks.** Take the source as a `Blob`/`File` and slice it:
`await blob.slice(i * C, (i + 1) * C).arrayBuffer()`. Each slice is read from browser-managed
(often disk-backed) storage on demand.

**Chunks → sink.** Accumulating ciphertext chunks in an array puts the whole ciphertext back in
the heap. Two ways not to:

```ts
// Preferred: let the browser drain a stream into a (possibly disk-backed) Blob.
const stream = new ReadableStream({
  async pull(controller) { /* … push one ciphertext chunk, close on the last … */ },
});
const cipherBlob = await new Response(stream).blob();

// Fallback where streams are awkward: Blob parts are references, not copies.
let cipherBlob = new Blob([headerBytes]);
for (…) cipherBlob = new Blob([cipherBlob, chunkBytes]);
```

Then hand `cipherBlob` to the existing XHR upload path, which keeps the progress events.

**Zip → encrypt without materialising.** For the Takeout import specifically, `entry.blob()`
(`web/apps/web/src/lib/takeout/archive.ts:218`) still materialises the whole entry before any of
this runs, so the import's peak stays at 1× file size until that changes too. zip.js can write an
entry into a `WritableStream`, which would close the last gap — **verify the exact API against the
pinned `@zip.js/zip.js` 2.8.x before planning on it.**

**libsodium.** `crypto_secretstream_xchacha20poly1305_push(state, message, ad, tag)` — the third
argument is the AD, currently passed as `null` by v0. State is a JS object held across calls;
`init_push` once per file, not per chunk.

### 8.2 Swift (Mac, iOS)

`sodium.secretStream.xchacha20poly1305.initPush(secretKey:)` returns a stream object whose
`push(message:tag:)` is called per chunk — the existing call sites already use it, they just call
it once. Read the source with `FileHandle` reads of `chunkSize` (or `InputStream`) rather than
`Data(contentsOf:)`, and write with `FileHandle.write` rather than accumulating `Data`.

Note the AD caveat in §3.3 — this is the one place the three Swift codebases could diverge from
web, and it is a blocking check, not a detail.

### 8.3 The local stores are not on the wire

`OfflineStore.swift` (both iOS apps), `SearchIndexStore.swift` (docs) and
`VersionHistoryService.swift` use the same framing for blobs that **never leave the device**.
They can adopt v1 whenever convenient, or never. They are listed in §9 for completeness, not as
rollout dependencies.

---

## 9. Inventory: what changes

Verified call sites as of 2026-08-13.

### `web` — the format itself

| File | Role |
|---|---|
| `packages/e2e-crypto/src/crypto.ts:85` | `encryptFile` → gains v1 writer + streaming variant |
| `packages/e2e-crypto/src/crypto.ts:104` | `decryptFile` → gains v0/v1 dispatch (§3.5) |
| `packages/e2e-crypto/src/crypto.ts:249` | `encryptMetadata` → **stays v0** (§2 non-goals) |

### `web` — producers (call `encryptFile`)

`packages/api-drive/src/client.ts:632` (`uploadEncryptedFile` — the photos/media path, the one
that motivated this), `:718`, `:741`, `:764`, `:785`;
`packages/api-sheets/src/index.ts:281`; `packages/api-diagrams/src/index.ts:252`;
`apps/web/src/lib/searchIndexSnapshot.ts:146`.

### `web` — consumers (call `decryptFile`)

`app/(apps)/sheets/editor/hooks/usePersistence.ts:499`;
`app/(apps)/docs/editor/DocEditor.tsx:795`;
`app/(apps)/slides/editor/SlideEditor.tsx:459`;
`app/(apps)/diagrams/editor/DiagramEditor.tsx:236`;
`app/(apps)/notes/editor/page.tsx:151,156`;
`app/(apps)/photos/editor/PhotoEditor.tsx:246`;
`components/DocumentPreviewModal/DocumentPreviewModal.tsx:111,191,344,478,483,594`;
`lib/driveImages.ts` (via the resolver described in `web/CLAUDE.md`).

Most of these need **no change at all** — they call `decryptFile(bytes, dek)` and get bytes back.
The dispatch happens inside. Only paths that want constant memory (photos, media preview,
downloads) need the streaming variant.

### Native

| Codebase | File |
|---|---|
| `neutrino_drive_mac_desktop` | `Sources/NeutrinoDriveCore/Services/EncryptionService.swift:40-68` |
| `neutrino_notes_ios_mobile` | `Services/NoteContentService.swift`, `Services/OfflineStore.swift`, `Services/VersionHistoryService.swift` |
| `neutrino_docs_ios_mobile` | `Services/DocContentService.swift`, `Services/OfflineStore.swift`, `Services/VersionHistoryService.swift`, `Search/SearchIndexStore.swift` |

### Server

**Nothing.** Confirmed: no Rust code parses the ciphertext framing; `NamedFile` already serves
Range requests. If an implementation finds itself editing `src/drive/`, something has gone wrong.

---

## 10. Rollout

The failure mode to design against: a client writes v1, an older client reads it, and the user's
file is unopenable. The ordering below is the whole mitigation.

**Phase 1 — readers everywhere.** Ship v0/v1 dispatch (§3.5) to web, Mac, both iOS apps. No
client writes v1. This phase is safe in any order and can ship over as many releases as it takes.

**Phase 2 — vectors and cross-client proof.** §11. Every client decrypts the canonical vectors in
CI. No writer ships until this is green everywhere.

**Phase 3 — gated writes.** Add `e2eeChunkedWrites` to the feature-flag system
(`GET /api/v1/feature-flags`; see the Feature flags section of `web/CLAUDE.md`) defaulting to
off. Enable for internal accounts, then broadly.

- Native clients must honour the same flag. An iOS build that ignores it and writes v1 to an
  account whose Mac client predates Phase 1 is exactly the bug this ordering prevents.
- A client that cannot yet read v1 must never be able to enable writing it. Gate the flag's
  *effect* on the reading code being present in that build, not only on the flag.

**Phase 4 — default on.** Flip the default once telemetry shows no v1-decrypt failures. Keep the
flag for one release cycle as a kill switch.

**Rollback.** Turning the flag off stops new v1 blobs; it does not un-write existing ones, which
is why Phase 1 must be complete and verified before Phase 3 starts. There is no version of this
where writes ship first.

---

## 11. Tests

### 11.1 Canonical vectors

secretstream headers are random, so encryption is not reproducible and vectors must be
**decrypt** vectors. Generate once, commit as fixtures, and have every codebase decrypt the same
bytes:

| Vector | Contents |
|---|---|
| `v1-empty` | `P = 0` — one empty FINAL chunk |
| `v1-single` | `P = 100`, `C = 4096` — one partial chunk |
| `v1-exact` | `P = 8192`, `C = 4096` — two full chunks, last one exactly full |
| `v1-multi` | `P = 10000`, `C = 4096` — three chunks, last one partial |
| `v1-1mib` | `P = 3 MiB + 7`, `C = 1 MiB` — the production shape |
| `v0-legacy` | a v0 blob — must still decrypt after the dispatch lands |
| `v0-magic-collision` | a v0 blob hand-crafted to start with `NEB1` — must decrypt as v0 (§3.5) |

Each fixture ships as `{ dek_hex, ciphertext_b64, expected_sha256_of_plaintext }`. Store under
`web/apps/web/src/__tests__/fixtures/e2ee/` and mirror into each native repo's test bundle.

### 11.2 Negative vectors — every one MUST fail to decrypt

Truncated final chunk · a whole chunk removed with `plaintextLength` rewritten to match · two
chunks swapped · one ciphertext byte flipped · `chunkSize` altered in the header · `reserved` set
non-zero · `alg = 0x02` (unimplemented) · `chunkSize = 1024` (below the floor) ·
`chunkSize = 0x40000000` (above the ceiling) · a v1 blob decrypted with the wrong DEK.

A "fails" that returns garbage rather than raising is a bug of the same severity as decrypting
wrongly.

### 11.3 Properties

- **Round-trip** at sizes `0, 1, C-1, C, C+1, 2C, 2C+1` for `C` at both ends of the accepted range.
- **Cross-client**: web-encrypted → Swift-decrypted, and Swift-encrypted → web-decrypted, in CI.
  This is the test that would have caught an AD mismatch (§3.3), and the one most likely to be
  skipped because it needs both toolchains. It is not optional.
- **Memory**: encrypt a synthetic 200 MB source and assert peak heap stays below a small multiple
  of `chunkSize`. `web/apps/web/src/__tests__/takeout/archive.test.ts` already does the analogous
  thing for the zip reader by counting sliced bytes — same trick, instrument the allocation path.
- **v0 still round-trips** unchanged, byte for byte, in every codebase.

---

## 12. Open questions

1. **Chunk size for the Mac sync agent.** 1 MiB is chosen for browsers. The File Provider
   extension has a tighter memory budget and a different access pattern; does it want its own
   writer-side value? The format allows it with no coordination — the question is whether anyone
   has measured.

2. **Version history and DEK reuse.** Revisions of one file share a DEK. That is fine for
   confidentiality (each revision has its own random `ssHeader`), but it is the thing that makes
   binding the file id into the AD (§5) less obvious than it looks. Decide before, not during,
   any future `alg = 0x02` work.

3. **Fallback if a Swift binding lacks AEAD additional data** (§3.3). The options are: pass AD
   only on the first chunk; drop AD and rely on step 8's length check plus boundary failure for
   header integrity; or vendor the libsodium call directly. Preference order is that order, but it
   should not be decided until someone has actually checked the binding.

4. **Does the search-index snapshot want v1?** It is a single blob that grows with the library and
   is re-uploaded on change. Probably yes, mechanically; nobody has measured how big it gets.
