Prompt: Research https://github.com/wcherry/neutrino/issues/102 ("Import Process Limited to 10MB"). Come up with the best way to deal with this, should this be settable by the admin. What are the downsides of setting it to a really huge number. The Google Takeout files can be 50GB, are we able to handle that?

Researched 2026-08-24 against `main` @ `ad0da75`. Versions at the time: Next.js 15.5.14, actix-web 4, actix-multipart 0.7.2.

**Status:** all three suggestions at the foot of this document were implemented on 2026-08-24. The findings below are kept as written — they are what the code now reflects, and the reasoning for each change lives in the comments at the sites named here.


## What issue #102 actually is

The 10 MB ceiling is **not** in the Rust server. It's the Next.js dev proxy, and it's dev-only.

- `web/apps/web/next.config.ts` only registers the `/api/:path*` → `http://localhost:8080` rewrite when `isDev`. Production builds are `output: 'export'` — a static bundle the actix server serves from `WEB_DIR`. No Node process sits in the upload path in prod.
- Next 15.5.14 defaults `experimental.middlewareClientMaxBodySize` to `10485760` (`next/dist/server/config-shared.js:220`). `next/dist/server/lib/router-server.js:349` calls `cloneBodyStream()` on every externally-rewritten request, and `next/dist/server/body-streams.js:93` **truncates** past the limit (`p1.push(null)`) after logging the warning quoted in the issue.

So in `pnpm dev`, any upload over 10 MB gets its multipart body cut mid-stream. The Rust side then hits EOF before the closing boundary and returns `400 Upload interrupted`. This affects *every* Drive upload in dev, not just the Takeout importer — the importer just made it obvious because Takeout is full of photos and videos.


## Recommended fix

One line in the dev branch of `web/apps/web/next.config.ts`:

```ts
...(isDev && {
  experimental: { middlewareClientMaxBodySize: 2 * 1024 * 1024 * 1024 },
  async rewrites() { /* … */ },
}),
```

Note `experimental` is already declared lower in that config, so this needs merging into the existing object rather than added as a second key.


## Should it be admin-settable?

**No.** It's a localhost dev-proxy constant that doesn't exist in any deployed instance. Exposing it as a knob would imply it governs production behaviour, which it doesn't. A named constant with a comment explaining why it's dev-only is the right shape.

The knob that *should* exist already does — `MAX_UPLOAD_BYTES` — except:

**`MAX_UPLOAD_BYTES` is currently a no-op for uploads.** `src/main.rs:1037` wires it as `web::PayloadConfig`, but `actix_multipart::Multipart::from_request` never consults `PayloadConfig` — it just calls `Multipart::from_req` (`actix-multipart-0.7.2/src/extractor.rs:36`). Nothing in `upload_file` (`src/drive/storage/api.rs:104`) compares the accumulated `size` against it. The 10 GiB single-file limit documented in `README.md` and on the self-host page isn't enforced anywhere.

Related: the quota check in `src/drive/storage/service.rs:101-124` runs inside `finalize_upload`, i.e. **after** every byte is already on disk. An over-quota 50 GB upload writes 50 GB, then 413s and deletes it. Checking incrementally inside the chunk loop would fail fast.


## Downsides of a really huge number

| Layer | Risk at a huge value |
|---|---|
| Next dev proxy | `cloneBodyStream` pushes into two `PassThrough`s in flowing mode and ignores backpressure. If the Rust side drains slower than the client sends, Node's heap grows unbounded. On localhost this is unlikely (the 1 MB `BufWriter` to disk keeps up), but it argues for "big enough for dev" (~2 GiB) over `Number.MAX_SAFE_INTEGER`. |
| `MAX_UPLOAD_BYTES` (once enforced) | Disk exhaustion and slot exhaustion: bytes land in `temp_*` staging before any quota check, so N concurrent uploads can fill the volume regardless of per-user quota. |
| Reverse proxy | The self-host docs (`web/apps/web/src/app/self-host/page.tsx:352`) already recommend `client_max_body_size 0` + `proxy_request_buffering off`. Without the latter, nginx buffers the whole body to `/var/lib/nginx` first — the real footgun. |
| Client | No resumability. `web/packages/api-core/src/client.ts:165` uses XHR with a `File` body, so a dropped connection at 4.9 GB restarts from zero. |

Not a risk: the temp sweeper. `sweep_temp_files` (`src/drive/storage/store.rs:189`) keys on mtime, which advances while writing, so in-flight uploads are never reaped even past `TEMP_MAX_AGE_SECS`.


## Can we handle a 50 GB Takeout?

**The archive itself, yes — it never crosses the wire.** `web/apps/web/src/lib/takeout/archive.ts` opens the zip with zip.js `BlobReader`, which seeks via `Blob.slice`, reads only the central directory up front, and inflates one entry at a time in a worker. A 50 GB export is fine; only individual extracted files get uploaded.

Three real ceilings, in order of how likely you are to hit them:

1. **The dev proxy truncation above** — the actual issue #102. Fixed by the config change.
2. **Per-entry memory.** `archive.ts:244` uses `BlobWriter`, and `importPhotos.ts:284` materialises the whole blob before wrapping it in a `File`. Peak memory is the largest single entry — a 4 GB video from Photos will be painful (Chrome spills large Blobs to disk, so probably slow rather than fatal, but untested). Docs are worse in principle: `importDocs.ts:105` does `.arrayBuffer()` on top of the blob, doubling it — though `.docx` files are small enough that it doesn't matter in practice.
3. **Split archives.** Google splits exports into 1/2/4/10/50 GB parts, so a 50 GB export usually arrives as several zips. The import page sets `multiple={false}` (`web/apps/web/src/app/(apps)/import/page.tsx:294`) and calls `openTakeout(file)` on one file only. Anyone taking the 2 GB default split gets 25 zips and can only import the first. This is probably more damaging for real Takeout users than the 10 MB one.


## Suggested issue split — all three done

- **#102** → `experimental.middlewareClientMaxBodySize`, set to 2 GiB in the dev branch of `web/apps/web/next.config.ts`. Dev-only, and deliberately not unbounded: Next's body clone ignores backpressure.
- **Enforce `MAX_UPLOAD_BYTES`** → `UploadAllowance` in `src/drive/storage/service.rs` is the pre-flight figure (single-file ceiling, quota headroom, daily headroom), and `stream_field_to_file` in `src/drive/storage/api.rs` checks it per chunk. All three streaming routes in that module — upload, autosave, save-version — now go through the one helper, so the ceiling cannot be forgotten by a fourth. Autosave and named versions are `UploadAllowance::unmetered`: bounded by the ceiling, not by quota, since failing a save from an open editor over a full quota loses work the user has already done rather than preventing it. The commit-time checks in `finalize_upload` stay put — the pre-flight figure is a snapshot, so they are what settles a race between concurrent uploads.
- **Multi-part Takeout** → `openTakeout` takes `Blob | Blob[]` and merges the parts into one `TakeoutArchive`; the import page's `DropZone` takes `multiple`, sorts the parts numerically and shows a part count. See the split-export note in `web/CLAUDE.md`.

Not addressed, and still open from the ceilings section above: per-entry memory (`BlobWriter` materialises the largest entry in full, which a multi-GB video will feel) and upload resumability.
